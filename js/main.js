/* NEXUS COLLECTIVE - main.js */
'use strict';

/* ====================================================
   CURSOR
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
    _rx += (_mx - _rx) * 0.12;
    _ry += (_my - _ry) * 0.12;
    ring.style.left = _rx + 'px';
    ring.style.top  = _ry + 'px';
    requestAnimationFrame(loop);
  })();

  document.querySelectorAll('a, button, label, input, .about-card, .tier, .pill').forEach(function(el) {
    el.addEventListener('mouseenter', function() { document.body.classList.add('hov'); _onUI = true; });
    el.addEventListener('mouseleave', function() { document.body.classList.remove('hov'); _onUI = false; });
  });
})();

/* ====================================================
   PARTICLES — custom canvas system
   Lines connect nearby particles.
   Cursor REPELS particles when near.
   Clicking the background SPAWNS new particles.
   ==================================================== */
(function initParticles() {
  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var W, H;
  var particles = [];
  var PARTICLE_COUNT = 80;
  var CONNECT_DIST   = 130;
  var REPEL_DIST     = 100;
  var REPEL_FORCE    = 0.6;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resize);
  resize();

  function Particle(x, y) {
    this.x  = x  !== undefined ? x  : Math.random() * W;
    this.y  = y  !== undefined ? y  : Math.random() * H;
    this.vx = (Math.random() - 0.5) * 0.45;
    this.vy = (Math.random() - 0.5) * 0.45;
    this.r  = Math.random() * 1.5 + 0.5;
    this.life = 1; // for spawned particles
    this.decay = 0; // 0 = immortal, >0 = fades
  }

  // Spawn initial particles
  for (var i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  // Click on background spawns a burst of particles
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('click', function(e) {
    if (_onUI) return;
    for (var b = 0; b < 6; b++) {
      var p = new Particle(e.clientX, e.clientY);
      p.vx = (Math.random() - 0.5) * 2.5;
      p.vy = (Math.random() - 0.5) * 2.5;
      p.decay = 0.004;
      particles.push(p);
    }
  });

  function tick() {
    ctx.clearRect(0, 0, W, H);

    // Update + draw particles
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];

      // Cursor repulsion
      var dx = p.x - _mx;
      var dy = p.y - _my;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < REPEL_DIST && dist > 0) {
        var force = (REPEL_DIST - dist) / REPEL_DIST * REPEL_FORCE;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }

      // Damping so they don't fly off forever
      p.vx *= 0.98;
      p.vy *= 0.98;

      p.x += p.vx;
      p.y += p.vy;

      // Wrap edges for immortal particles
      if (p.decay === 0) {
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
      }

      // Fade decay particles
      if (p.decay > 0) {
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
      }

      // Draw dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180, 60, 220, ' + (0.5 * p.life) + ')';
      ctx.fill();
    }

    // Draw lines between close particles
    for (var a = 0; a < particles.length; a++) {
      for (var b = a + 1; b < particles.length; b++) {
        var pa = particles[a];
        var pb = particles[b];
        var ddx = pa.x - pb.x;
        var ddy = pa.y - pb.y;
        var d   = Math.sqrt(ddx * ddx + ddy * ddy);

        if (d < CONNECT_DIST) {
          var alpha = (1 - d / CONNECT_DIST) * 0.18 * pa.life * pb.life;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = 'rgba(180, 60, 220, ' + alpha + ')';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(tick);
  }

  tick();
})();

/* ====================================================
   PRELOADER
   ==================================================== */
window.addEventListener('load', function() {
  var pl = document.getElementById('preloader');
  if (pl) setTimeout(function() { pl.classList.add('done'); }, 280);
});

/* ====================================================
   YEAR
   ==================================================== */
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ====================================================
   REVEAL ON SCROLL
   ==================================================== */
(function initReveal() {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.12 });

  els.forEach(function(el) { obs.observe(el); });
})();

/* ====================================================
   SESSION CHECK
   ==================================================== */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupScrollWatch();

  // If a previous session flagged locked, show it immediately
  if (sessionStorage.getItem('nc_locked') === '1') {
    showLockOverlay(null);
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
      showLockOverlay(user);
      return;
    }

    sessionStorage.setItem('nc_user', JSON.stringify(user));
    renderUserState(user);
  } catch(err) {
    console.warn('[nexus] /api/me:', err.message);
  }
}

/* ====================================================
   LOCK OVERLAY
   Covers everything. Redirects all navigation here.
   ==================================================== */
function showLockOverlay(user) {
  var overlay = document.getElementById('lock-overlay');
  if (overlay) overlay.classList.remove('hidden');

  if (user && user.id) {
    var uid = document.getElementById('lock-uid');
    if (uid) uid.textContent = 'Account ID: ' + user.id;
  }

  // Block all navigation away
  window.addEventListener('beforeunload', function() {
    sessionStorage.setItem('nc_locked', '1');
  });
}

/* ====================================================
   RENDER LOGGED-IN STATE
   ==================================================== */
function renderUserState(user) {
  // Nav
  var navUser = document.getElementById('nav-user');
  if (navUser) navUser.classList.remove('hidden');

  var uname = document.getElementById('nav-uname');
  if (uname) uname.textContent = user.username;

  var img = document.getElementById('nav-avatar-img');
  if (img && user.avatar) {
    img.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
    img.classList.remove('default-icon');
    img.style.filter = 'none';
    img.width = 28; img.height = 28;
  }

  // Role badge
  var badge = document.getElementById('nav-role');
  if (badge && user.membership) {
    var m = user.membership;
    if (m !== 'default') {
      badge.textContent = m === 'mommys_favorite' ? "MOM'S FAV" : m.replace('_', ' ').toUpperCase();
      badge.classList.remove('hidden');
      if (user.is_admin) badge.classList.add('admin');
      else badge.classList.add('member');
    }
  }

  // Hero state
  var guest = document.getElementById('state-guest');
  if (guest) guest.style.display = 'none';

  var membership = user.membership || 'default';

  if (membership === 'default') {
    var pending = document.getElementById('state-pending');
    if (pending) pending.classList.remove('hidden');
  } else {
    var approved = document.getElementById('state-approved');
    if (approved) approved.classList.remove('hidden');
  }
}

/* ====================================================
   TOS PAGE TRANSFORM
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

/* ====================================================
   SCROLL WATCH — unlock checkbox at bottom
   ==================================================== */
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

/* ====================================================
   CHECKBOX / AUTH / LOGOUT
   ==================================================== */
function onCheck(checkbox) {
  var btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = !checkbox.checked;
}

function startDiscordAuth() {
  window.location.href = '/api/auth-redirect';
}

async function logout() {
  sessionStorage.clear();
  try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch(e) {}
  window.location.reload();
}
