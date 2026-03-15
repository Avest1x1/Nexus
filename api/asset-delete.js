// api/asset-delete.js
// Deletes an asset.
// Creators can take down their own posts.
// Admins can delete any post.
// Nobody else can delete.

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
  return Object.fromEntries(
    (header || '').split(';').map(function(c) {
      var p = c.trim().split('=');
      return [p[0].trim(), decodeURIComponent(p.slice(1).join('='))];
    })
  );
}

function getDb() {
  return new Databases(new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY));
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end();

  var assetId = req.query.id;
  if (!assetId) return res.status(400).json({ error: 'Missing asset id.' });

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }
  if (session.locked) return res.status(403).json({ error: 'Account locked.' });

  var db         = getDb();
  var DB_ID      = process.env.APPWRITE_DB_ID;
  var USERS_COL  = process.env.APPWRITE_COLLECTION_ID;
  var ASSETS_COL = process.env.APPWRITE_ASSETS_COL_ID;

  // Re-verify user
  var userRow;
  try {
    var result = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
    if (result.total === 0) return res.status(401).json({ error: 'User not found.' });
    userRow = result.documents[0];
  } catch (err) {
    return res.status(500).json({ error: 'Database error.' });
  }

  if (userRow.locked) return res.status(403).json({ error: 'Account locked.' });

  // Fetch the asset
  var assetDoc;
  try {
    assetDoc = await db.getDocument(DB_ID, ASSETS_COL, assetId);
  } catch (err) {
    if (err.code === 404) return res.status(404).json({ error: 'Asset not found.' });
    return res.status(500).json({ error: 'Database error.' });
  }

  var isAdmin   = userRow.is_admin || false;
  var isCreator = assetDoc.created_by_id === userRow.discord_id;

  if (!isAdmin && !isCreator) {
    return res.status(403).json({ error: 'You can only remove your own posts.' });
  }

  try {
    await db.deleteDocument(DB_ID, ASSETS_COL, assetId);
    console.log('[asset-delete] ' + userRow.discord_username +
      ' deleted "' + assetDoc.title + '" (by ' + assetDoc.created_by_name + ')');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[asset-delete] write failed:', err.message);
    return res.status(500).json({ error: 'Delete failed.' });
  }
}
