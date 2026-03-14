/*
  dashboard.js
  admin panel logic — auth gate, member table, edit modal
  uses getProfile() from supabase-client.js exactly like main.js does
*/

import { supabase, getProfile, signOut } from './supabase-client.js'

let allMembers    = []
let editingUserId = null
let currentAdmin  = null

const gate        = document.getElementById('dash-gate')
const gateLabel   = document.getElementById('gate-label')
const gateSpinner = document.getElementById('gate-spinner')
const dashWrap    = document.getElementById('dash-wrap')

document.getElementById('year').textContent = new Date().getFullYear()

/* ── INIT ────────────────────────────────────────────────────
   mirrors the exact same flow as main.js:
   1. getSession() from localStorage (instant, no network)
   2. getProfile() with retry logic (handles async trigger delay)
   3. check role — kick if not admin
   ─────────────────────────────────────────────────────────── */
async function init() {

  /* step 1: get session — same as main.js, reads from localStorage */
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    kick('no session — redirecting...')
    setTimeout(() => { window.location.href = 'index.html' }, 1800)
    return
  }

  /* step 2: get profile using the same getProfile() with retries
     this is identical to what main.js does — no custom raw query */
  gateLabel.textContent = 'loading profile...'
  const profile = await getProfile(session.user.id)

  if (!profile) {
    kick('could not load profile — try signing out and back in')
    return
  }

  /* step 3: check admin role */
  const isAdmin = profile.is_super_admin === true || profile.role === 'admin'

  if (!isAdmin) {
    kick('access denied — admin only')
    setTimeout(() => { window.location.href = 'index.html' }, 1800)
    return
  }

  /* step 4: passed — show dashboard */
  currentAdmin = { session, profile }

  gateSpinner.style.display = 'none'
  gateLabel.textContent     = '✓ access granted'
  gateLabel.style.color     = 'rgba(100,220,150,0.9)'
  gateLabel.style.animation = 'none'

  setTimeout(() => {
    gate.classList.add('hidden')
    dashWrap.classList.add('visible')
    gate.addEventListener('transitionend', () => { gate.style.display = 'none' }, { once: true })
  }, 700)

  renderAdminBadge(session.user, profile)
  buildNav(profile)
  await loadMembers()
}

/* ── KICK ───────────────────────────────────────────────────── */
function kick(msg) {
  gateSpinner.style.display = 'none'
  gateLabel.style.display   = 'none'
  const err = document.createElement('div')
  err.className = 'gate-error'
  err.innerHTML = `// ${msg}<br><br><a href="index.html" style="color:var(--accent);text-decoration:none;letter-spacing:.1em;font-size:10px;">← return to nexus</a>`
  gate.appendChild(err)
}

/* ── ADMIN BADGE ─────────────────────────────────────────────── */
function renderAdminBadge(user, profile) {
  const badge    = document.getElementById('dash-admin-badge')
  const avatarEl = document.getElementById('dash-admin-avatar')
  const nameEl   = document.getElementById('dash-admin-name')
  avatarEl.src = profile.avatar_url || ''
  nameEl.textContent = (profile.username || 'admin') + (profile.is_super_admin ? ' [SUPER]' : ' [ADMIN]')
  badge.style.display = 'flex'
}

/* ── NAV ────────────────────────────────────────────────────── */
function buildNav(profile) {
  const navAuth = document.getElementById('nav-auth')
  navAuth.innerHTML = `
    <span style="font-size:10px;color:var(--text-muted);letter-spacing:.1em;">${esc(profile.username || 'admin')}</span>
    <button class="btn btn-secondary" id="btn-signout" style="padding:7px 14px;font-size:10px;">sign out</button>
  `
  document.getElementById('btn-signout').addEventListener('click', async () => {
    await signOut()
    window.location.href = 'index.html'
  })
}

/* ── LOAD MEMBERS ───────────────────────────────────────────── */
async function loadMembers() {
  const tbody = document.getElementById('members-tbody')
  tbody.innerHTML = '<tr><td colspan="7" class="table-loading">// fetching members...</td></tr>'

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">// error: ${esc(error.message)}</td></tr>`
    return
  }

  /* grab latest ip log per user */
  const { data: ipRows } = await supabase
    .from('ip_logs')
    .select('user_id, ip_address, timezone, logged_at')
    .order('logged_at', { ascending: false })

  const ipMap = {}
  if (ipRows) {
    for (const row of ipRows) {
      if (!ipMap[row.user_id]) ipMap[row.user_id] = row
    }
  }

  allMembers = profiles.map(p => ({ ...p, _ipLog: ipMap[p.id] || null }))

  updateStats()
  renderTable(allMembers)
  setupSearch()
}

/* ── STATS ──────────────────────────────────────────────────── */
function updateStats() {
  document.getElementById('stat-total').textContent  = allMembers.length
  document.getElementById('stat-locked').textContent = allMembers.filter(m => m.locked).length
  document.getElementById('stat-contrib').textContent= allMembers.filter(m => m.is_contributor).length
  document.getElementById('stat-admins').textContent = allMembers.filter(m => m.role === 'admin' || m.is_super_admin).length
}

