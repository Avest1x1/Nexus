/* NEXUS COLLECTIVE - callback.js
   Runs on /callback.html after Discord sends the user back.
   Grabs the ?code= param, hits /api/auth, then redirects home. */

'use strict';

var titleEl  = document.getElementById('cb-title');
var subEl    = document.getElementById('cb-sub');
var spinner  = document.getElementById('cb-spinner');

var params = new URLSearchParams(window.location.search);
var code   = params.get('code');
var error  = params.get('error');

(async function run() {

  if (error) {
    setStatus('CANCELLED', 'You declined the request.', true);
    redirectHome(2000);
    return;
  }

  if (!code) {
    setStatus('ERROR', 'No auth code found.', true);
    redirectHome(2000);
    return;
  }

  try {
    var res  = await fetch('/api/auth?code=' + encodeURIComponent(code), {
      credentials: 'include',
    });
    var data = await res.json();

    if (!res.ok) {
      setStatus('FAILED', data.error || 'Auth error.', true);
      redirectHome(3000);
      return;
    }

    if (data.locked) {
      sessionStorage.setItem('nc_locked', '1');
      setStatus('LOCKED', 'IP change detected. Contact an admin.', true);
      redirectHome(2500);
      return;
    }

    // Store safe data so index.html renders instantly
    sessionStorage.setItem('nc_user', JSON.stringify({
      id:       data.id,
      username: data.username,
      avatar:   data.avatar,
      locked:   false,
    }));

    setStatus('VERIFIED', 'Welcome, ' + data.username, false);
    redirectHome(1200);

  } catch (err) {
    console.error('[callback]', err);
    setStatus('ERROR', 'Could not reach server.', true);
    redirectHome(3000);
  }

})();

function setStatus(title, sub, isError) {
  if (titleEl) {
    titleEl.textContent = title;
    titleEl.style.color = isError ? '#ff4f6b' : '#d44fff';
  }
  if (subEl) subEl.textContent = sub;
  if (spinner && isError) {
    spinner.style.borderTopColor = '#ff4f6b';
  }
}

function redirectHome(delay) {
  setTimeout(function() {
    window.location.href = '/';
  }, delay);
}
