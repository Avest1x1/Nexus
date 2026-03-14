/* ═══════════════════════════════════════════════════════
   NEXUS COLLECTIVE — main.js
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─── Cursor ───────────────────────────────────────────── */
(function initCursor() {
  const dot  = document.getElementById('cur-dot');
  const ring = document.getElementById('cur-ring');
  if (!dot || !ring) return;

  let rx = 0, ry = 0;

  document.addEventListener('mousemove', e => {
    dot.style.left  = e.clientX + 'px';
    dot.style.top   = e.clientY + 'px';
    // ring lags behind
    rx += (e.clientX - rx) * 0.14;
    ry += (e.clientY - ry) * 0.14;
  }, { passive: true });

  // Smoother ring using rAF
  (function animRing() {
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animRing);
  })();

  document.querySelectorAll('a, button, label, input, [role="button"]').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('hov'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('hov'));
  });
})();

/* ─── Preloader ────────────────────────────────────────── */
window.addEventListener('load', () => {
  const pl = document.getElementById('preloader');
  if (pl) {
    setTimeout(() => pl.classList.add('done'), 250);
  }
});

/* ─── Year ─────────────────────────────────────────────── */
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ─── Session check on page load ───────────────────────── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupScrollWatch();

  // Fast path from sessionStorage
  const cached = sessionStorage.getItem('nc_user');
  if (cached) {
    try {
      const u = JSON.parse(cached);
      if (u.locked) { showLocked(); return; }
      showUser(u);
    } catch { /* fall through */ }
  }

  // Always verify with server
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) { sessionStorage.removeItem('nc_user'); return; }

    const user = await res.json();
    if (user.locked) {
      sessionStorage.removeItem('nc_user');
      showLocked();
      return;
    }

    sessionStorage.setItem('nc_user', JSON.stringify(user));
    showUser(user);
  } catch (err) {
    console.warn('[nexus] /api/me unreachable:', err.message);
  }
}

/* ─── Lock screen ──────────────────────────────────────── */
function showLocked() {
  // Full lock: hide everything, show lock screen
  const main = document.getElementById('hero');
  if (main) main.style.display = 'none';
  document.getElementById('lock-screen')?.classList.remove('hidden');
}

/* ─── Show logged-in state ─────────────────────────────── */
function showUser(user) {
  // Hide guest buttons
  const guestBtns = document.getElementById('hero-btns-guest');
  if (guestBtns) guestBtns.style.display = 'none';

  // Show nav user info
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.classList.remove('hidden');

  const uname = document.getElementById('nav-uname');
  if (uname) uname.textContent = user.username;

  // Set avatar
  const img = document.getElementById('nav-avatar-img');
  if (img) {
    if (user.avatar) {
      img.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
      img.width  = 28;
      img.height = 28;
    }
    // else keep default user icon
  }

  // Show appropriate notice based on membership
  // We only have locked check here; membership detail comes from Appwrite
  // For now show pending (default state after first login)
  const pending  = document.getElementById('notice-pending');
  if (pending) pending.classList.remove('hidden');
}

/* ─── TOS page-transform ───────────────────────────────── */
function openTos() {
  const check = document.getElementById('agree-check');
  if (check) { check.checked = false; check.disabled = true; }
  const btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = true;
  const hint = document.getElementById('tos-hint');
  if (hint) { hint.textContent = '↓ scroll to accept'; hint.classList.remove('done'); }

  document.getElementById('tos-section')?.classList.remove('tos-hidden');
  document.documentElement.classList.add('tos-open');

  requestAnimationFrame(() => {
    const sec = document.getElementById('tos-section');
    if (sec) {
      const y = sec.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  });
}

function closeTos() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    document.documentElement.classList.remove('tos-open');
    setTimeout(() => {
      document.getElementById('tos-section')?.classList.add('tos-hidden');
    }, 450);
  }, 300);
}

/* ─── Scroll watch to unlock checkbox ─────────────────── */
function setupScrollWatch() {
  let unlocked = false;
  window.addEventListener('scroll', () => {
    if (unlocked) return;
    const bar = document.getElementById('tos-accept');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.top < window.innerHeight - 30) {
      unlocked = true;
      const check = document.getElementById('agree-check');
      if (check) check.disabled = false;
      const hint = document.getElementById('tos-hint');
      if (hint) { hint.textContent = '✓ you may now accept'; hint.classList.add('done'); }
    }
  }, { passive: true });
}

/* ─── Checkbox ─────────────────────────────────────────── */
function onCheck(checkbox) {
  const btn = document.getElementById('btn-verify');
  if (btn) btn.disabled = !checkbox.checked;
}

/* ─── Discord auth ─────────────────────────────────────── */
function startDiscordAuth() {
  window.location.href = '/api/auth-redirect';
}

/* ─── Logout ───────────────────────────────────────────── */
async function logout() {
  sessionStorage.removeItem('nc_user');
  try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch {}
  window.location.reload();
}
