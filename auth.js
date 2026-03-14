// api/me.js
import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

function verifySession(token) {
  try {
    var parts   = token.split('.');
    var payload = parts[0];
    var sig     = parts[1];
    var expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
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
  var client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
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

  // Admins skip IP check entirely
  if (session.is_admin) {
    return res.status(200).json({
      id:         session.id,
      username:   session.username,
      avatar:     session.avatar,
      locked:     false,
      membership: session.membership,
      is_admin:   true,
    });
  }

  // Live IP drift check for regular users
  var currentIp = getIp(req);

  if (session.ip !== currentIp && session.ip !== 'unknown' && currentIp !== 'unknown') {
    try {
      var db     = getDb();
      var DB_ID  = process.env.APPWRITE_DB_ID;
      var COL_ID = process.env.APPWRITE_COLLECTION_ID;

      var result = await db.listDocuments(DB_ID, COL_ID, [
        Query.equal('discord_id', session.id),
      ]);

      if (result.total > 0 && !result.documents[0].locked) {
        await db.updateDocument(DB_ID, COL_ID, result.documents[0].$id, {
          last_ip: currentIp,
          locked:  true,
        });
        console.warn('[me] IP drift! ' + session.username +
          ' session=' + session.ip + ' current=' + currentIp + ' LOCKED');
      }
    } catch (err) {
      console.error('[me] Lock error:', err.message);
    }

    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(200).json({ locked: true });
  }

  return res.status(200).json({
    id:         session.id,
    username:   session.username,
    avatar:     session.avatar,
    locked:     false,
    membership: session.membership || 'default',
    is_admin:   false,
  });
}
