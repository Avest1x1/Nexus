// api/debug-db.js
// Tests the Appwrite connection and returns verbose info.
// DELETE THIS FILE before going public — it exposes env var presence.

import { Client, Databases, Query } from 'node-appwrite';

export default async function handler(req, res) {
  const info = {
    env: {
      APPWRITE_ENDPOINT:      !!process.env.APPWRITE_ENDPOINT,
      APPWRITE_PROJECT_ID:    !!process.env.APPWRITE_PROJECT_ID,
      APPWRITE_API_KEY:       !!process.env.APPWRITE_API_KEY,
      APPWRITE_DB_ID:         !!process.env.APPWRITE_DB_ID,
      APPWRITE_COLLECTION_ID: !!process.env.APPWRITE_COLLECTION_ID,
      SESSION_SECRET:         !!process.env.SESSION_SECRET,
      DISCORD_CLIENT_ID:      !!process.env.DISCORD_CLIENT_ID,
      DISCORD_CLIENT_SECRET:  !!process.env.DISCORD_CLIENT_SECRET,
      DISCORD_REDIRECT_URI:   process.env.DISCORD_REDIRECT_URI || '(not set)',
    },
    db_test: null,
    ok: false,
  };

  // Check all required env vars are present
  const missing = Object.entries(info.env)
    .filter(([k, v]) => v === false)
    .map(([k]) => k);

  if (missing.length > 0) {
    return res.status(200).json({
      ...info,
      ok: false,
      error: `Missing env vars: ${missing.join(', ')}`,
    });
  }

  // Try a real Appwrite call
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const db = new Databases(client);

    const result = await db.listDocuments(
      process.env.APPWRITE_DB_ID,
      process.env.APPWRITE_COLLECTION_ID,
      [Query.limit(1)]
    );

    info.db_test = {
      status:          'connected',
      total_documents: result.total,
      documents_in_response: result.documents.length,
    };
    info.ok = true;

  } catch (err) {
    info.db_test = {
      status:  'error',
      message: err.message,
      code:    err.code,
      type:    err.type,
      response: err.response,
    };
    info.ok = false;
  }

  return res.status(200).json(info);
}
