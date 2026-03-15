// api/admin-update.js
// Updates a single field on a target user's row.
// Requires the requester to be is_admin=true (verified from DB, not cookie).
// The is_admin field can ONLY be changed by the platform owner —
// discord_id 1455278057190326315. Other admins hit a hard 403 on that field.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

// Platform owner — the only account that can grant/revoke admin status
var OWNER_ID = '1455278057190326315';

// Whitelist of editable fields and their type/allowed values
var FIELD_RULES = {
  membership: {
    type:    'string',
    allowed: ['default', 'member', 'trusted', 'highly_trusted', 'mommys_favorite'],
  },
  contributor: { type: 'boolean' },
  locked:      { type: 'boolean' },
  is_admin:    { type: 'boolean', ownerOnly: true },
};

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
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed.' });

  // 1. Verify session
  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  // 2. Parse body
  var targetId = req.body && req.body.targetId;
  var field    = req.body && req.body.field;
  var value    = req.body && req.body.value;

  if (!targetId || !field || value === undefined) {
    return res.status(400).json({ error: 'Missing targetId, field, or value.' });
  }

  // 3. Field whitelist check
  var rule = FIELD_RULES[field];
  if (!rule) return res.status(400).json({ error: 'Field "' + field + '" is not editable.' });

  // 4. Type check
  if (typeof value !== rule.type) {
    return res.status(400).json({ error: 'Invalid value type for "' + field + '".' });
  }

  // 5. Allowed values check (for membership)
  if (rule.allowed && !rule.allowed.includes(value)) {
    return res.status(400).json({ error: 'Invalid value "' + value + '" for "' + field + '".' });
  }

  // 6. Re-verify requester is admin from DB — never trust cookie alone
  var db    = getDb();
  var DB_ID = process.env.APPWRITE_DB_ID;
  var COL   = process.env.APPWRITE_COLLECTION_ID;

  var requesterResult;
  try {
    requesterResult = await db.listDocuments(DB_ID, COL, [
      Query.equal('discord_id', session.id),
    ]);
  } catch (err) {
    console.error('[admin-update] DB requester lookup:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }

  if (requesterResult.total === 0) return res.status(401).json({ error: 'User not found.' });

  var requester = requesterResult.documents[0];
  if (!requester.is_admin) return res.status(403).json({ error: 'Forbidden.' });

  // 7. Owner-only gate for is_admin
  if (rule.ownerOnly && requester.discord_id !== OWNER_ID) {
    return res.status(403).json({ error: 'Only the platform owner can modify admin status.' });
  }

  // 8. Fetch the target user
  var targetResult;
  try {
    targetResult = await db.listDocuments(DB_ID, COL, [
      Query.equal('discord_id', targetId),
    ]);
  } catch (err) {
    console.error('[admin-update] DB target lookup:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }

  if (targetResult.total === 0) return res.status(404).json({ error: 'Target user not found.' });

  var target = targetResult.documents[0];

  // 9. Write the update
  try {
    await db.updateDocument(DB_ID, COL, target.$id, { [field]: value });
  } catch (err) {
    console.error('[admin-update] Write failed:', err.message);
    return res.status(500).json({ error: 'Update failed.' });
  }

  console.log('[admin-update] ' + requester.discord_username +
    ' set ' + field + '=' + JSON.stringify(value) +
    ' on ' + target.discord_username);

  return res.status(200).json({ ok: true, field: field, value: value });
}
