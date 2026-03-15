// api/asset-get.js
// Returns full asset data. Records a unique view (1 per user per asset) in
// asset_views. View recording is awaited in parallel with asset fetch so it
// doesn't add latency to the response.
//
// APPWRITE — new table required:  asset_views
//   Columns: asset_id (String 64 req), viewer_id (String 64 req),
//            viewer_name (String 128 req), opened_mega (Boolean default false),
//            user_agent (String 512 opt)
//   Index: create a regular index on asset_id for fast per-asset queries.
// Env var: APPWRITE_VIEWS_COL_ID = <your asset_views table ID>

import { Client, Databases, ID, Query } from 'node-appwrite';
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

// Record a unique view — silently no-ops if already recorded or views table not configured
async function recordView(db, dbId, viewsCol, userRow, assetId, ua) {
  if (!viewsCol) return;
  try {
    // Check if this user already has a view record for this asset
    var existing = await db.listDocuments(dbId, viewsCol, [
      Query.equal('asset_id',  assetId),
      Query.equal('viewer_id', userRow.discord_id),
      Query.limit(1),
    ]);
    if (existing.total > 0) return; // already counted
    await db.createDocument(dbId, viewsCol, ID.unique(), {
      asset_id:    assetId,
      viewer_id:   userRow.discord_id,
      viewer_name: userRow.discord_username,
      opened_mega: false,
      user_agent:  (ua || '').slice(0, 512),
    });
  } catch (err) {
    // Never break asset delivery over tracking failures
    console.warn('[asset-get] view record failed:', err.message);
  }
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
  var VIEWS_COL  = process.env.APPWRITE_VIEWS_COL_ID || '';

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

  // Fetch asset + record view in parallel
  var assetDoc;
  try {
    var [assetResult] = await Promise.all([
      db.getDocument(DB_ID, ASSETS_COL, assetId),
      recordView(db, DB_ID, VIEWS_COL, userRow, assetId, req.headers['user-agent']),
    ]);
    assetDoc = assetResult;
  } catch (err) {
    if (err.code === 404) return res.status(404).json({ error: 'Asset not found.' });
    return res.status(500).json({ error: 'Database error.' });
  }

  var viewer = {
    id:          userRow.discord_id,
    membership:  userRow.membership,
    contributor: userRow.contributor || false,
    is_admin:    userRow.is_admin    || false,
  };

  if (!canViewFull(viewer, assetDoc.section)) {
    return res.status(403).json({ error: 'Insufficient access tier for this section.' });
  }

  // Fetch view count + viewer list for this asset (admins get full list, others get count only)
  var viewCount   = 0;
  var viewerList  = [];
  if (VIEWS_COL) {
    try {
      var viewsResult = await db.listDocuments(DB_ID, VIEWS_COL, [
        Query.equal('asset_id', assetId),
        Query.limit(100),
      ]);
      viewCount = viewsResult.total;
      if (viewer.is_admin) {
        viewerList = viewsResult.documents.map(function(v) {
          return {
            viewer_id:   v.viewer_id,
            viewer_name: v.viewer_name,
            opened_mega: v.opened_mega || false,
            user_agent:  v.user_agent  || '',
            viewed_at:   v.$createdAt,
          };
        });
      }
    } catch (err) {
      console.warn('[asset-get] view count failed:', err.message);
    }
  }

  return res.status(200).json({
    id:              assetDoc.$id,
    title:           assetDoc.title,
    card_desc:       assetDoc.card_desc,
    section:         assetDoc.section,
    created_by_id:   assetDoc.created_by_id,
    created_by_name: assetDoc.created_by_name,
    created_at:      assetDoc.$createdAt,
    description:     assetDoc.description    || '',
    mega_link:       assetDoc.mega_link      || '',
    mega_key:        assetDoc.mega_key       || '',
    external_links:  assetDoc.external_links || '[]',
    code_block:      assetDoc.code_block     || '',
    view_count:      viewCount,
    viewer_list:     viewerList,
  });
}
