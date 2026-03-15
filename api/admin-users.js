// api/admin-users.js
// Two views depending on ?view= query param:
//   ?view=users   (default) — returns all user rows
//   ?view=assets  — returns all assets with their full viewer lists
// Both require is_admin=true verified from DB.

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

function getDb() {
  var client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

async function fetchAll(db, dbId, colId, extraQueries) {
  var all = [], offset = 0;
  while (true) {
    var batch = await db.listDocuments(dbId, colId, [
      Query.limit(100),
      Query.offset(offset),
      Query.orderDesc('$createdAt'),
      ...(extraQueries || []),
    ]);
    all = all.concat(batch.documents);
    if (all.length >= batch.total) break;
    offset += 100;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  var db         = getDb();
  var DB_ID      = process.env.APPWRITE_DB_ID;
  var USERS_COL  = process.env.APPWRITE_COLLECTION_ID;
  var ASSETS_COL = process.env.APPWRITE_ASSETS_COL_ID;
  var VIEWS_COL  = process.env.APPWRITE_VIEWS_COL_ID || '';

  // Always re-verify admin from DB
  var requesterResult;
  try {
    requesterResult = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
  } catch (err) {
    console.error('[admin-users] DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }

  if (requesterResult.total === 0) return res.status(401).json({ error: 'User not found.' });
  var requester = requesterResult.documents[0];
  if (!requester.is_admin) return res.status(403).json({ error: 'Forbidden.' });

  var view = (req.query.view || 'users');

  // ── VIEW: USERS ────────────────────────────────────────────
  if (view === 'users') {
    var allUsers;
    try {
      allUsers = await fetchAll(db, DB_ID, USERS_COL);
    } catch (err) {
      console.error('[admin-users] fetch all failed:', err.message);
      return res.status(500).json({ error: 'Could not fetch users.' });
    }

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

  // ── VIEW: ASSETS ───────────────────────────────────────────
  if (view === 'assets') {
    if (!ASSETS_COL) return res.status(200).json({ assets: [] });

    var allAssets, allViews;
    try {
      [allAssets, allViews] = await Promise.all([
        fetchAll(db, DB_ID, ASSETS_COL),
        VIEWS_COL ? fetchAll(db, DB_ID, VIEWS_COL) : Promise.resolve([]),
      ]);
    } catch (err) {
      console.error('[admin-users] assets fetch failed:', err.message);
      return res.status(500).json({ error: 'Could not fetch assets.' });
    }

    // Group views by asset_id
    var viewsByAsset = {};
    allViews.forEach(function(v) {
      if (!viewsByAsset[v.asset_id]) viewsByAsset[v.asset_id] = [];
      viewsByAsset[v.asset_id].push({
        viewer_id:   v.viewer_id,
        viewer_name: v.viewer_name,
        opened_mega: v.opened_mega || false,
        user_agent:  v.user_agent  || '',
        viewed_at:   v.$createdAt,
      });
    });

    var assets = allAssets.map(function(a) {
      var viewers = viewsByAsset[a.$id] || [];
      return {
        id:              a.$id,
        title:           a.title,
        section:         a.section,
        created_by_id:   a.created_by_id,
        created_by_name: a.created_by_name,
        created_at:      a.$createdAt,
        view_count:      viewers.length,
        mega_clicks:     viewers.filter(function(v) { return v.opened_mega; }).length,
        viewers:         viewers,
      };
    });

    return res.status(200).json({ assets: assets });
  }

  return res.status(400).json({ error: 'Unknown view.' });
}