/* ── RENDER TABLE ───────────────────────────────────────────── */
function renderTable(members) {
  const tbody = document.getElementById('members-tbody')
  document.getElementById('dash-count').textContent = `${members.length} member${members.length !== 1 ? 's' : ''}`

  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">// no members found</td></tr>'
    return
  }

  tbody.innerHTML = members.map(m => {
    const username  = m.username   || 'unknown'
    const discordId = m.discord_id || '—'
    const lastIp    = m._ipLog?.ip_address || m.last_ip       || '—'
    const timezone  = m._ipLog?.timezone   || m.last_timezone || '—'
    const lastSeen  = m.last_seen ? formatDate(m.last_seen) : '—'

    const roleCls = m.is_super_admin    ? 'role-superadmin'
                  : m.role === 'admin'   ? 'role-admin'
                  : m.role === 'trusted' ? 'role-trusted'
                  : m.role === 'member'  ? 'role-member'
                  : 'role-visitor'

    const roleLabel    = m.is_super_admin ? 'super admin' : (m.role || 'visitor')
    const contribBadge = m.is_contributor ? `<span class="contrib-badge">contrib</span>` : ''
    const lockedBadge  = m.locked         ? `<span class="locked-badge">locked</span>`  : ''

    const canEdit = !m.is_super_admin || currentAdmin?.profile?.is_super_admin
    const lockBtn = m.locked
      ? `<button class="btn-unlock" data-id="${m.id}">Unlock</button>`
      : `<button class="btn-lock"   data-id="${m.id}">Lock</button>`

    const actions = canEdit
      ? `<div class="td-actions">
           <button class="btn-edit" data-id="${m.id}">Edit</button>
           ${lockBtn}
         </div>`
      : `<span style="font-size:9px;color:var(--text-muted);letter-spacing:.1em;">PROTECTED</span>`

    return `
      <tr data-id="${m.id}">
        <td>
          <div class="td-avatar">
            <img src="${esc(m.avatar_url || '')}" alt="" onerror="this.style.display='none'" />
            <div>
              <div class="td-username">${esc(username)}${contribBadge}</div>
            </div>
          </div>
        </td>
        <td class="td-sub">${esc(discordId)}</td>
        <td>
          <span class="role-badge ${roleCls}">${esc(roleLabel)}</span>
          ${lockedBadge}
        </td>
        <td class="td-ip">${esc(lastIp)}</td>
        <td class="td-tz">${esc(timezone)}</td>
        <td class="td-ip">${esc(lastSeen)}</td>
        <td>${actions}</td>
      </tr>
    `
  }).join('')

  /* event delegation — one listener on tbody instead of inline onclick */
  tbody.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', () => openEdit(btn.dataset.id))
  })
}

/* ── SEARCH + FILTER ────────────────────────────────────────── */
function setupSearch() {
  const searchEl = document.getElementById('dash-search')
  const filterEl = document.getElementById('dash-filter')

  function apply() {
    const q      = searchEl.value.toLowerCase().trim()
    const filter = filterEl.value

    let list = allMembers

    if      (filter === 'locked')      list = list.filter(m => m.locked)
    else if (filter === 'contributor') list = list.filter(m => m.is_contributor)
    else if (filter !== 'all')         list = list.filter(m => m.role === filter)

    if (q) {
      list = list.filter(m =>
        (m.username           || '').toLowerCase().includes(q) ||
        (m.discord_id         || '').toLowerCase().includes(q) ||
        (m._ipLog?.ip_address || m.last_ip || '').toLowerCase().includes(q) ||
        (m.id                 || '').toLowerCase().includes(q)
      )
    }

    renderTable(list)
  }

  searchEl.addEventListener('input', apply)
  filterEl.addEventListener('change', apply)
}

/* ── EDIT MODAL ─────────────────────────────────────────────── */
function openEdit(userId) {
  const member = allMembers.find(m => m.id === userId)
  if (!member) return

  editingUserId = userId
  document.getElementById('modal-sub').textContent          = `// ${member.username || userId}`
  document.getElementById('modal-role').value                = member.role || 'visitor'
  document.getElementById('modal-contributor').checked       = !!member.is_contributor
  document.getElementById('modal-locked').checked            = !!member.locked
  document.getElementById('modal-lock-reason').value         = member.lock_reason || ''
  document.getElementById('edit-modal').hidden               = false
}

function closeModal() {
  document.getElementById('edit-modal').hidden = true
  editingUserId = null
}

document.getElementById('modal-close').addEventListener('click', closeModal)
document.getElementById('btn-cancel').addEventListener('click', closeModal)
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-modal')) closeModal()
})

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!editingUserId) return

  const saveBtn = document.getElementById('btn-save')
  saveBtn.disabled    = true
  saveBtn.textContent = 'Saving...'

  const newRole       = document.getElementById('modal-role').value
  const newContrib    = document.getElementById('modal-contributor').checked
  const newLocked     = document.getElementById('modal-locked').checked
  const newLockReason = document.getElementById('modal-lock-reason').value.trim()

  const { error } = await supabase
    .from('profiles')
    .update({
      role:           newRole,
      is_contributor: newContrib,
      locked:         newLocked,
      lock_reason:    newLocked ? (newLockReason || null) : null,
    })
    .eq('id', editingUserId)

  saveBtn.disabled    = false
  saveBtn.textContent = 'Save Changes'

  if (error) {
    showToast('error: ' + error.message, 'error')
    return
  }

  /* update local state so table reflects change immediately */
  const idx = allMembers.findIndex(m => m.id === editingUserId)
  if (idx !== -1) {
    allMembers[idx].role           = newRole
    allMembers[idx].is_contributor = newContrib
    allMembers[idx].locked         = newLocked
    allMembers[idx].lock_reason    = newLocked ? newLockReason : null
  }

  updateStats()
  document.getElementById('dash-search').dispatchEvent(new Event('input'))
  closeModal()
  showToast('profile updated', 'success')
})

/* ── TOAST ──────────────────────────────────────────────────── */
function showToast(msg, type = '') {
  const toast = document.getElementById('toast')
  toast.textContent = msg
  toast.className = `show ${type}`
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.className = '' }, 3000)
}

/* ── HELPERS ────────────────────────────────────────────────── */
function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
       + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function esc(str) {
  if (typeof str !== 'string') return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

init()