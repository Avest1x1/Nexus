// api/profile.js
// Returns full profile for the logged-in user.
// Counts assets_posted live from the assets table.
// Counts assets_viewed live from the asset_views table.
// Returns new fingerprint fields: screen_res, browser_lang, browser_platform.

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
  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }
  if (session.locked) return res.status(200).json({ locked: true });

  var db         = getDb();
  var DB_ID      = process.env.APPWRITE_DB_ID;
  var USERS_COL  = process.env.APPWRITE_COLLECTION_ID;
  var ASSETS_COL = process.env.APPWRITE_ASSETS_COL_ID  || '';
  var VIEWS_COL  = process.env.APPWRITE_VIEWS_COL_ID   || '';

  try {
    var result = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
    if (result.total === 0) return res.status(404).json({ error: 'User not found.' });

    var row = result.documents[0];
    if (row.locked) return res.status(200).json({ locked: true });

    // Count assets this user has posted (live query — no stale counter)
    var assetsPosted = 0;
    if (ASSETS_COL) {
      try {
        var postedResult = await db.listDocuments(DB_ID, ASSETS_COL, [
          Query.equal('created_by_id', row.discord_id),
          Query.limit(1),
        ]);
        assetsPosted = postedResult.total;
      } catch (e) { /* assets table may not be set up yet */ }
    }

    // Count unique assets this user has viewed
    var assetsViewed = 0;
    if (VIEWS_COL) {
      try {
        var viewedResult = await db.listDocuments(DB_ID, VIEWS_COL, [
          Query.equal('viewer_id', row.discord_id),
          Query.limit(1),
        ]);
        assetsViewed = viewedResult.total;
      } catch (e) { /* views table may not be set up yet */ }
    }

    return res.status(200).json({
      id:               row.discord_id,
      username:         row.discord_username,
      avatar:           row.discord_avatar    || '',
      email:            row.email             || '',
      membership:       row.membership        || 'default',
      contributor:      row.contributor       || false,
      is_admin:         row.is_admin          || false,
      assets_posted:    assetsPosted,
      assets_viewed:    assetsViewed,
      // fingerprint fields
      last_ip:          row.last_ip           || 'unknown',
      timezone:         row.timezone          || 'unknown',
      screen_res:       row.screen_res        || '',
      browser_lang:     row.browser_lang      || '',
      browser_platform: row.browser_platform  || '',
      // account dates
      joined_at:        row.$createdAt        || '',
      last_seen:        row.$updatedAt        || '',
    });

  } catch (err) {
    console.error('[profile] DB error:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }
}
