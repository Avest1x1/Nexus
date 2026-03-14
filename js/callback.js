/* ═══════════════════════════════════════════════════
   NEXUS COLLECTIVE — callback.js
   Runs on /callback.html after Discord OAuth redirect.
   Sends the ?code= to /api/auth, reads the result,
   stores safe data, then redirects home.
   ═══════════════════════════════════════════════════ */

'use strict';

const params  = new URLSearchParams(window.location.search);
const code    = params.get('code');
const error   = params.get('error');

const msgEl   = document.getElementById('status-msg');
const subEl   = document.getElementById('status-sub');
const spinner = document.getElementById('spinner');

(async function run() {

  /* Discord declined / user cancelled */
  if (error) {
    setStatus('CANCELLED', 'You declined the authorization request.', true);
    redirectHome(2500);
    return;
  }

  if (!code) {
    setStatus('ERROR', 'No authorization code found.', true);
    redirectHome(2500);
    return;
  }

  /* Exchange code for session via serverless function */
  try {
    const res  = await fetch(`/api/auth?code=${encodeURIComponent(code)}`, {
      credentials: 'include',
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus('FAILED', data.error || 'Authentication error.', true);
      redirectHome(3000);
      return;
    }

    if (data.locked) {
      /* Locked account — don't store any data, redirect to lock screen */
      sessionStorage.setItem('nc_locked', '1');
      setStatus('LOCKED', 'IP change detected. Account suspended.', true);
      redirectHome(2500);
      return;
    }

    /* Store safe non-sensitive data for instant UI render */
    sessionStorage.setItem('nc_user', JSON.stringify({
      id:       data.id,
      username: data.username,
      avatar:   data.avatar,
      locked:   false,
    }));

    setStatus('VERIFIED', `Welcome, ${data.username}`, false);
    redirectHome(1500);

  } catch (err) {
    console.error(err);
    setStatus('ERROR', 'Could not reach the server.', true);
    redirectHome(3000);
  }
})();

/* ── Helpers ──────────────────────────────────────── */
function setStatus(title, sub, isError) {
  msgEl.textContent = title;
  subEl.textContent = sub;
  if (isError) {
    msgEl.style.color = '#ff4444';
    spinner.style.borderTopColor = '#ff4444';
    spinner.style.filter = 'drop-shadow(0 0 8px rgba(255,68,68,0.5))';
  } else {
    msgEl.style.color = 'var(--purple)';
  }
}

function redirectHome(delay) {
  setTimeout(() => {
    window.location.href = '/';
  }, delay);
}
