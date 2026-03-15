/* NEXUS COLLECTIVE - profile.js */
'use strict';

/* ====================================================
   TIER CONFIG
   Maps membership string values to display labels,
   colors, and ordering for the tier track.
   ==================================================== */
var TIERS = [
  { key: 'default',        label: 'PENDING',       color: 'var(--gold)'    },
  { key: 'member',         label: 'MEMBER',        color: 'var(--green)'   },
  { key: 'trusted',        label: 'TRUSTED',       color: 'var(--blue)'    },
  { key: 'highly_trusted', label: 'HIGHLY TRUSTED', color: 'var(--accent2)' },
  { key: 'mommys_favorite',label: "MOM'S FAV",     color: 'var(--accent)'  },
];

/* ====================================================
   INIT
   ==================================================== */
document.addEventListener('DOMContentLoaded', function() {
  loadProfile();
});

async function loadProfile() {
  try {
    var res = await fetch('/api/profile', { credentials: 'include' });

    // not logged in at all
    if (res.status === 401) {
      showGate();
      return;
    }

    var data = await res.json();

    // session exists but account is locked, kick home
    if (data.locked) {
      sessionStorage.removeItem('nc_user');
      sessionStorage.setItem('nc_locked', '1');
      window.location.href = '/';
      return;
    }

    showProfile(data);
  } catch (err) {
    console.warn('[nexus/profile] fetch failed:', err.message);
    showGate();
  }
}

/* ====================================================
   SHOW GATE (not logged in)
   ==================================================== */
function showGate() {
  hide('profile-loading');
  show('profile-gate');
}

/* ====================================================
   RENDER PROFILE
   ==================================================== */
function showProfile(user) {
  hide('profile-loading');
  show('profile-wrap');

  // -- nav (reuses renderUserState from main.js)
  renderUserState(user);

  // -- avatar
  var avatarImg = document.getElementById('profile-avatar');
  var ring      = document.getElementById('profile-avatar-ring');

  if (user.avatar) {
    avatarImg.src    = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    avatarImg.width  = 88;
    avatarImg.height = 88;
    avatarImg.style.width  = '88px';
    avatarImg.style.height = '88px';
    avatarImg.style.objectFit = 'cover';
    avatarImg.style.borderRadius = '50%';
  }

  // ring color matches membership
  var tierData = getTierData(user.membership);
  if (ring) ring.style.borderColor = tierData.color;

  // -- username
  setText('profile-username', user.username || '—');

  // -- badges
  var badgeRow = document.getElementById('profile-badge-row');
  if (badgeRow) {
    badgeRow.innerHTML = '';

    // membership badge
    var memBadge = makeBadge(tierData.label, tierData.color);
    badgeRow.appendChild(memBadge);

    // contributor badge
    if (user.contributor) {
      var cBadge = makeBadge('CONTRIBUTOR', 'var(--accent)');
      badgeRow.appendChild(cBadge);
    }

    // admin badge
    if (user.is_admin) {
      var aBadge = makeBadge('ADMIN', 'var(--gold)');
      badgeRow.appendChild(aBadge);
    }
  }

  // -- stats
  setText('stat-assets', user.assets_posted || 0);
  setText('stat-shared',  user.assets_shared || 0);
  setText('stat-contrib', user.contributor ? 'YES' : 'NO');

  var contribEl = document.getElementById('stat-contrib');
  if (contribEl) {
    contribEl.style.color = user.contributor ? 'var(--green)' : 'var(--muted)';
  }

  // -- info cells
  setText('info-discord',    user.username || '—');
  setText('info-email',      user.email    || 'not on file');
  setText('info-discord-id', user.id       || '—');

  var membershipEl = document.getElementById('info-membership');
  if (membershipEl) {
    membershipEl.textContent = tierData.label;
    membershipEl.style.color = tierData.color;
  }

  // -- tier track
  renderTierTrack(user.membership);
}

/* ====================================================
   TIER TRACK
   Shows all tiers as a horizontal chain, lights up
   the current one and everything below it.
   ==================================================== */
function renderTierTrack(current) {
  var track = document.getElementById('tier-track');
  if (!track) return;

  var currentIdx = TIERS.findIndex(function(t) { return t.key === current; });
  if (currentIdx === -1) currentIdx = 0;

  track.innerHTML = '';

  TIERS.forEach(function(tier, i) {
    // tier node
    var node = document.createElement('div');
    node.className = 'tier-node' + (i <= currentIdx ? ' tier-node-active' : '');

    var dot = document.createElement('div');
    dot.className = 'tier-dot';
    if (i <= currentIdx) dot.style.background = tier.color;
    if (i === currentIdx) dot.classList.add('tier-dot-current');

    var label = document.createElement('div');
    label.className = 'tier-node-label';
    label.textContent = tier.label;
    if (i <= currentIdx) label.style.color = tier.color;
    if (i === currentIdx) label.style.fontWeight = '700';

    node.appendChild(dot);
    node.appendChild(label);
    track.appendChild(node);

    // connector line between nodes
    if (i < TIERS.length - 1) {
      var line = document.createElement('div');
      line.className = 'tier-line' + (i < currentIdx ? ' tier-line-active' : '');
      track.appendChild(line);
    }
  });
}

/* ====================================================
   HELPERS
   ==================================================== */
function getTierData(membership) {
  return TIERS.find(function(t) { return t.key === membership; }) || TIERS[0];
}

function makeBadge(text, color) {
  var span = document.createElement('span');
  span.className = 'profile-badge';
  span.textContent = text;
  span.style.borderColor = color;
  span.style.color = color;
  return span;
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function show(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hide(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
