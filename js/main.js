/* NEXUS COLLECTIVE - main.js */
'use strict';

/* ====================================================
   ENTRY ANIMATION
   Add class on body immediately, remove after tiny delay
   so CSS transition fires on load.
   ==================================================== */
document.documentElement.style.visibility = 'hidden';
document.body.classList.add('page-enter');

window.addEventListener('load', function() {
  document.documentElement.style.visibility = '';
  // One frame delay so the browser paints the initial state
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      document.body.classList.remove('page-enter');
    });
  });
});

/* ====================================================
   CURSOR — lerp runs every frame, mouse target stored
   ==================================================== */
var _mx = 0, _my = 0;
var _rx = 0, _ry = 0;
var _onUI = false;

(function initCursor() {
  var dot  = document.getElementById('cur-dot');
  var ring = document.getElementById('cur-ring');
  if (!dot || !ring) return;

  document.addEventListener('mousemove', function(e) {
    _mx = e.clientX;
    _my = e.clientY;
    dot.style.left = _mx + 'px';
    dot.style.top  = _my + 'px';
  }, { passive: true });

  (function loop() {
    _rx += (_mx - _rx) * 0.11;
    _ry += (_my - _ry) * 0.11;
    ring.style.left = _rx + 'px';
    ring.style.top  = _ry + 'px';
    requestAnimationFrame(loop);
  })();

  document.querySelectorAll('a, button, label, input').forEach(function(el) {
    el.addEventListener('mouseenter', function() { document.body.classList.add('hov'); _onUI = true;  });
    el.addEventListener('mouseleave', function() { document.body.classList.remove('hov'); _onUI = false; });
  });
})();

/* ====================================================
   PARTICLES — lightweight, throttled to ~30fps
   - Fixed pool, no dynamic allocation in the hot path
   - Canvas only redraws when needed
   - Click spawns temporary burst particles that decay
   ==================================================== */
(function initParticles() {
  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var W = 0, H = 0;
  var POOL_SIZE    = 55;   // fixed immortal particles
  var CONNECT_DIST = 120;
  var CONNECT_SQ   = CONNECT_DIST * CONNECT_DIST;
  var REPEL_DIST   = 90;
  var REPEL_SQ     = REPEL_DIST * REPEL_DIST;

  // Throttle to ~30fps
  var FPS_INTERVAL = 1000 / 30;
  var lastTick     = 0;

  // Separate arrays: immortal pool and temporary burst particles
  var pool  = [];
  var burst = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', function() {
    clearTimeout(resize._t);
    resize._t = setTimeout(resize, 150);
  });
  resize();

  // Particle object
  function makePart(x, y, isBurst) {
    return {
      x:  x !== undefined ? x : Math.random() * W,
      y:  y !== undefined ? y : Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r:  Math.random() * 1.4 + 0.5,
      life: 1,
      decay: isBurst ? 0.012 + Math.random() * 0.008 : 0,
    };
  }

  for (var i = 0; i < POOL_SIZE; i++) pool.push(makePart());

  // Click on background = burst (only if not on UI)
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('click', function(e) {
    if (_onUI) return;
    for (var b = 0; b < 7; b++) {
      var p = makePart(e.clientX, e.clientY, true);
      p.vx = (Math.random() - 0.5) * 2.2;
      p.vy = (Math.random() - 0.5) * 2.2;
      burst.push(p);
    }
  });

  function updateParticle(p, isDying) {
    // Cursor repulsion
    var dx   = p.x - _mx;
    var dy   = p.y - _my;
    var distSq = dx*dx + dy*dy;

    if (distSq < REPEL_SQ && distSq > 0) {
      var dist  = Math.sqrt(distSq);
      var force = (REPEL_DIST - dist) / REPEL_DIST * 0.55;
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }

    p.vx *= 0.975;
    p.vy *= 0.975;
    p.x  += p.vx;
    p.y  += p.vy;

    if (!isDying) {
      // Wrap edges for immortal particles
      if (p.x < -5)  p.x = W + 5;
      if (p.x > W+5) p.x = -5;
      if (p.y < -5)  p.y = H + 5;
      if (p.y > H+5) p.y = -5;
    } else {
      p.life -= p.decay;
    }
  }

  function drawDot(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 6.283);
    ctx.fillStyle = 'rgba(180,60,220,' + (0.45 * p.life) + ')';
    ctx.fill();
  }

  // Build combined list for line drawing
  var allParts = [];

  function tick(now) {
    requestAnimationFrame(tick);

    var elapsed = now - lastTick;
    if (elapsed < FPS_INTERVAL) return;
    lastTick = now - (elapsed % FPS_INTERVAL);

    ctx.clearRect(0, 0, W, H);

    // Update pool
    for (var i = 0; i < pool.length; i++) updateParticle(pool[i], false);

    // Update burst, remove dead
    for (var j = burst.length - 1; j >= 0; j--) {
      updateParticle(burst[j], true);
      if (burst[j].life <= 0) burst.splice(j, 1);
    }

    // Combine for line checks
    allParts.length = 0;
    for (var a = 0; a < pool.length;  a++) allParts.push(pool[a]);
    for (var b = 0; b < burst.length; b++) allParts.push(burst[b]);

    var len = allParts.length;

    // Draw lines first (behind dots)
    for (var m = 0; m < len - 1; m++) {
      var pa = allParts[m];
      for (var n = m + 1; n < len; n++) {
        var pb  = allParts[n];
        var ddx = pa.x - pb.x;
        var ddy = pa.y - pb.y;
        var dsq = ddx*ddx + ddy*ddy;
        if (dsq < CONNECT_SQ) {
          var alpha = (1 - dsq / CONNECT_SQ) * 0.16 * pa.life * pb.life;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = 'rgba(180,60,220,' + alpha + ')';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    // Draw dots
    for (var k = 0; k < len; k++) drawDot(allParts[k]);
  }

  requestAnimationFrame(tick);
})();

/* ====================================================
   PRELOADER
   ==================================================== */
window.addEventListener('load', function() {
  var pl = document.getElementById('preloader');
  if (pl) setTimeout(function() { pl.classList.add('done'); }, 200);
});

/* ====================================================
   YEAR
   ==================================================== */
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ====================================================
   REVEAL ON SCROLL
   ==================================================== */
(function() {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  els.forEach(function(el) { obs.observe(el); });
})();

/* ====================================================
   SESSION CHECK
   ==================================================== */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupScrollWatch();

  if (sessionStorage.getItem('nc_locked') === '1') {
    showLockOverlay(null); return;
  }

  var cached = sessionStorage.getItem('nc_user');
  if (cached) {
    try {
      var u = JSON.parse(cached);
      if (u.locked) { showLockOverlay(u); return; }
      renderUserState(u);
    } catch(e) {}
  }

  try {
    var res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) { sessionStorage.removeItem('nc_user'); return; }
    var user = await res.json();
    if (user.locked) {
      sessionStorage.removeItem('nc_user');
      sessionStorage.setItem('nc_locked', '1');
      showLockOverlay(user); return;
    }
    sessionStorage.setItem('nc_user', JSON.stringify(user));
    renderUserState(user);
  } catch(err) {
    console.warn('[nexus] /api/me:', err.message);
  }
}

