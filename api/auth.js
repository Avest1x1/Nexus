// api/auth.js
import { Client, Databases, ID, Query } from 'node-appwrite';
import crypto from 'crypto';

function signSession(data) {
  var payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  var sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function getDb() {
  var client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

function getIp(req) {
  return req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';
}

export default async function handler(req, res) {
  var code = req.query.code;
  if (!code) return res.status(400).json({ error: 'Missing code.' });

  // 1. Exchange Discord code for token
  var tokenData;
  try {
    var tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code:          code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      }),
    });
    tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token exchange failed');
  } catch (err) {
    console.error('[auth] Token error:', err.message);
    return res.status(502).json({ error: 'Discord token exchange failed.', detail: err.message });
  }

  // 2. Fetch Discord user
  var discordUser;
  try {
    var userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    discordUser = await userRes.json();
    if (!userRes.ok) throw new Error(JSON.stringify(discordUser));
  } catch (err) {
    console.error('[auth] Discord user error:', err.message);
    return res.status(502).json({ error: 'Could not fetch Discord profile.', detail: err.message });
  }

  var currentIp = getIp(req);
  var timezone  = req.headers['x-timezone'] || 'unknown';
  var db        = getDb();
  var DB_ID     = process.env.APPWRITE_DB_ID;
  var COL_ID    = process.env.APPWRITE_COLLECTION_ID;
  var locked    = false;
  var membership = 'default';
  var isAdmin   = false;

  try {
    var result = await db.listDocuments(DB_ID, COL_ID, [
      Query.equal('discord_id', discordUser.id),
    ]);

    if (result.total === 0) {
      // New user — create record
      await db.createDocument(DB_ID, COL_ID, ID.unique(), {
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
        discord_avatar:   discordUser.avatar  || '',
        email:            discordUser.email   || '',
        phone:            discordUser.phone   || '',
        original_ip:      currentIp,
        last_ip:          currentIp,
        timezone:         timezone,
        contributor:      false,
        membership:       'default',
        is_admin:         false,
        locked:           false,
        tos_agreed:       true,
      });

    } else {
      var doc = result.documents[0];
      membership = doc.membership || 'default';
      isAdmin    = doc.is_admin   || false;

      if (doc.locked) {
        locked = true;

      } else if (isAdmin) {
        // Admins get a fake IP — we don't log real ones
        await db.updateDocument(DB_ID, COL_ID, doc.$id, {
          discord_username: discordUser.username,
          discord_avatar:   discordUser.avatar || '',
          email:            discordUser.email  || '',
          timezone:         timezone,
          last_ip:          'i love girls',
        });

      } else if (doc.original_ip && doc.original_ip !== 'unknown' && doc.original_ip !== currentIp) {
        // IP changed from original — lock account
        await db.updateDocument(DB_ID, COL_ID, doc.$id, {
          last_ip: currentIp,
          locked:  true,
        });
        locked = true;
        console.warn('[auth] IP change! ' + discordUser.username +
          ' original=' + doc.original_ip + ' current=' + currentIp + ' LOCKED');

      } else {
        // Normal returning user
        await db.updateDocument(DB_ID, COL_ID, doc.$id, {
          last_ip:          currentIp,
          discord_username: discordUser.username,
          discord_avatar:   discordUser.avatar || '',
          email:            discordUser.email  || '',
          timezone:         timezone,
        });
      }
    }
  } catch (err) {
    console.error('[auth] Appwrite error:', err.message, err.code);
    return res.status(500).json({ error: 'Database operation failed.', detail: err.message, code: err.code });
  }

  // Set session cookie
  var sessionToken = signSession({
    id:         discordUser.id,
    username:   discordUser.username,
    avatar:     discordUser.avatar || '',
    locked:     locked,
    membership: membership,
    is_admin:   isAdmin,
    ip:         isAdmin ? 'admin' : currentIp,
    iat:        Date.now(),
  });

  res.setHeader('Set-Cookie',
    'nc_session=' + sessionToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure'
  );

  return res.status(200).json({
    id:         discordUser.id,
    username:   discordUser.username,
    avatar:     discordUser.avatar || '',
    locked:     locked,
    membership: membership,
    is_admin:   isAdmin,
  });
}
