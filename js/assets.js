/* NEXUS COLLECTIVE - assets.js */
'use strict';

/* ====================================================
   CONSTANTS
   ==================================================== */
var TIER_RANK = { default: 0, member: 1, trusted: 2, highly_trusted: 3, mommys_favorite: 4 };

var SECTION_META = {
  community:   { label: 'Community',   badge: 'TRUSTED+',        color: 'var(--green)'   },
  contributor: { label: 'Contributor', badge: 'CONTRIBUTOR',     color: 'var(--accent)'  },
  official:    { label: 'Official',    badge: 'HIGHLY TRUSTED+', color: 'var(--blue)'    },
};

/* ====================================================
   STATE
   ==================================================== */
var _viewer    = null;  // {id, membership, contributor, is_admin}
var _cards     = [];    // all cards from assets-list
var _openId    = null;  // currently open asset id
var _openData  = null;  // full data for open asset
var _linkCount = 0;     // external link fields in create form
var _activeSection = 'community'; // currently selected section tab

/* ====================================================
   BOOT
   ==================================================== */
document.addEventListener('DOMContentLoaded', bootVault);

function showVaultError(msg) {
  var gate = document.getElementById('vault-gate');
  if (!gate) return;
  var title = gate.querySelector('.vault-gate-title');
  var body  = gate.querySelector('.vault-gate-body');
  if (title) title.textContent = 'SOMETHING WENT WRONG';
  if (title) title.style.color = 'var(--gold)';
  if (body)  body.textContent  = msg;
  show('vault-gate');
}

async function bootVault() {
  pingActivity();

  try {
    var res  = await fetch('/api/assets-list', { credentials: 'include' });
    var data = await res.json();

    if (res.status === 401) { window.location.href = '/'; return; }

    if (res.status === 500) {
      hide('vault-loading');
      showVaultError('Server error — check Vercel logs and env vars.');
      return;
    }

    if (data.notVerified || res.status === 403) {
      hide('vault-loading');
      show('vault-gate');
      return;
    }

    if (!res.ok) {
      hide('vault-loading');
      showVaultError('Unexpected error (' + res.status + ').');
      return;
    }

    _viewer = data.viewer;
    _cards  = data.cards || [];

    // Wire nav avatar/badge — renderUserState is from main.js
    if (typeof renderUserState === 'function') {
      renderUserState({
        id:         _viewer.id,
        username:   _viewer.username || '',
        avatar:     _viewer.avatar   || '',
        locked:     false,
        membership: _viewer.membership,
        is_admin:   _viewer.is_admin,
      });
    }

    // member tier but no section access yet
    if (!_viewer.is_admin &&
        _viewer.membership === 'member' &&
        !_viewer.contributor) {
      renderVault(); // still render cards at 60% for them to see what exists
      showMemberNotice();
    } else {
      renderVault();
    }

    // Show FAB if they can post anywhere
    if (canPostAnywhere(_viewer)) show('vault-fab');

    hide('vault-loading');
    show('vault-content');

  } catch (err) {
    console.warn('[nexus/assets] boot failed:', err.message);
    hide('vault-loading');
    show('vault-gate');
  }
}

/* ====================================================
   ACTIVITY PING
   ==================================================== */
function pingActivity() {
  var tz  = (Intl && Intl.DateTimeFormat)
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '';
  var fp = {
    screen_res:       (screen && screen.width) ? screen.width + 'x' + screen.height : '',
    browser_lang:     navigator.language || navigator.userLanguage || '',
    browser_platform: navigator.platform || '',
  };
  fetch('/api/activity', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-timezone': tz },
    body: JSON.stringify(fp),
  }).catch(function() {});
}

/* ====================================================
   PERMISSIONS
   ==================================================== */
function atLeast(mem, req) {
  return (TIER_RANK[mem] || 0) >= (TIER_RANK[req] || 0);
}

function canViewFull(user, section) {
  if (!user) return false;
  if (user.is_admin) return true;
  switch (section) {
    case 'community':   return atLeast(user.membership, 'trusted') || user.contributor;
    case 'contributor': return user.contributor === true || user.membership === 'mommys_favorite';
    case 'official':    return atLeast(user.membership, 'highly_trusted');
    default: return false;
  }
}

function canPost(user, section) {
  if (!user) return false;
  if (user.is_admin || user.membership === 'mommys_favorite') return true;
  switch (section) {
    case 'community':   return atLeast(user.membership, 'highly_trusted') || user.contributor;
    case 'contributor': return user.contributor === true;
    case 'official':    return false;
    default: return false;
  }
}

