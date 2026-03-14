// api/me.js
// Returns current user's safe data on page load.
// Uses the new Appwrite TablesDB API.
// Also does a live IP drift check — if IP changed since login,
// locks the account and returns nothing useful.

import { Client, TablesDB, Query } from 'node-appwrite';
import crypto from 'crypto';

/* ── Session verification ───────────────────────────────────── */
function verifySession(token) {
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* ── Cookie parser ─────────────────────────────────────────── */
function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...rest] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    })
  );
}

/* ── IP extraction ─────────────────────────────────────────── */
function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ── Appwrite client ───────────────────────────────────────── */
function getTablesDB() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new TablesDB(client);
}

/* ── Main handler ──────────────────────────────────────────── */
export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token   = cookies['nc_session'];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  // Already locked in session — fast path, no DB call
  if (session.locked) {
    return res.status(200).json({ locked: true });
  }

  // ── Live IP drift check on every page load ─────────────────
  const currentIp = getIp(req);

  if (session.ip !== currentIp && session.ip !== 'unknown' && currentIp !== 'unknown') {
    // IP drifted since this session was issued — lock in DB
    try {
      const db     = getTablesDB();
      const DB_ID  = process.env.APPWRITE_DB_ID;
      const TBL_ID = process.env.APPWRITE_TABLE_ID;

      const existing = await db.listRows({
        databaseId: DB_ID,
        tableId:    TBL_ID,
        queries:    [Query.equal('discord_id', session.id)],
      });

      if (existing.total > 0) {
        const row = existing.rows[0];
        if (!row.locked) {
          await db.updateRow({
            databaseId: DB_ID,
            tableId:    TBL_ID,
            rowId:      row.$id,
            data:       { last_ip: currentIp, locked: true },
          });
          console.warn(
            `[me] IP drift! User: ${session.username} | ` +
            `session_ip=${session.ip} | current=${currentIp} | LOCKED`
          );
        }
      }
    } catch (err) {
      console.error('[me] Lock update failed:', err.message);
    }

    // Clear session, return locked — expose zero user data
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(200).json({ locked: true });
  }

  // ── All good ────────────────────────────────────────────────
  return res.status(200).json({
    id:       session.id,
    username: session.username,
    avatar:   session.avatar,
    locked:   false,
  });
}
