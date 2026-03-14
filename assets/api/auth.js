// api/auth.js
// Called by callback.html with ?code= from Discord.
// Uses the new Appwrite TablesDB API (Tables/Rows instead of Collections/Documents).
//
// Flow:
//   1. Exchange Discord code for access token
//   2. Fetch Discord user info
//   3. Get client IP
//   4. Create or update row in Appwrite users table
//   5. Lock account if IP changed from original_ip
//   6. Set signed session cookie
//   7. Return safe user data as JSON

import { Client, TablesDB, ID, Query } from 'node-appwrite';
import crypto from 'crypto';

/* ── Session signing ──────────────────────────────────────────
   Signs payload with HMAC-SHA256. Not a full JWT but solid
   enough for this. Use a long random SESSION_SECRET env var.   */
function signSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

/* ── Appwrite client (server-side only) ───────────────────── */
function getTablesDB() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new TablesDB(client);
}

/* ── IP extraction ─────────────────────────────────────────── */
function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ── Main handler ──────────────────────────────────────────── */
export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  // ── 1. Exchange code for Discord access token ──────────────
  let tokenData;
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      }),
    });
    tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token exchange failed');
  } catch (err) {
    console.error('[auth] Token exchange error:', err.message);
    return res.status(502).json({ error: 'Discord token exchange failed.' });
  }

  // ── 2. Fetch Discord user info ─────────────────────────────
  let discordUser;
  try {
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    discordUser = await userRes.json();
    if (!userRes.ok) throw new Error('User fetch failed');
  } catch (err) {
    console.error('[auth] Discord user fetch error:', err.message);
    return res.status(502).json({ error: 'Could not fetch Discord profile.' });
  }

  // ── 3. Get client IP and timezone ──────────────────────────
  const currentIp = getIp(req);
  const timezone  = req.headers['x-timezone'] || 'unknown';

  // ── 4. Appwrite — create or update row ─────────────────────
  const db     = getTablesDB();
  const DB_ID  = process.env.APPWRITE_DB_ID;
  const TBL_ID = process.env.APPWRITE_TABLE_ID; // "users"

  let locked = false;

  try {
    // Query for existing row by discord_id
    const existing = await db.listRows({
      databaseId: DB_ID,
      tableId:    TBL_ID,
      queries:    [Query.equal('discord_id', discordUser.id)],
    });

    if (existing.total === 0) {
      // ── NEW USER — create row, store both IP fields ──────
      await db.createRow({
        databaseId: DB_ID,
        tableId:    TBL_ID,
        rowId:      ID.unique(),
        data: {
          discord_id:       discordUser.id,
          discord_username: discordUser.username,
          discord_avatar:   discordUser.avatar || '',
          email:            discordUser.email  || '',
          phone:            '',
          original_ip:      currentIp,
          last_ip:          currentIp,
          timezone,
          contributor:      false,
          membership:       'default',
          locked:           false,
          tos_agreed:       true,
        },
      });

    } else {
      const row = existing.rows[0];

      if (row.locked) {
        // Already locked — don't update anything
        locked = true;

      } else if (
        row.original_ip !== 'unknown' &&
        row.original_ip !== currentIp
      ) {
        // ── IP CHANGED FROM ORIGINAL — lock the account ──
        await db.updateRow({
          databaseId: DB_ID,
          tableId:    TBL_ID,
          rowId:      row.$id,
          data: { last_ip: currentIp, locked: true },
        });
        locked = true;
        console.warn(
          `[auth] IP change! User: ${discordUser.username} | ` +
          `original=${row.original_ip} | current=${currentIp} | LOCKED`
        );

      } else {
        // ── RETURNING USER, IP MATCHES — update last_ip ──
        await db.updateRow({
          databaseId: DB_ID,
          tableId:    TBL_ID,
          rowId:      row.$id,
          data: {
            last_ip:          currentIp,
            discord_username: discordUser.username,
            discord_avatar:   discordUser.avatar || '',
            email:            discordUser.email  || '',
            timezone,
          },
        });
      }
    }
  } catch (err) {
    console.error('[auth] Appwrite error:', err.message);
    return res.status(500).json({ error: 'Database operation failed.' });
  }

  // ── 5. Set signed session cookie ───────────────────────────
  const sessionPayload = {
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
    ip:       currentIp,
    iat:      Date.now(),
  };

  const sessionToken = signSession(sessionPayload);

  res.setHeader('Set-Cookie', [
    `nc_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`,
  ]);

  // ── 6. Return safe user data ────────────────────────────────
  return res.status(200).json({
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
  });
}
