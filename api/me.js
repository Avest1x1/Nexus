// api/me.js
// Always re-fetches membership, contributor, is_admin, and locked from the DB.
// This means admin changes take effect on next page load/refresh — no re-login needed.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

function verifySession(token) {
  try {
    var parts    = token.split('.');
    var expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(parts[0]).digest('base64url');
    if (parts[1] !== expected) return null;
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (e) { return null; }
}

function parseCookies(header) {
  header = header || '';
  return Object.fromEntries(
    header.split(';').map(function(c) {
      var parts = c.trim().split('=');
      var k = parts[0].trim();
      var v = decodeURIComponent(parts.slice(1).join('='));
      return [k, v];
    })
  );
}

function getIp(req) {
  return req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';
}

function getDb() {
  return new Databases(new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY));
}

export default async function handler(req, res) {
  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  if (session.locked) return res.status(200).json({ locked: true });

  // Always hit DB — membership/locked/is_admin can change at any time via admin dashboard
  var db     = getDb();
  var DB_ID  = process.env.APPWRITE_DB_ID;
  var COL_ID = process.env.APPWRITE_COLLECTION_ID;

  var result;
  try {
    result = await db.listDocuments(DB_ID, COL_ID, [
      Query.equal('discord_id', session.id),
    ]);
  } catch (err) {
    console.error('[me] DB error:', err.message);
    // Fall back to session data so the site doesn't break if DB is temporarily down
    return res.status(200).json({
      id:         session.id,
      username:   session.username,
      avatar:     session.avatar,
      locked:     false,
      membership: session.membership || 'default',
      is_admin:   session.is_admin   || false,
    });
  }

  if (result.total === 0) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'User not found.' });
  }

  var row = result.documents[0];

  // Account locked in DB
  if (row.locked) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(200).json({ locked: true });
  }

  // IP drift check — skip for admins
  if (!row.is_admin) {
    var currentIp = getIp(req);
    if (session.ip !== currentIp && session.ip !== 'unknown' && currentIp !== 'unknown') {
      try {
        await db.updateDocument(DB_ID, COL_ID, row.$id, {
          last_ip: currentIp,
          locked:  true,
        });
        console.warn('[me] IP drift! ' + row.discord_username +
          ' session=' + session.ip + ' current=' + currentIp + ' LOCKED');
      } catch (err) {
        console.error('[me] Lock error:', err.message);
      }
      res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
      return res.status(200).json({ locked: true });
    }
  }

  return res.status(200).json({
    id:         row.discord_id,
    username:   row.discord_username,
    avatar:     row.discord_avatar   || '',
    locked:     false,
    membership: row.membership       || 'default',
    contributor: row.contributor     || false,
    is_admin:   row.is_admin         || false,
  });
}