/* ====================================================
   LOCK OVERLAY
   ==================================================== */
function showLockOverlay(user) {
  var overlay = document.getElementById('lock-overlay');
  if (overlay) overlay.classList.remove('hidden');
  if (user && user.id) {
    var uid = document.getElementById('lock-uid');
    if (uid) uid.textContent = 'Account ID: ' + user.id;
  }
}

/* ====================================================
   RENDER USER STATE
   ==================================================== */
function renderUserState(user) {
  var navUser = document.getElementById('nav-user');
  if (navUser) navUser.classList.remove('hidden');

  var uname = document.getElementById('nav-uname');
  if (uname) uname.textContent = user.username;

  var img = document.getElementById('nav-avatar-img');
  if (img && user.avatar) {
    img.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
    img.width  = 28; img.height = 28;
    img.style.width  = '28px';
    img.style.height = '28px';
  }

  var badge = document.getElementById('nav-role');
  if (badge) {
    // Show badge for admins regardless of membership, and for non-default members
    if (user.is_admin) {
      badge.textContent = 'ADMIN';
      badge.classList.remove('hidden');
      badge.classList.add('admin');
    } else if (user.membership && user.membership !== 'default') {
      badge.textContent = user.membership === 'mommys_favorite' ? "MOM'S FAV"
        : user.membership.replace(/_/g,' ').toUpperCase();
      badge.classList.remove('hidden');
      badge.classList.add('member');
    }
  }

  // Always reset all state cards first so stale cache never stacks
  var guest    = document.getElementById('state-guest');
  var pending  = document.getElementById('state-pending');
  var approved = document.getElementById('state-approved');
  if (guest)    guest.style.display = 'none';
  if (pending)  pending.classList.add('hidden');
  if (approved) approved.classList.add('hidden');

  // Now show exactly one
  if (user.is_admin || (user.membership && user.membership !== 'default')) {
    if (approved) approved.classList.remove('hidden');
  } else {
    if (pending) pending.classList.remove('hidden');
  }
}

/* ====================================================
   TOS TRANSFORM
   ==================================================== */
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
    if (s) window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY, behavior: 'smooth' });
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

function setupScrollWatch() {
  var unlocked = false;
  window.addEventListener('scroll', function() {
    if (unlocked) return;
    var bar = document.getElementById('tos-accept');
    if (!bar) return;
    if (bar.getBoundingClientRect().top < window.innerHeight - 30) {
      unlocked = true;
      var check = document.getElementById('agree-check');
      if (check) check.disabled = false;
      var hint = document.getElementById('tos-hint');
      if (hint) { hint.textContent = 'you may now accept'; hint.classList.add('done'); }
    }
  }, { passive: true });
}

function onCheck(checkbox) {
  var btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = !checkbox.checked;
}

function startDiscordAuth() { window.location.href = '/api/auth-redirect'; }

async function logout() {
  sessionStorage.clear();
  try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch(e) {}
  window.location.reload();
}
