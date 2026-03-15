/* NEXUS COLLECTIVE - profile.js */
'use strict';

/* ====================================================
   CONSTANTS
   ==================================================== */
var OWNER_ID = '1455278057190326315';

var TIERS = [
  { key: 'default',         label: 'PENDING',        color: 'var(--gold)'    },
  { key: 'member',          label: 'MEMBER',         color: 'var(--green)'   },
  { key: 'trusted',         label: 'TRUSTED',        color: 'var(--blue)'    },
  { key: 'highly_trusted',  label: 'HIGHLY TRUSTED', color: 'var(--accent2)' },
  { key: 'mommys_favorite', label: "MOM'S FAV",      color: 'var(--accent)'  },
];

// The viewer's discord_id — set once profile loads, used by dashboard
var _viewerId = null;

/* ====================================================
   BOOT
   ==================================================== */
document.addEventListener('DOMContentLoaded', function() {
  loadProfile();
});

async function loadProfile() {
  try {
    var res = await fetch('/api/profile', { credentials: 'include' });

    if (res.status === 401) { showGate(); return; }

    var data = await res.json();

    if (data.locked) {
      sessionStorage.removeItem('nc_user');
      sessionStorage.setItem('nc_locked', '1');
      window.location.href = '/';
      return;
    }

    _viewerId = data.id;
    showProfile(data);
    pingActivity();

    // show the admin section regardless — the spinner decides what to do next
    show('admin-section');

    if (data.is_admin) {
      setTimeout(function() { loadDashboard(); }, 700);
    } else {
      // just spin for a beat then quietly fade out
      setTimeout(function() { fadeOutAdminCheck(); }, 700);
    }

  } catch (err) {
    console.warn('[nexus/profile] fetch failed:', err.message);
    showGate();
  }
}

/* ====================================================
   ACTIVITY PING — updates IP + timezone in DB
   Fires silently, never blocks the page.
   ==================================================== */
function pingActivity() {
  var tz = (Intl && Intl.DateTimeFormat)
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    : '';

  fetch('/api/activity', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'x-timezone': tz },
  }).catch(function() {});
}

/* ====================================================
   GATE
   ==================================================== */
function showGate() {
  hide('profile-loading');
  show('profile-gate');
}

/* ====================================================
   PROFILE RENDER
   ==================================================== */
function showProfile(user) {
  hide('profile-loading');
  show('profile-wrap');

  renderUserState(user);

  // avatar
  var avatarImg = document.getElementById('profile-avatar');
  var ring      = document.getElementById('profile-avatar-ring');
  if (user.avatar && avatarImg) {
    avatarImg.src    = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
    avatarImg.width  = 88; avatarImg.height = 88;
    avatarImg.style.cssText = 'width:88px;height:88px;object-fit:cover;border-radius:50%;';
  }

  var tierData = getTierData(user.membership);
  if (ring) ring.style.borderColor = tierData.color;

  setText('profile-username', user.username || '--');

  // badges
  var badgeRow = document.getElementById('profile-badge-row');
  if (badgeRow) {
    badgeRow.innerHTML = '';
    badgeRow.appendChild(makeBadge(tierData.label, tierData.color));
    if (user.contributor) badgeRow.appendChild(makeBadge('CONTRIBUTOR', 'var(--accent)'));
    if (user.is_admin)    badgeRow.appendChild(makeBadge('ADMIN', 'var(--gold)'));
  }

  // stats
  setText('stat-assets',  user.assets_posted || 0);
  setText('stat-shared',  user.assets_shared || 0);
  setText('stat-contrib', user.contributor ? 'YES' : 'NO');
  var contribEl = document.getElementById('stat-contrib');
  if (contribEl) contribEl.style.color = user.contributor ? 'var(--green)' : 'var(--muted)';

  // info cells
  setText('info-discord',    user.username || '--');
  setText('info-email',      user.email    || 'not on file');
  setText('info-discord-id', user.id       || '--');

  var memEl = document.getElementById('info-membership');
  if (memEl) { memEl.textContent = tierData.label; memEl.style.color = tierData.color; }

  renderTierTrack(user.membership);
}

/* ====================================================
   TIER TRACK
   ==================================================== */
function renderTierTrack(current) {
  var track = document.getElementById('tier-track');
  if (!track) return;
  var currentIdx = TIERS.findIndex(function(t) { return t.key === current; });
  if (currentIdx === -1) currentIdx = 0;
  track.innerHTML = '';

  TIERS.forEach(function(tier, i) {
    var node = document.createElement('div');
    node.className = 'tier-node' + (i <= currentIdx ? ' tier-node-active' : '');

    var dot = document.createElement('div');
    dot.className = 'tier-dot' + (i === currentIdx ? ' tier-dot-current' : '');
    if (i <= currentIdx) dot.style.background = tier.color;

    var label = document.createElement('div');
    label.className = 'tier-node-label';
    label.textContent = tier.label;
    if (i <= currentIdx) { label.style.color = tier.color; }
    if (i === currentIdx) label.style.fontWeight = '700';

    node.appendChild(dot);
    node.appendChild(label);
    track.appendChild(node);

    if (i < TIERS.length - 1) {
      var line = document.createElement('div');
      line.className = 'tier-line' + (i < currentIdx ? ' tier-line-active' : '');
      track.appendChild(line);
    }
  });
}

/* ====================================================
   ADMIN DASHBOARD
   ==================================================== */

// spinner fades out, then the full card scales in from the bottom
async function loadDashboard() {
  try {
    var res = await fetch('/api/admin-users', { credentials: 'include' });
    if (!res.ok) { fadeOutAdminCheck(); return; }
    var data = await res.json();

    fadeOutAdminCheck(function() {
      renderDashboard(data.users || []);
    });
  } catch (err) {
    console.warn('[nexus/admin] fetch failed:', err.message);
    fadeOutAdminCheck();
  }
}

