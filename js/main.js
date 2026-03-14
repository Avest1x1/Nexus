/* NEXUS COLLECTIVE - main.js */
'use strict';

/* --- Cursor ------------------------------------------------
   The bug was: lerp only ran inside mousemove, so when the
   mouse stopped the rAF loop kept running but rx/ry never
   updated toward a new target. Fix: store mx/my as targets,
   lerp toward them every frame regardless of mouse movement. */
(function initCursor() {
  const dot  = document.getElementById('cur-dot');
  const ring = document.getElementById('cur-ring');
  if (!dot || !ring) return;

  let mx = 0, my = 0;
  let rx = 0, ry = 0;

  document.addEventListener('mousemove', function(e) {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  }, { passive: true });

  // Lerp ring toward mouse target every frame
  // Even when mouse is still it finishes converging
  (function loop() {
    rx += (mx - rx) * 0.12;
    ry += (my - ry) * 0.12;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(loop);
  })();

  // Hover expand
  document.querySelectorAll('a, button, label, input').forEach(function(el) {
    el.addEventListener('mouseenter', function() { document.body.classList.add('hov'); });
    el.addEventListener('mouseleave', function() { document.body.classList.remove('hov'); });
  });
})();

/* --- Preloader --------------------------------------------- */
window.addEventListener('load', function() {
  var pl = document.getElementById('preloader');
  if (pl) setTimeout(function() { pl.classList.add('done'); }, 250);
});

/* --- Year -------------------------------------------------- */
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* --- Session check on load --------------------------------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupScrollWatch();

  var cached = sessionStorage.getItem('nc_user');
  if (cached) {
    try {
      var u = JSON.parse(cached);
      if (u.locked) { showLocked(); return; }
      showUser(u);
    } catch(e) { /* fall through */ }
  }

  try {
    var res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) { sessionStorage.removeItem('nc_user'); return; }

    var user = await res.json();
    if (user.locked) {
      sessionStorage.removeItem('nc_user');
      showLocked();
      return;
    }

    sessionStorage.setItem('nc_user', JSON.stringify(user));
    showUser(user);
  } catch(err) {
    console.warn('[nexus] /api/me unreachable:', err.message);
  }
}

/* --- Lock screen ------------------------------------------- */
function showLocked() {
  var hero = document.getElementById('hero');
  if (hero) hero.style.display = 'none';
  var ls = document.getElementById('lock-screen');
  if (ls) ls.classList.remove('hidden');
}

/* --- Show logged-in state ---------------------------------- */
function showUser(user) {
  var guestBtns = document.getElementById('hero-btns-guest');
  if (guestBtns) guestBtns.style.display = 'none';

  var navUser = document.getElementById('nav-user');
  if (navUser) navUser.classList.remove('hidden');

  var uname = document.getElementById('nav-uname');
  if (uname) uname.textContent = user.username;

  var img = document.getElementById('nav-avatar-img');
  if (img && user.avatar) {
    img.src    = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
    img.width  = 28;
    img.height = 28;
    img.style.filter = 'none'; // real avatar - don't invert
  }

  var pending = document.getElementById('notice-pending');
  if (pending) pending.classList.remove('hidden');
}

/* --- ToS page-transform ------------------------------------ */
function openTos() {
  var check = document.getElementById('agree-check');
  if (check) { check.checked = false; check.disabled = true; }
  var btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = true;
  var hint = document.getElementById('tos-hint');
  if (hint) { hint.textContent = 'scroll to accept'; hint.classList.remove('done'); }

  var sec = document.getElementById('tos-section');
  if (sec) sec.classList.remove('tos-hidden');
  document.documentElement.classList.add('tos-open');

  requestAnimationFrame(function() {
    var s = document.getElementById('tos-section');
    if (s) {
      var y = s.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  });
}

function closeTos() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(function() {
    document.documentElement.classList.remove('tos-open');
    setTimeout(function() {
      var sec = document.getElementById('tos-section');
      if (sec) sec.classList.add('tos-hidden');
    }, 450);
  }, 300);
}

/* --- Scroll watch to unlock checkbox ----------------------- */
function setupScrollWatch() {
  var unlocked = false;
  window.addEventListener('scroll', function() {
    if (unlocked) return;
    var bar = document.getElementById('tos-accept');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    if (rect.top < window.innerHeight - 30) {
      unlocked = true;
      var check = document.getElementById('agree-check');
      if (check) check.disabled = false;
      var hint = document.getElementById('tos-hint');
      if (hint) { hint.textContent = 'you may now accept'; hint.classList.add('done'); }
    }
  }, { passive: true });
}

/* --- Checkbox ---------------------------------------------- */
function onCheck(checkbox) {
  var btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = !checkbox.checked;
}

/* --- Discord auth ------------------------------------------ */
function startDiscordAuth() {
  window.location.href = '/api/auth-redirect';
}

/* --- Logout ------------------------------------------------ */
async function logout() {
  sessionStorage.removeItem('nc_user');
  try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch(e) {}
  window.location.reload();
}
