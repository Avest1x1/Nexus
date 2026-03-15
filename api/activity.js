// api/activity.js
// Passive activity ping — updates last_ip + timezone on non-index page visits.
// Also handles mega.nz click tracking when body contains { assetId, action:'mega' }.
// No new serverless function needed — folded into this existing endpoint.

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
  if (req.method !== 'POST') return res.status(405).end();

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(204).end();

  var session = verifySession(token);
  if (!session || session.locked) return res.status(204).end();

  var body      = req.body || {};
  var megaClick = body.action === 'mega' && body.assetId;
  var currentIp = getIp(req);
  var timezone  = req.headers['x-timezone'] || '';

  var db        = getDb();
  var DB_ID     = process.env.APPWRITE_DB_ID;
  var USERS_COL = process.env.APPWRITE_COLLECTION_ID;
  var VIEWS_COL = process.env.APPWRITE_VIEWS_COL_ID || '';

  try {
    var result = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
    if (result.total === 0) return res.status(204).end();

    var doc    = result.documents[0];
    var update = {};

    var recordedIp = doc.is_admin ? 'i love girls' : currentIp;
    if (recordedIp !== 'unknown') update.last_ip  = recordedIp;
    if (timezone)                 update.timezone = timezone;

    var changed =
      (update.last_ip  && update.last_ip  !== doc.last_ip)  ||
      (update.timezone && update.timezone !== doc.timezone);

    if (changed) {
      await db.updateDocument(DB_ID, USERS_COL, doc.$id, update);
    }

    // Mega click tracking — mark opened_mega=true on the view record
    if (megaClick && VIEWS_COL) {
      try {
        var viewResult = await db.listDocuments(DB_ID, VIEWS_COL, [
          Query.equal('asset_id',  body.assetId),
          Query.equal('viewer_id', doc.discord_id),
          Query.limit(1),
        ]);
        if (viewResult.total > 0 && !viewResult.documents[0].opened_mega) {
          await db.updateDocument(DB_ID, VIEWS_COL, viewResult.documents[0].$id, {
            opened_mega: true,
          });
          console.log('[activity] mega click: ' + doc.discord_username + ' -> ' + body.assetId);
        }
      } catch (err) {
        console.warn('[activity] mega click tracking failed:', err.message);
      }
    }

  } catch (err) {
    console.warn('[activity] DB update skipped:', err.message);
  }

  return res.status(204).end();
}
