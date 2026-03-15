// api/admin-users.js
// Returns every user row for the admin dashboard.
// ONLY fires if the requester is is_admin=true IN THE DATABASE — not just
// in the session cookie. Cookie can be forged; DB can't.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

function verifySession(token) {
  try {
    var parts   = token.split('.');
    var payload = parts[0];
    var sig     = parts[1];
    var expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
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

function getDb() {
  var client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  // 1. Verify session signature
  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  // 2. Re-verify admin status from the actual DB — never trust the cookie alone
  var db    = getDb();
  var DB_ID = process.env.APPWRITE_DB_ID;
  var COL   = process.env.APPWRITE_COLLECTION_ID;

  var requesterResult;
  try {
    requesterResult = await db.listDocuments(DB_ID, COL, [
      Query.equal('discord_id', session.id),
    ]);
  } catch (err) {
    console.error('[admin-users] DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }

  if (requesterResult.total === 0) return res.status(401).json({ error: 'User not found.' });

  var requester = requesterResult.documents[0];
  if (!requester.is_admin) return res.status(403).json({ error: 'Forbidden.' });

  // 3. Fetch all users — paginate in batches of 100 to get everyone
  var allUsers = [];
  var offset   = 0;
  var limit    = 100;

  try {
    while (true) {
      var batch = await db.listDocuments(DB_ID, COL, [
        Query.limit(limit),
        Query.offset(offset),
        Query.orderDesc('$createdAt'),
      ]);
      allUsers = allUsers.concat(batch.documents);
      if (allUsers.length >= batch.total) break;
      offset += limit;
    }
  } catch (err) {
    console.error('[admin-users] Fetch all failed:', err.message);
    return res.status(500).json({ error: 'Could not fetch users.' });
  }

  // 4. Strip to only what the dashboard needs — no internal Appwrite fields
  var users = allUsers.map(function(u) {
    return {
      doc_id:           u.$id,
      discord_id:       u.discord_id,
      discord_username: u.discord_username,
      email:            u.email          || '',
      membership:       u.membership     || 'default',
      contributor:      u.contributor    || false,
      locked:           u.locked         || false,
      last_ip:          u.last_ip        || 'unknown',
      timezone:         u.timezone       || 'unknown',
      is_admin:         u.is_admin       || false,
    };
  });

  return res.status(200).json({ users: users });
}