function fadeOutAdminCheck(then) {
  var check = document.getElementById('admin-check');
  if (!check) { if (then) then(); return; }
  check.style.transition = 'opacity 0.4s ease';
  check.style.opacity    = '0';
  setTimeout(function() {
    check.style.display = 'none';
    if (then) then();
  }, 420);
}

function renderDashboard(users) {
  var count = document.getElementById('admin-member-count');
  if (count) count.textContent = users.length + ' member' + (users.length !== 1 ? 's' : '');

  var tbody = document.getElementById('admin-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  users.forEach(function(user) {
    tbody.appendChild(makeRow(user));
  });

  // scale the card in from the bottom
  var card = document.getElementById('admin-card');
  if (!card) return;
  card.classList.remove('hidden');
  card.classList.add('admin-card-enter');
}

function makeRow(user) {
  var tr = document.createElement('tr');
  tr.setAttribute('data-id', user.discord_id);

  // username (read-only)
  var tdUser = document.createElement('td');
  tdUser.className = 'adm-username';
  tdUser.textContent = user.discord_username;
  tr.appendChild(tdUser);

  // email (read-only)
  var tdEmail = document.createElement('td');
  tdEmail.className = 'adm-dim';
  tdEmail.textContent = user.email || '--';
  tr.appendChild(tdEmail);

  // membership — dropdown
  var tdMem = document.createElement('td');
  var sel   = document.createElement('select');
  sel.className = 'adm-select';
  TIERS.forEach(function(t) {
    var opt = document.createElement('option');
    opt.value       = t.key;
    opt.textContent = t.label;
    if (t.key === user.membership) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function() {
    adminUpdate(tr, user.discord_id, 'membership', sel.value);
  });
  tdMem.appendChild(sel);
  tr.appendChild(tdMem);

  // contributor — toggle
  tr.appendChild(makeToggleCell(user, 'contributor', user.contributor));

  // locked — toggle
  tr.appendChild(makeToggleCell(user, 'locked', user.locked, 'var(--red)'));

  // last_ip (read-only)
  var tdIp = document.createElement('td');
  tdIp.className = 'adm-dim adm-mono';
  tdIp.textContent = user.last_ip || 'unknown';
  tr.appendChild(tdIp);

  // timezone (read-only)
  var tdTz = document.createElement('td');
  tdTz.className = 'adm-dim';
  tdTz.textContent = user.timezone || 'unknown';
  tr.appendChild(tdTz);

  // is_admin — toggle, disabled unless viewer is owner
  var tdAdmin = document.createElement('td');
  var isOwner = (_viewerId === OWNER_ID);
  if (isOwner) {
    tdAdmin.appendChild(makeRawToggle(user, 'is_admin', user.is_admin, 'var(--gold)', tr));
  } else {
    var lock = document.createElement('span');
    lock.className = 'adm-locked-field';
    lock.textContent = user.is_admin ? 'YES' : 'NO';
    lock.style.color = user.is_admin ? 'var(--gold)' : 'var(--muted)';
    tdAdmin.appendChild(lock);
  }
  tr.appendChild(tdAdmin);

  // save flash cell — invisible, shows "SAVED" briefly after any update
  var tdFlash = document.createElement('td');
  tdFlash.className = 'adm-flash';
  tdFlash.setAttribute('data-flash', '');
  tr.appendChild(tdFlash);

  return tr;
}

function makeToggleCell(user, field, currentVal, activeColor) {
  var td = document.createElement('td');
  td.appendChild(makeRawToggle(user, field, currentVal, activeColor || 'var(--green)', null));
  return td;
}

function makeRawToggle(user, field, currentVal, activeColor, tr) {
  var wrap  = document.createElement('label');
  wrap.className = 'adm-toggle';

  var input = document.createElement('input');
  input.type    = 'checkbox';
  input.checked = !!currentVal;

  var slider = document.createElement('span');
  slider.className = 'adm-toggle-slider';
  if (currentVal) slider.style.setProperty('--on-color', activeColor);

  input.addEventListener('change', function() {
    // update the visual color immediately
    if (input.checked) slider.style.setProperty('--on-color', activeColor);
    // tr can be null when called from makeToggleCell — grab from parentage
    var row = tr || wrap.closest('tr');
    adminUpdate(row, user.discord_id, field, input.checked);
  });

  wrap.appendChild(input);
  wrap.appendChild(slider);
  return wrap;
}

/* ====================================================
   ADMIN UPDATE — sends a PATCH to /api/admin-update
   ==================================================== */
async function adminUpdate(tr, targetId, field, value) {
  var flashCell = tr ? tr.querySelector('[data-flash]') : null;

  try {
    var res = await fetch('/api/admin-update', {
      method:      'PATCH',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ targetId: targetId, field: field, value: value }),
    });

    var data = await res.json();

    if (!res.ok) {
      flashMsg(flashCell, data.error || 'ERR', 'var(--red)');
      return;
    }

    flashMsg(flashCell, 'SAVED', 'var(--green)');
  } catch (err) {
    console.warn('[nexus/admin-update]', err.message);
    flashMsg(flashCell, 'ERR', 'var(--red)');
  }
}

function flashMsg(cell, text, color) {
  if (!cell) return;
  cell.textContent  = text;
  cell.style.color  = color;
  cell.style.opacity = '1';
  clearTimeout(cell._t);
  cell._t = setTimeout(function() {
    cell.style.transition = 'opacity 0.5s';
    cell.style.opacity    = '0';
    setTimeout(function() { cell.textContent = ''; cell.style.transition = ''; }, 520);
  }, 1600);
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
  span.style.color       = color;
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
