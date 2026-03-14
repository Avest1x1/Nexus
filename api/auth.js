// api/auth.js
// Called by callback.html with ?code= from Discord.
// 1. Exchanges code for Discord token
// 2. Fetches Discord user info
// 3. Gets client IP
// 4. Creates or updates user in Appwrite
// 5. Locks account if IP changed from original_ip
// 6. Sets signed session cookie
// 7. Returns safe user data as JSON

import { Client, Databases, ID, Query } from 'node-appwrite';
import crypto from 'crypto';

/* ── Session signing ────────────────────────────────
   Signs a JSON payload with HMAC-SHA256 so the cookie
   can't be tampered with. Not a full JWT but solid for
   this use case. Use a long random SESSION_SECRET env.  */
function signSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig     = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

/* ── Appwrite client (server-side only) ─────────────── */
function getDb() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

/* ── IP extraction ───────────────────────────────────── */
function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ── Main handler ─────────────────────────────────────── */
export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  // ── 1. Exchange code for Discord access token ──────
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

  // ── 2. Fetch Discord user info ─────────────────────
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

  // ── 3. Get client IP and timezone header ───────────
  const currentIp = getIp(req);
  const timezone  = req.headers['x-timezone'] || 'unknown';

  // ── 4. Appwrite — create or update user ────────────
  const db = getDb();
  const DB   = process.env.APPWRITE_DB_ID;
  const COLL = process.env.APPWRITE_COLLECTION_ID;

  let locked = false;

  try {
    const existing = await db.listDocuments(DB, COLL, [
      Query.equal('discord_id', discordUser.id),
    ]);

    if (existing.total === 0) {
      // ── NEW USER — store both IP fields ─────────────
      await db.createDocument(DB, COLL, ID.unique(), {
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
        discord_avatar:   discordUser.avatar || '',
        email:            discordUser.email  || '',
        phone:            '',
        original_ip:      currentIp,   // Version 1: never changes
        last_ip:          currentIp,   // Version 2: updated on each login
        timezone,
        contributor:      false,
        membership:       'default',
        locked:           false,
        tos_agreed:       true,
      });

    } else {
      const doc = existing.documents[0];

      if (doc.locked) {
        // Already locked by an admin or previous IP check
        locked = true;

      } else if (
        doc.original_ip !== 'unknown' &&
        doc.original_ip !== currentIp
      ) {
        // ── IP CHANGED — lock the account ─────────────
        // Store the new IP so admins can see what changed
        await db.updateDocument(DB, COLL, doc.$id, {
          last_ip: currentIp,
          locked:  true,
        });
        locked = true;
        console.warn(
          `[auth] IP change detected for ${discordUser.username}. ` +
          `original=${doc.original_ip} current=${currentIp} — LOCKED`
        );

      } else {
        // ── RETURNING USER, SAME IP — update last_ip ──
        await db.updateDocument(DB, COLL, doc.$id, {
          last_ip:          currentIp,
          discord_username: discordUser.username,
          discord_avatar:   discordUser.avatar || '',
          email:            discordUser.email  || '',
          timezone,
        });
      }
    }
  } catch (err) {
    console.error('[auth] Appwrite error:', err.message);
    return res.status(500).json({ error: 'Database operation failed.' });
  }

  // ── 5. Set signed session cookie ────────────────────
  const sessionPayload = {
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
    ip:       currentIp,   // stored in cookie to compare on /api/me
    iat:      Date.now(),
  };

  const sessionToken = signSession(sessionPayload);

  res.setHeader('Set-Cookie', [
    `nc_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`,
  ]);

  // ── 6. Return safe user data ─────────────────────────
  return res.status(200).json({
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
  });
}
