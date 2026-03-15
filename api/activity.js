// api/activity.js
// Called silently from any non-index page (profile, assets, etc.)
// when a logged-in user is active. Updates last_ip and timezone in the DB
// without triggering any locking logic — that stays in auth.js and me.js.
// If there's no session, it just returns 204 silently.

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
  if (req.method !== 'POST') return res.status(405).end();

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];

  // No session = not logged in, just bail silently
  if (!token) return res.status(204).end();

  var session = verifySession(token);
  if (!session || session.locked) return res.status(204).end();

  var currentIp = getIp(req);
  var timezone  = req.headers['x-timezone'] || '';

  // Nothing useful to record, skip the DB write
  if (currentIp === 'unknown' && !timezone) return res.status(204).end();

  try {
    var db    = getDb();
    var DB_ID = process.env.APPWRITE_DB_ID;
    var COL   = process.env.APPWRITE_COLLECTION_ID;

    var result = await db.listDocuments(DB_ID, COL, [
      Query.equal('discord_id', session.id),
    ]);

    if (result.total === 0) return res.status(204).end();

    var doc    = result.documents[0];
    var update = {};

    // admins never get their real IP logged
    var recordedIp = doc.is_admin ? 'i love girls' : currentIp;

    if (recordedIp !== 'unknown') update.last_ip  = recordedIp;
    if (timezone)                 update.timezone = timezone;

    // Only write if something actually changed — skip useless DB ops
    var changed =
      (update.last_ip  && update.last_ip  !== doc.last_ip)  ||
      (update.timezone && update.timezone !== doc.timezone);

    if (changed) {
      await db.updateDocument(DB_ID, COL, doc.$id, update);
    }

  } catch (err) {
    // Never crash the page over an activity ping
    console.warn('[activity] DB update skipped:', err.message);
  }

  return res.status(204).end();
}
