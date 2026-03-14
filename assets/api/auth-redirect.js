// api/auth-redirect.js
// Redirects the browser to Discord's OAuth2 authorization page.
// Client ID lives in env vars — never exposed to the frontend.

export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,  // e.g. https://yourdomain.com/api/auth
    response_type: 'code',
    scope:         'identify email',
    prompt:        'none',                             // skip re-auth if already authed
  });

  res.redirect(302, `https://discord.com/oauth2/authorize?${params.toString()}`);
}
