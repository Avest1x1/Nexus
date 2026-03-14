// api/auth.js
// Discord OAuth code exchange + Appwrite user save.
// Uses the real node-appwrite SDK: Databases class,
// listDocuments / createDocument / updateDocument methods.

import { Client, Databases, ID, Query } from 'node-appwrite';
import crypto from 'crypto';

/* ── Session signing ──────────────────────────────────────── */
function signSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

/* ── Appwrite Databases client ────────────────────────────── */
function getDb() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

/* ── IP extraction ────────────────────────────────────────── */
function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ── Main handler ─────────────────────────────────────────── */
export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  // 1. Exchange code for Discord access token
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
    if (!tokenRes.ok) {
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }
  } catch (err) {
    console.error('[auth] Token exchange error:', err.message);
    return res.status(502).json({ error: 'Discord token exchange failed.', detail: err.message });
  }

  // 2. Fetch Discord user
  let discordUser;
  try {
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    discordUser = await userRes.json();
    if (!userRes.ok) throw new Error(JSON.stringify(discordUser));
  } catch (err) {
    console.error('[auth] Discord user fetch error:', err.message);
    return res.status(502).json({ error: 'Could not fetch Discord profile.', detail: err.message });
  }

  // 3. Get IP + timezone
  const currentIp = getIp(req);
  const timezone  = req.headers['x-timezone'] || 'unknown';

  // 4. Appwrite — upsert user document
  const db     = getDb();
  const DB_ID  = process.env.APPWRITE_DB_ID;
  const COL_ID = process.env.APPWRITE_COLLECTION_ID; // still called collectionId in the SDK

  let locked = false;

  try {
    // listDocuments(databaseId, collectionId, queries[])
    const result = await db.listDocuments(DB_ID, COL_ID, [
      Query.equal('discord_id', discordUser.id),
    ]);

    if (result.total === 0) {
      // New user
      await db.createDocument(DB_ID, COL_ID, ID.unique(), {
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
        discord_avatar:   discordUser.avatar  || '',
        email:            discordUser.email   || '',
        phone:            '',
        original_ip:      currentIp,
        last_ip:          currentIp,
        timezone,
        contributor:      false,
        membership:       'default',
        locked:           false,
        tos_agreed:       true,
      });

    } else {
      const doc = result.documents[0];

      if (doc.locked) {
        locked = true;

      } else if (doc.original_ip && doc.original_ip !== 'unknown' && doc.original_ip !== currentIp) {
        // IP changed from original — lock
        await db.updateDocument(DB_ID, COL_ID, doc.$id, {
          last_ip: currentIp,
          locked:  true,
        });
        locked = true;
        console.warn(`[auth] IP change! ${discordUser.username} original=${doc.original_ip} current=${currentIp} LOCKED`);

      } else {
        // Normal returning login
        await db.updateDocument(DB_ID, COL_ID, doc.$id, {
          last_ip:          currentIp,
          discord_username: discordUser.username,
          discord_avatar:   discordUser.avatar || '',
          email:            discordUser.email  || '',
          timezone,
        });
      }
    }
  } catch (err) {
    console.error('[auth] Appwrite error:', err.message, err.code, err.response);
    return res.status(500).json({
      error:  'Database operation failed.',
      detail: err.message,
      code:   err.code,
    });
  }

  // 5. Set session cookie
  const sessionToken = signSession({
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
    ip:       currentIp,
    iat:      Date.now(),
  });

  res.setHeader('Set-Cookie',
    `nc_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`
  );

  return res.status(200).json({
    id:       discordUser.id,
    username: discordUser.username,
    avatar:   discordUser.avatar || '',
    locked,
  });
}
