// api/asset-get.js
// Returns full asset data including mega link, key, description, code block.
// Only fires if the requester has view permission for the asset's section.
// Permission is re-verified from the DB on every request — never trust cache.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

var TIER_RANK = { default: 0, member: 1, trusted: 2, highly_trusted: 3, mommys_favorite: 4 };

function atLeast(mem, req) {
  return (TIER_RANK[mem] || 0) >= (TIER_RANK[req] || 0);
}

function canViewFull(user, section) {
  if (user.is_admin) return true;
  switch (section) {
    case 'community':   return atLeast(user.membership, 'trusted') || user.contributor;
    case 'contributor': return user.contributor === true || atLeast(user.membership, 'mommys_favorite');
    case 'official':    return atLeast(user.membership, 'highly_trusted');
    default: return false;
  }
}

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
  if (req.method !== 'GET') return res.status(405).end();

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

  // Re-verify user from DB
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

  // Check view permission for this section
  var viewer = {
    id:          userRow.discord_id,
    membership:  userRow.membership,
    contributor: userRow.contributor || false,
    is_admin:    userRow.is_admin    || false,
  };

  if (!canViewFull(viewer, assetDoc.section)) {
    return res.status(403).json({ error: 'Insufficient access tier for this section.' });
  }

  // Return full asset data
  return res.status(200).json({
    id:             assetDoc.$id,
    title:          assetDoc.title,
    card_desc:      assetDoc.card_desc,
    section:        assetDoc.section,
    created_by_id:  assetDoc.created_by_id,
    created_by_name: assetDoc.created_by_name,
    created_at:     assetDoc.$createdAt,
    description:    assetDoc.description     || '',
    mega_link:      assetDoc.mega_link       || '',
    mega_key:       assetDoc.mega_key        || '',
    external_links: assetDoc.external_links  || '[]',
    code_block:     assetDoc.code_block      || '',
  });
}