function canPostAnywhere(user) {
  return canPost(user, 'community') || canPost(user, 'contributor') || canPost(user, 'official');
}

/* ====================================================
   MEMBER NOTICE
   Shown to basic members who can see cards but no content yet
   ==================================================== */
function showMemberNotice() {
  var hero = document.querySelector('.vault-hero');
  if (!hero) return;
  var notice = document.createElement('div');
  notice.className = 'vault-member-notice';
  notice.innerHTML =
    '<span class="vmn-dot"></span>' +
    'You\'re verified — but Community Resources require <strong>Trusted</strong> rank or above. ' +
    'Chat and contribute in the <a href="https://discord.gg/sHsGnyfbu5" target="_blank" class="hl-link">Nexus Discord</a> to rank up.';
  hero.insertAdjacentElement('afterend', notice);
}

/* ====================================================
   RENDER VAULT
   ==================================================== */
function renderVault() {
  // Update all tab counts
  ['community', 'contributor', 'official'].forEach(function(sec) {
    var n = _cards.filter(function(c) { return c.section === sec; }).length;
    var ct = document.getElementById('tab-count-' + sec);
    if (ct) ct.textContent = n;
  });
  // Render active section
  renderSection(_activeSection);
}

function renderSection(sec) {
  var grid  = document.getElementById('vault-grid');
  var title = document.getElementById('vault-section-title');
  if (!grid) return;

  var labels = { community: 'Community Resources', contributor: 'Contributor Resources', official: 'Official Resources' };
  if (title) title.textContent = labels[sec] || sec;

  var sectionCards = _cards.filter(function(c) { return c.section === sec; });
  grid.innerHTML = '';

  if (sectionCards.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'vault-empty';
    empty.textContent = 'No resources posted yet.';
    grid.appendChild(empty);
    return;
  }

  sectionCards.forEach(function(card) {
    grid.appendChild(makeCard(card));
  });
}

function switchSection(sec) {
  _activeSection = sec;
  // Update tab active state
  document.querySelectorAll('.vault-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.getAttribute('data-section') === sec);
  });
  renderSection(sec);
}

function makeCard(card) {
  var canAccess = canViewFull(_viewer, card.section);
  var wrap      = document.createElement('div');
  wrap.className = 'vault-card' + (canAccess ? '' : ' vault-card-locked');
  if (canAccess) {
    wrap.addEventListener('click', function() { openAssetModal(card.id); });
  }

  var body = document.createElement('div');
  body.className = 'vault-card-body';

  var sec = SECTION_META[card.section] || {};

  // section badge
  var badge = document.createElement('span');
  badge.className = 'vault-card-badge';
  badge.textContent = sec.badge || card.section.toUpperCase();
  badge.style.color = sec.color || 'var(--dim)';
  body.appendChild(badge);

  // title
  var title = document.createElement('div');
  title.className = 'vault-card-title';
  title.textContent = card.title;
  body.appendChild(title);

  // card desc
  var desc = document.createElement('div');
  desc.className = 'vault-card-desc';
  desc.textContent = card.card_desc;
  body.appendChild(desc);

  // footer
  var footer = document.createElement('div');
  footer.className = 'vault-card-footer';

  var authorSpan = document.createElement('span');
  authorSpan.textContent = card.created_by_name;
  footer.appendChild(authorSpan);

  if (card.view_count > 0) {
    var viewSpan = document.createElement('span');
    viewSpan.className = 'vault-card-views';
    viewSpan.textContent = card.view_count + ' view' + (card.view_count !== 1 ? 's' : '');
    footer.appendChild(viewSpan);
  }

  // lock icon for inaccessible cards
  if (!canAccess) {
    var lockIcon = document.createElement('span');
    lockIcon.className = 'vault-card-lock';
    lockIcon.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
      '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    footer.appendChild(lockIcon);
  }

  body.appendChild(footer);
  wrap.appendChild(body);
  return wrap;
}

/* ====================================================
   ASSET MODAL
   ==================================================== */
