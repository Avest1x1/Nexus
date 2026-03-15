// api/profile.js
// Returns the full profile for the currently logged-in user.
// Hits Appwrite to get email, contributor flag, and asset counts
// which are not stored in the session cookie.

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
  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  if (session.locked) return res.status(200).json({ locked: true });

  try {
    var db    = getDb();
    var DB_ID = process.env.APPWRITE_DB_ID;
    var COL   = process.env.APPWRITE_COLLECTION_ID;

    var result = await db.listDocuments(DB_ID, COL, [
      Query.equal('discord_id', session.id),
    ]);

    if (result.total === 0) {
      return res.status(404).json({ error: 'User not found in database.' });
    }

    var row = result.documents[0];

    // if the row is locked, report that cleanly
    if (row.locked) {
      return res.status(200).json({ locked: true });
    }

    return res.status(200).json({
      id:            row.discord_id,
      username:      row.discord_username,
      avatar:        row.discord_avatar  || '',
      email:         row.email           || '',
      membership:    row.membership      || 'default',
      contributor:   row.contributor     || false,
      is_admin:      row.is_admin        || false,
      assets_posted: row.assets_posted   || 0,
      assets_shared: row.assets_shared   || 0,
    });

  } catch (err) {
    console.error('[profile] DB error:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }
}
