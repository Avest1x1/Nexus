/* ═══════════════════════════════════════════════════════════
   NEXUS COLLECTIVE — main.js
   Handles: session restore, lock screen, ToS page-transform,
   scroll-to-unlock, Discord OAuth redirect, logout.
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────── */
/*  INIT                                                       */
/* ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupScrollWatch();

  /* Fast path: cached safe user data from sessionStorage      */
  const cached = sessionStorage.getItem('nc_user');
  if (cached) {
    try {
      const user = JSON.parse(cached);
      if (user.locked) { showLockScreen(); return; }
      showUser(user);
    } catch { /* fall through to server check */ }
  }

  /* Always verify with server — catches IP changes            */
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) {
      sessionStorage.removeItem('nc_user');
      return; /* Not logged in — login UI already visible       */
    }

    const user = await res.json();

    if (user.locked) {
      sessionStorage.removeItem('nc_user');
      showLockScreen();
      return;
    }

    sessionStorage.setItem('nc_user', JSON.stringify(user));
    showUser(user);

  } catch (err) {
    console.warn('[nexus] Could not reach /api/me:', err.message);
  }
}

/* ─────────────────────────────────────────────────────────── */
/*  LOCK SCREEN                                                */
/* ─────────────────────────────────────────────────────────── */
function showLockScreen() {
  /* Hide everything, show lock — expose zero user data        */
  document.getElementById('page-wrapper').style.display = 'none';
  document.getElementById('lock-screen').classList.remove('hidden');
}

/* ─────────────────────────────────────────────────────────── */
/*  LOGGED-IN STATE                                            */
/* ─────────────────────────────────────────────────────────── */
function showUser(user) {
  document.getElementById('login-area').classList.add('hidden');
  document.getElementById('welcome-area').classList.remove('hidden');

  const nav = document.getElementById('top-nav');
  nav.classList.remove('hidden');

  document.getElementById('nav-username').textContent = user.username;

  const avatar = document.getElementById('nav-avatar');
  if (user.avatar) {
    avatar.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    avatar.alt = user.username;
  } else {
    /* Discord's default avatar is index-based off the user's ID */
    const idx = Number(BigInt(user.id) >> 22n) % 6;
    avatar.src = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    avatar.alt = user.username;
  }
}

/* ─────────────────────────────────────────────────────────── */
/*  TOS PAGE TRANSFORM                                         */
/*                                                             */
/*  openTos(): adds .tos-open to <html>, which:               */
/*    - enables vertical scroll on the page                    */
/*    - fades/slides the hero section up via CSS transition    */
/*    - reveals the ToS section below it                       */
/*  The browser then scrolls to the top of the ToS section.   */
/*                                                             */
/*  closeTos(): reverses everything and scrolls back to top.   */
/* ─────────────────────────────────────────────────────────── */
function openTos() {
  /* Reset checkbox and button state every time                */
  const check = document.getElementById('agree-check');
  check.checked  = false;
  check.disabled = true;
  document.getElementById('tos-confirm-btn').disabled = true;

  const hint = document.getElementById('scroll-hint');
  hint.textContent = '↓ Scroll to the bottom to accept';
  hint.classList.remove('done');

  /* Reveal ToS section (removes visibility:hidden)            */
  document.getElementById('tos-section').classList.remove('tos-hidden');

  /* Enable scrolling + trigger CSS transitions                */
  document.documentElement.classList.add('tos-open');

  /* Scroll so the ToS topbar is flush with the viewport top  */
  requestAnimationFrame(() => {
    const tosSection = document.getElementById('tos-section');
    const y = tosSection.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });
}

function closeTos() {
  /* Scroll back to top first, then after a tick remove .tos-open */
  window.scrollTo({ top: 0, behavior: 'smooth' });

  /* Wait for smooth scroll to mostly complete before hiding   */
  setTimeout(() => {
    document.documentElement.classList.remove('tos-open');
    /* Re-hide the ToS section after the CSS transition        */
    setTimeout(() => {
      document.getElementById('tos-section').classList.add('tos-hidden');
    }, 500);
  }, 350);
}

/* ─────────────────────────────────────────────────────────── */
/*  SCROLL DETECTION                                           */
/*  Watches the window scroll position. When the user has      */
/*  scrolled far enough that the ToS accept bar is visible,    */
/*  the checkbox unlocks.                                      */
/* ─────────────────────────────────────────────────────────── */
function setupScrollWatch() {
  let unlocked = false;

  window.addEventListener('scroll', () => {
    if (unlocked) return;

    const acceptBar = document.getElementById('tos-accept-bar');
    if (!acceptBar) return;

    const rect = acceptBar.getBoundingClientRect();
    /* Unlock when the top of the accept bar has entered the viewport */
    if (rect.top < window.innerHeight - 40) {
      unlocked = true;

      const check = document.getElementById('agree-check');
      check.disabled = false;

      const hint = document.getElementById('scroll-hint');
      hint.textContent = '✓ You may now accept';
      hint.classList.add('done');
    }
  }, { passive: true });
}

/* ─────────────────────────────────────────────────────────── */
/*  CHECKBOX                                                   */
/* ─────────────────────────────────────────────────────────── */
function onCheckChange(checkbox) {
  document.getElementById('tos-confirm-btn').disabled = !checkbox.checked;
}

/* ─────────────────────────────────────────────────────────── */
/*  DISCORD AUTH REDIRECT                                      */
/*  Server-side route builds the real OAuth URL so client_id  */
/*  and client_secret never touch the frontend.               */
/* ─────────────────────────────────────────────────────────── */
function startDiscordAuth() {
  window.location.href = '/api/auth-redirect';
}

/* ─────────────────────────────────────────────────────────── */
/*  LOGOUT                                                     */
/* ─────────────────────────────────────────────────────────── */
async function logout() {
  sessionStorage.removeItem('nc_user');
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch { /* best effort */ }
  window.location.reload();
}