async function openAssetModal(assetId) {
  _openId = assetId;

  // Show overlay with spinner while loading
  var overlay = document.getElementById('asset-modal-overlay');
  var modal   = document.getElementById('asset-modal');
  if (!overlay || !modal) return;

  modal.classList.add('asset-modal-loading');
  overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');

  try {
    var res  = await fetch('/api/asset-get?id=' + assetId, { credentials: 'include' });
    var data = await res.json();

    if (!res.ok) {
      closeAssetModal();
      return;
    }

    _openData = data;
    renderAssetModal(data);
    modal.classList.remove('asset-modal-loading');

  } catch (err) {
    console.warn('[nexus/assets] asset-get failed:', err.message);
    closeAssetModal();
  }
}

function renderAssetModal(asset) {
  // background
  var bg = document.getElementById('modal-bg');
  if (bg) bg.classList.add('hidden');

  // section badge
  var sec  = SECTION_META[asset.section] || {};
  var sBadge = document.getElementById('modal-section-badge');
  if (sBadge) {
    sBadge.textContent  = sec.label || asset.section;
    sBadge.style.color  = sec.color || 'var(--dim)';
  }

  // title + author
  setText('modal-title',  asset.title);
  var author = document.getElementById('modal-author');
  if (author) author.textContent = 'posted by ' + asset.created_by_name;

  // rich description
  var desc = document.getElementById('modal-desc');
  if (desc) {
    if (asset.description) {
      desc.innerHTML = renderRichText(asset.description);
    } else {
      desc.innerHTML = '<span class="modal-empty">No description provided.</span>';
    }
  }

  // code block
  var codeWrap = document.getElementById('modal-code');
  if (codeWrap) {
    if (asset.code_block) {
      codeWrap.innerHTML = '';
      codeWrap.appendChild(buildCodeBlock(asset.code_block));
      codeWrap.classList.remove('hidden');
    } else {
      codeWrap.classList.add('hidden');
    }
  }

  // external links
  var linksWrap = document.getElementById('modal-links');
  if (linksWrap) {
    var links = [];
    try { links = JSON.parse(asset.external_links || '[]'); } catch (e) {}
    if (links.length > 0) {
      linksWrap.innerHTML = '<div class="modal-links-label">EXTERNAL LINKS</div>';
      links.forEach(function(link) {
        var a = document.createElement('a');
        a.className  = 'modal-ext-link';
        a.href       = link.url;
        a.target     = '_blank';
        a.rel        = 'noopener noreferrer';
        a.textContent = link.label || link.url;
        linksWrap.appendChild(a);
      });
      linksWrap.classList.remove('hidden');
    } else {
      linksWrap.classList.add('hidden');
    }
  }

  // mega download area
  var megaWrap = document.getElementById('modal-mega');
  if (megaWrap) {
    if (asset.mega_link) {
      megaWrap.innerHTML = '';
      var megaLabel = document.createElement('div');
      megaLabel.className = 'modal-links-label';
      megaLabel.textContent = 'DOWNLOAD';
      megaWrap.appendChild(megaLabel);

      var megaRow = document.createElement('div');
      megaRow.className = 'modal-mega-row';

      var openBtn = document.createElement('a');
      openBtn.className  = 'modal-mega-btn';
      openBtn.href       = asset.mega_link + (asset.mega_key ? '#' + asset.mega_key.replace('nexuscollective_', '') : '');
      openBtn.target     = '_blank';
      openBtn.rel        = 'noopener noreferrer';
      openBtn.textContent = 'OPEN IN MEGA';
      openBtn.addEventListener('click', function() {
        // Fire mega click tracking — baked into activity endpoint
        var tz = (Intl && Intl.DateTimeFormat)
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '';
        fetch('/api/activity', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-timezone': tz },
          body: JSON.stringify({ assetId: asset.id, action: 'mega' }),
        }).catch(function() {});
      });
      megaRow.appendChild(openBtn);

      if (asset.mega_key) {
        var keyBtn = document.createElement('button');
        keyBtn.className  = 'modal-key-btn allow-copy';
        keyBtn.textContent = 'COPY KEY';
        keyBtn.addEventListener('click', function() {
          navigator.clipboard.writeText(asset.mega_key).then(function() {
            keyBtn.textContent = 'COPIED';
            setTimeout(function() { keyBtn.textContent = 'COPY KEY'; }, 2000);
          }).catch(function() {
            // fallback — show key inline
            keyBtn.textContent = asset.mega_key;
            keyBtn.style.fontSize = '9px';
          });
        });
        megaRow.appendChild(keyBtn);
      }

      megaWrap.appendChild(megaRow);
      megaWrap.classList.remove('hidden');
    } else {
      megaWrap.classList.add('hidden');
    }
  }

  // view count
  var meta = document.getElementById('modal-meta');
  if (meta) {
    var countTxt = asset.view_count
      ? asset.view_count + ' unique view' + (asset.view_count !== 1 ? 's' : '')
      : 'no views yet';
    meta.textContent = (SECTION_META[asset.section] || {}).label + '  —  ' + countTxt;
  }

  // Admin viewer list
  var viewerWrap = document.getElementById('modal-viewers');
  if (viewerWrap) {
    if (asset.viewer_list && asset.viewer_list.length > 0) {
      viewerWrap.innerHTML = '<div class="modal-links-label">VIEWED BY</div>';
      asset.viewer_list.forEach(function(v) {
        var row = document.createElement('div');
        row.className = 'modal-viewer-row';
        var nameEl = document.createElement('span');
        nameEl.className = 'modal-viewer-name';
        nameEl.textContent = v.viewer_name;
        var flags = document.createElement('span');
        flags.className = 'modal-viewer-flags';
        if (v.opened_mega) {
          var megaFlag = document.createElement('span');
          megaFlag.className = 'modal-viewer-flag mega';
          megaFlag.textContent = 'OPENED MEGA';
          flags.appendChild(megaFlag);
        }
        var ua = document.createElement('span');
        ua.className = 'modal-viewer-ua';
        ua.textContent = v.user_agent ? v.user_agent.split(' ')[0] : '';
        row.appendChild(nameEl);
        row.appendChild(flags);
        row.appendChild(ua);
        viewerWrap.appendChild(row);
      });
      viewerWrap.classList.remove('hidden');
    } else {
      viewerWrap.classList.add('hidden');
    }
  }

  // ... menu visibility
  var menuBtn       = document.getElementById('modal-menu-btn');
  var takedownBtn   = document.getElementById('modal-takedown-btn');
  var deleteBtn     = document.getElementById('modal-delete-btn');
  var isCreator     = _viewer && asset.created_by_id === _viewer.id;
  var isAdmin       = _viewer && _viewer.is_admin;

  if (menuBtn) {
    if (isCreator || isAdmin) {
      menuBtn.classList.remove('hidden');
      if (takedownBtn) takedownBtn.style.display = isCreator ? '' : 'none';
      if (deleteBtn)   deleteBtn.style.display   = (isAdmin && !isCreator) ? '' : 'none';
    } else {
      menuBtn.classList.add('hidden');
    }
  }
}

