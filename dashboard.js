/*
  dashboard.js
  admin panel — gate checks session only (instant from localStorage)
  dashboard shell shows immediately, table area handles role check and auto-fetch
*/

import { supabase, signOut } from './supabase-client.js'

let allMembers    = []
let editingUserId = null
let currentAdmin  = null

const gate        = document.getElementById('dash-gate')
const gateLabel   = document.getElementById('gate-label')
const gateSpinner = document.getElementById('gate-spinner')
const dashWrap    = document.getElementById('dash-wrap')
const tbody       = document.getElementById('members-tbody')

document.getElementById('year').textContent = new Date().getFullYear()

/* ── ENTRY POINT ─────────────────────────────────────────────
   INITIAL_SESSION fires once supabase has finished restoring
   auth from localStorage — the session check itself is instant.
   we open the gate the moment we confirm a session exists, then
   the table area handles the slower profile/role check itself.
   ─────────────────────────────────────────────────────────── */
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') return

  if (!session) {
    kick('no session — redirecting...')
    setTimeout(() => { window.location.href = 'index.html' }, 1800)
    return
  }

  //-- session confirmed — open the gate immediately, no profile wait
  openGate()

  //-- role check + table load happens in the background
  //-- the table area shows its own status while this resolves
  setTableStatus('// checking permissions...')
  await resolveAdminAndLoad(session)
})

/* ── OPEN GATE ───────────────────────────────────────────────
   dismisses the overlay the moment session is confirmed
   ─────────────────────────────────────────────────────────── */
function openGate() {
  gateSpinner.style.display = 'none'
  gateLabel.textContent     = '✓ session verified'
  gateLabel.style.color     = 'rgba(100,220,150,0.9)'
  gateLabel.style.animation = 'none'

  setTimeout(() => {
    gate.classList.add('hidden')
    dashWrap.classList.add('visible')
    gate.addEventListener('transitionend', () => { gate.style.display = 'none' }, { once: true })
  }, 400)
}

/* ── RESOLVE ADMIN AND LOAD ──────────────────────────────────
   polls for the profile row then checks role.
   if admin: builds nav, badge, loads the members table.
   if not admin: shows denial in table area then redirects.
   ─────────────────────────────────────────────────────────── */
async function resolveAdminAndLoad(session) {
  const profile = await fetchProfileWithRetry(session.user.id)

  if (!profile) {
    setTableStatus('// could not load profile — try signing out and back in')
    return
  }

  const isAdmin = profile.is_super_admin === true || profile.role === 'admin'

  if (!isAdmin) {
    setTableStatus('// access denied — admin only')
    setTimeout(() => { window.location.href = 'index.html' }, 2000)
    return
  }

  currentAdmin = { session, profile }
  renderAdminBadge(session.user, profile)
  buildNav(profile)
  await loadMembers()
}

/* ── PROFILE FETCH WITH RETRY ────────────────────────────────
   polls until the row exists or we run out of attempts.
   updates the table status each attempt so there's visible feedback.
   ─────────────────────────────────────────────────────────── */
async function fetchProfileWithRetry(userId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      const waitMs = Math.min(800 + i * 400, 3000)
      setTableStatus(`// checking permissions... (attempt ${i + 1}/${maxAttempts})`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    //-- PGRST116 = row not there yet, keep waiting
    if (error?.code === 'PGRST116') continue

    if (error) {
      console.error('profile fetch error:', error.code, error.message)
      return null
    }

    console.log('profile fetched on attempt', i + 1)
    return data
  }

  console.log('profile not found after', maxAttempts, 'attempts')
  return null
}

/* ── TABLE STATUS ────────────────────────────────────────────
   writes a single status row into the table body
   ─────────────────────────────────────────────────────────── */
function setTableStatus(msg) {
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading">${esc(msg)}</td></tr>`
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
  avatarEl.src        = profile.avatar_url || ''
  nameEl.textContent  = (profile.username || 'admin') + (profile.is_super_admin ? ' [SUPER]' : ' [ADMIN]')
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
  setTableStatus('// fetching members...')

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    setTableStatus(`// error: ${esc(error.message)}`)
    return
  }

  //-- grab latest ip log per user
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
  document.getElementById('stat-total').textContent   = allMembers.length
  document.getElementById('stat-locked').textContent  = allMembers.filter(m => m.locked).length
  document.getElementById('stat-contrib').textContent = allMembers.filter(m => m.is_contributor).length
  document.getElementById('stat-admins').textContent  = allMembers.filter(m => m.role === 'admin' || m.is_super_admin).length
}

/* ── RENDER TABLE ───────────────────────────────────────────── */
function renderTable(members) {
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

  //-- event delegation — one listener on tbody instead of inline onclick
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
  document.getElementById('modal-sub').textContent        = `// ${member.username || userId}`
  document.getElementById('modal-role').value              = member.role || 'visitor'
  document.getElementById('modal-contributor').checked     = !!member.is_contributor
  document.getElementById('modal-locked').checked          = !!member.locked
  document.getElementById('modal-lock-reason').value       = member.lock_reason || ''
  document.getElementById('edit-modal').hidden             = false
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

  //-- update local state so table reflects change immediately
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