function closeAssetModal() {
  var overlay = document.getElementById('asset-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  var menu = document.getElementById('modal-menu');
  if (menu) menu.classList.add('hidden');
  _openId   = null;
  _openData = null;
}

function toggleModalMenu() {
  var menu = document.getElementById('modal-menu');
  if (menu) menu.classList.toggle('hidden');
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', function() {
  var overlay = document.getElementById('asset-modal-overlay');
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeAssetModal();
  });
  var createOverlay = document.getElementById('create-modal-overlay');
  if (createOverlay) createOverlay.addEventListener('click', function(e) {
    if (e.target === createOverlay) closeCreateModal();
  });
});

/* ====================================================
   DELETE ASSET
   ==================================================== */
async function deleteCurrentAsset() {
  if (!_openId) return;
  var menu = document.getElementById('modal-menu');
  if (menu) menu.classList.add('hidden');

  if (!confirm('Remove this post? This cannot be undone.')) return;

  try {
    var res = await fetch('/api/asset-delete?id=' + _openId, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || 'Delete failed.');
      return;
    }

    // Remove card from DOM + state
    _cards = _cards.filter(function(c) { return c.id !== _openId; });
    closeAssetModal();
    renderVault();
  } catch (err) {
    console.warn('[nexus/assets] delete failed:', err.message);
  }
}

/* ====================================================
   CREATE MODAL
   ==================================================== */
function openCreateModal() {
  if (!_viewer) return;

  // Build section options based on permissions
  var sel = document.getElementById('cf-section');
  if (sel) {
    sel.innerHTML = '';
    ['community', 'contributor', 'official'].forEach(function(sec) {
      if (!canPost(_viewer, sec)) return;
      var opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = SECTION_META[sec].label;
      sel.appendChild(opt);
    });
    if (sel.options.length === 0) return; // no sections available
  }

  // Reset form
  ['cf-title','cf-card-desc','cf-desc','cf-mega','cf-key','cf-code'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var linksList = document.getElementById('cf-links-list');
  if (linksList) linksList.innerHTML = '';
  _linkCount = 0;
  var err = document.getElementById('cf-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  var preview = document.getElementById('rich-preview');
  if (preview) preview.classList.add('hidden');

  // counter listeners
  var cardDesc = document.getElementById('cf-card-desc');
  if (cardDesc) {
    cardDesc.addEventListener('input', function() {
      var ct = document.getElementById('cf-card-counter');
      if (ct) ct.textContent = cardDesc.value.length + '/50';
    });
  }
  var descArea = document.getElementById('cf-desc');
  if (descArea) {
    descArea.addEventListener('input', function() {
      var ct = document.getElementById('cf-desc-counter');
      if (ct) ct.textContent = descArea.value.length + '/4096';
    });
  }

  // Restore any saved draft
  restoreDraft();

  show('create-modal-overlay');
  document.body.classList.add('modal-open');
}

function saveDraft() {
  var draft = {
    section:   getVal('cf-section'),
    title:     getVal('cf-title'),
    card_desc: getVal('cf-card-desc'),
    desc:      getVal('cf-desc'),
    mega:      getVal('cf-mega'),
    key:       getVal('cf-key'),
    code:      getVal('cf-code'),
  };
  // Only save if there's actually something worth keeping
  if (draft.title || draft.desc || draft.mega) {
    try { sessionStorage.setItem('nc_draft', JSON.stringify(draft)); } catch(e) {}
  }
}

function clearDraft() {
  try { sessionStorage.removeItem('nc_draft'); } catch(e) {}
}

function restoreDraft() {
  try {
    var raw = sessionStorage.getItem('nc_draft');
    if (!raw) return;
    var d = JSON.parse(raw);
    var fields = { 'cf-title': d.title, 'cf-card-desc': d.card_desc,
      'cf-desc': d.desc, 'cf-mega': d.mega, 'cf-key': d.key, 'cf-code': d.code };
    Object.keys(fields).forEach(function(id) {
      var el = document.getElementById(id);
      if (el && fields[id]) el.value = fields[id];
    });
    // Update section dropdown if saved value exists
    if (d.section) {
      var sel = document.getElementById('cf-section');
      if (sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === d.section) { sel.selectedIndex = i; break; }
        }
      }
    }
    // Update counters
    var cardDesc = document.getElementById('cf-card-desc');
    var ct = document.getElementById('cf-card-counter');
    if (cardDesc && ct) ct.textContent = cardDesc.value.length + '/50';
    var descEl = document.getElementById('cf-desc');
    var dt = document.getElementById('cf-desc-counter');
    if (descEl && dt) dt.textContent = descEl.value.length + '/4096';
    // Show a subtle notice
    var err = document.getElementById('cf-error');
    if (err) {
      err.textContent = 'Draft restored from your last session.';
      err.style.color = 'var(--gold)';
      err.classList.remove('hidden');
      setTimeout(function() { err.classList.add('hidden'); err.style.color = ''; }, 3000);
    }
  } catch(e) {}
}

function closeCreateModal() {
  saveDraft();
  hide('create-modal-overlay');
  document.body.classList.remove('modal-open');
}

function addLinkField() {
  if (_linkCount >= 6) return;
  _linkCount++;
  var list = document.getElementById('cf-links-list');
  if (!list) return;

  var row = document.createElement('div');
  row.className = 'cf-link-row';
  row.innerHTML =
    '<input class="cf-input cf-link-url" type="text" placeholder="https://..." data-link-url>' +
    '<input class="cf-input cf-link-label" type="text" placeholder="Label (optional)" data-link-label>';
  list.appendChild(row);

  if (_linkCount >= 6) {
    var btn = document.getElementById('cf-add-link-btn');
    if (btn) btn.style.display = 'none';
  }
}

async function submitCreateForm() {
  var btn = document.getElementById('cf-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'POSTING...'; }

  var section   = getVal('cf-section');
  var title     = getVal('cf-title');
  var card_desc = getVal('cf-card-desc');
  var desc      = getVal('cf-desc');
  var mega      = getVal('cf-mega');
  var key       = getVal('cf-key');
  var code      = getVal('cf-code');

  // Collect external links
  var links = [];
  document.querySelectorAll('.cf-link-row').forEach(function(row) {
    var url   = (row.querySelector('[data-link-url]')   || {}).value || '';
    var label = (row.querySelector('[data-link-label]') || {}).value || '';
    if (url.trim()) links.push({ url: url.trim(), label: label.trim() });
  });

  var body = {
    section:        section,
    title:          title,
    card_desc:      card_desc,
    description:    desc,
    mega_link:      mega,
    mega_key:       key,
    external_links: links,
    code_block:     code,
  };

  try {
    var res  = await fetch('/api/asset-create', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
    });
    var data = await res.json();

    if (!res.ok) {
      showCreateError(data.error || 'Something went wrong.');
      if (btn) { btn.disabled = false; btn.textContent = 'POST ASSET'; }
      return;
    }

    // Add new card to local state + re-render
    _cards.unshift({
      id:             data.id,
      title:          title,
      card_desc:      card_desc,
      section:        section,
      created_by_name: _viewer ? (_viewer.username || '') : '',
      created_by_id:   _viewer ? _viewer.id : '',
      view_count:      0,
    });

    // Reset button BEFORE closing so next open is clean
    if (btn) { btn.disabled = false; btn.textContent = 'POST ASSET'; }
    clearDraft();
    closeCreateModal();
    renderVault();

  } catch (err) {
    showCreateError('Network error. Try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'POST ASSET'; }
  }
}

function showCreateError(msg) {
  var err = document.getElementById('cf-error');
  if (!err) return;
  err.textContent = msg;
  err.classList.remove('hidden');
}

/* ====================================================
   RICH TEXT
   ==================================================== */
function richWrap(open, close) {
  var ta = document.getElementById('cf-desc');
  if (!ta) return;
  var start = ta.selectionStart;
  var end   = ta.selectionEnd;
  var sel   = ta.value.substring(start, end);
  var rep   = open + (sel || 'text') + close;
  ta.value  = ta.value.substring(0, start) + rep + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = start + open.length;
  ta.selectionEnd   = start + open.length + (sel || 'text').length;
  var ct = document.getElementById('cf-desc-counter');
  if (ct) ct.textContent = ta.value.length + '/4096';
}

function toggleRichPreview() {
  var ta  = document.getElementById('cf-desc');
  var pre = document.getElementById('rich-preview');
  var btn = document.getElementById('rt-preview-btn');
  if (!ta || !pre) return;
  if (pre.classList.contains('hidden')) {
    pre.innerHTML = renderRichText(ta.value) || '<span class="modal-empty">Nothing to preview.</span>';
    pre.classList.remove('hidden');
    ta.classList.add('hidden');
    if (btn) btn.textContent = 'edit';
  } else {
    pre.classList.add('hidden');
    ta.classList.remove('hidden');
    if (btn) btn.textContent = 'preview';
  }
}

function renderRichText(raw) {
  if (!raw) return '';
  // escape HTML first so injected tags are inert
  var safe = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return safe
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[color:accent\]([\s\S]*?)\[\/color\]/gi, '<span style="color:var(--accent)">$1</span>')
    .replace(/\[color:green\]([\s\S]*?)\[\/color\]/gi,  '<span style="color:var(--green)">$1</span>')
    .replace(/\[color:gold\]([\s\S]*?)\[\/color\]/gi,   '<span style="color:var(--gold)">$1</span>')
    .replace(/\[color:blue\]([\s\S]*?)\[\/color\]/gi,   '<span style="color:var(--blue)">$1</span>')
    .replace(/\[color:red\]([\s\S]*?)\[\/color\]/gi,    '<span style="color:var(--red)">$1</span>')
    .replace(/\n/g, '<br>');
}

/* ====================================================
   CODE BLOCK
   ==================================================== */
function buildCodeBlock(code) {
  var wrap = document.createElement('div');
  wrap.className = 'code-block';

  var header = document.createElement('div');
  header.className = 'code-header';

  var dots = document.createElement('div');
  dots.className = 'code-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';

  var langLabel = document.createElement('span');
  langLabel.className = 'code-lang';
  langLabel.textContent = 'code';

  header.appendChild(dots);
  header.appendChild(langLabel);

  var pre = document.createElement('pre');
  var codeEl = document.createElement('code');
  codeEl.textContent = code; // textContent auto-escapes, safe
  pre.appendChild(codeEl);

  wrap.appendChild(header);
  wrap.appendChild(pre);
  return wrap;
}


/* ====================================================
   HELPERS
   ==================================================== */
function getVal(id) {
  var el = document.getElementById(id);
  return el ? (el.value || '').trim() : '';
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
