/*
  main.js
  auth state management, nav rendering, lock screen, preloader, misc ui
*/

import { supabase, signInWithDiscord, signOut, getProfile, callOnLogin } from './supabase-client.js'

let currentProfile = null

function cacheProfile(profile) {
  try {
    sessionStorage.setItem('nexus-profile', JSON.stringify(profile))
  } catch { /* storage full or blocked, ignore */ }
}

function getCachedProfile() {
  try {
    const raw = sessionStorage.getItem('nexus-profile')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function clearCachedProfile() {
  try { sessionStorage.removeItem('nexus-profile') } catch { /* ignore */ }
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear()
  setupPreloader()
  setupAuth()
  setupLoginBtn()
  setupLockLogout()
}

function setupPreloader() {
  const preloader = document.getElementById('preloader')
  const canvas    = document.getElementById('particles-canvas')

  setTimeout(() => {
    preloader.classList.add('done')
    if (canvas) canvas.classList.add('interactive')
    preloader.addEventListener('transitionend', () => {
      preloader.style.display = 'none'
    }, { once: true })
  }, 1400)
}

async function setupAuth() {
  showAuthLoading()

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('auth state change:', event)

    /* ── no session ───────────────────────────────────────── */
    if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
      currentProfile = null
      clearCachedProfile()
      hideLockScreen()
      document.body.classList.remove('is-authed')
      clearNav()
      return
    }

    /* ── page load with existing session ─────────────────── */
    if (event === 'INITIAL_SESSION' && session) {
      const cached = getCachedProfile()

      if (cached) {
        console.log('restored from session cache instantly')
        currentProfile = cached
        if (currentProfile.locked) {
          showLockScreen(currentProfile.lock_reason)
        } else {
          renderLoggedIn(session.user, currentProfile)
          logVisitInBackground(session.access_token)
        }
        return
      }

      console.log('INITIAL_SESSION: fetching profile...')
      currentProfile = await getProfile(session.user.id)

      if (!currentProfile) {
        showAuthError('Profile not found. Try signing out and back in.')
        return
      }

      if (currentProfile.locked) {
        showLockScreen(currentProfile.lock_reason)
        return
      }

      cacheProfile(currentProfile)
      renderLoggedIn(session.user, currentProfile)
      logVisitInBackground(session.access_token)
      return
    }

    /* ── token refresh ────────────────────────────────────── */
    if (event === 'TOKEN_REFRESHED') {
      if (!currentProfile) {
        currentProfile = getCachedProfile() || await getProfile(session.user.id)
        if (currentProfile) {
          cacheProfile(currentProfile)
          if (!currentProfile.locked) renderLoggedIn(session.user, currentProfile)
        }
      }
      return
    }

    /* ── fresh login after OAuth redirect ────────────────── */
    if (event === 'SIGNED_IN') {
      showAuthLoading()
      clearCachedProfile()

      /*
        fire callOnLogin in the background — do NOT await it here.
        with the postgres trigger in place, the profile row already exists
        by the time we hit this code, so getProfile() will find it immediately.
        callOnLogin just enriches it with ip/timezone data which can happen async.
        previously awaiting callOnLogin meant a cold-starting edge function
        (~2.5s on free tier) blocked the entire login flow.
      */
      callOnLogin(session.access_token).then(result => {
        //-- if the edge function comes back and says we're locked, act on it
        if (result?.profile?.locked && !currentProfile?.locked) {
          showLockScreen(result.profile.lock_reason)
        }
      }).catch(err => {
        console.warn('callOnLogin background error (non-fatal):', err.message)
      })

      //-- profile row exists immediately thanks to the postgres trigger
      currentProfile = await getProfile(session.user.id)

      if (!currentProfile) {
        showAuthError('Profile not found. Try signing out and back in.')
        return
      }

      if (currentProfile.locked) {
        showLockScreen(currentProfile.lock_reason)
        return
      }

      cacheProfile(currentProfile)
      hideLockScreen()
      renderLoggedIn(session.user, currentProfile, true)
      return
    }
  })
}

function setupLoginBtn() {
  const btn = document.getElementById('btn-login')
  if (!btn) return

  btn.addEventListener('click', () => {
    let accepted = false
    try { accepted = localStorage.getItem('nexus-license-v1') === '1' } catch { /* blocked */ }

    if (!accepted) {
      window.location.href = 'license.html'
      return
    }

    btn.disabled = true
    const span = btn.querySelector('span')
    if (span) span.textContent = 'Redirecting...'
    signInWithDiscord().catch(() => {
      btn.disabled = false
      if (span) span.textContent = 'Login with Discord'
    })
  })
}

function setupLockLogout() {
  const btn = document.getElementById('btn-lock-logout')
  if (!btn) return
  btn.addEventListener('click', async () => {
    btn.disabled = true
    try { await signOut() } catch { btn.disabled = false }
  })
}

function showLockScreen(reason) {
  document.getElementById('lock-reason').textContent = reason ? `Reason: ${reason}` : ''
  document.getElementById('lock-screen').hidden = false
  document.body.classList.remove('is-authed')
}

function hideLockScreen() {
  const el = document.getElementById('lock-screen')
  if (el) el.hidden = true
}

function showAuthLoading() {
  const navAuth = document.getElementById('nav-auth')
  if (navAuth) navAuth.innerHTML = '<span class="nav-loading">authenticating...</span>'
}

function showAuthError(msg) {
  const navAuth = document.getElementById('nav-auth')
  if (navAuth) navAuth.innerHTML = `<span class="nav-error">${esc(msg)}</span>`
}

function clearNav() {
  const navAuth = document.getElementById('nav-auth')
  if (navAuth) navAuth.innerHTML = ''
}

function renderLoggedIn(user, profile, freshLogin = false) {
  document.body.classList.add('is-authed')

  const navAuth = document.getElementById('nav-auth')
  if (navAuth) {
    navAuth.innerHTML = buildNavAuth(user, profile)

    const signOutBtn = document.getElementById('btn-signout')
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        signOutBtn.disabled = true
        clearCachedProfile()
        try { await signOut() } catch { signOutBtn.disabled = false }
      })
    }
  }

  const badge = document.getElementById('hero-badge-authed')
  if (badge) {
    const name = profile.username || user.user_metadata?.global_name || 'member'
    badge.textContent = `[ welcome back, ${name} ]`
  }

  //-- auto-scroll only on fresh SIGNED_IN on index.html
  const onIndexPage = window.location.pathname.endsWith('index.html')
                   || window.location.pathname === '/'
                   || window.location.pathname === ''
  if (freshLogin && onIndexPage) {
    const aboutSection = document.getElementById('about')
    if (aboutSection) {
      setTimeout(() => {
        aboutSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 600)
    }
  }
}

function buildNavAuth(user, profile) {
  const avatarUrl     = profile.avatar_url || buildDiscordAvatarUrl(user)
  const username      = profile.username || user.user_metadata?.global_name || 'member'
  const isSuperAdmin  = profile.is_super_admin === true
  const isAdmin       = isSuperAdmin || profile.role === 'admin'
  const isContributor = profile.is_contributor === true

  let iconSrc   = 'assets/icons/user.svg'
  let iconClass = 'nav-role-icon'
  if (isSuperAdmin) {
    iconSrc   = 'assets/icons/crown.svg'
    iconClass = 'nav-role-icon crown'
  } else if (isAdmin) {
    iconSrc = 'assets/icons/admin.svg'
  }

  const dashBtn = isAdmin
    ? `<a href="dashboard.html" class="btn-dashboard">[DASHBOARD]</a>`
    : ''

  const contribBadge = isContributor
    ? `<span class="nav-contributor-badge">CONTRIBUTOR</span>`
    : ''

  return `
    <div class="nav-user">
      <img src="${esc(avatarUrl)}" alt="${esc(username)}" class="nav-avatar" onerror="this.style.display='none'" />
      <span class="nav-username">${esc(username)}</span>
      ${contribBadge}
      <img src="${esc(iconSrc)}" alt="" class="${iconClass}" />
    </div>
    ${dashBtn}
    <button class="btn btn-secondary" id="btn-signout" style="padding:7px 14px;font-size:10px;">
      sign out
    </button>
  `.trim()
}

function buildDiscordAvatarUrl(user) {
  const meta      = user.user_metadata || {}
  const discordId = meta.provider_id || meta.sub || ''
  const hash      = meta.avatar_hash || meta.avatar || ''
  if (discordId && hash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.png?size=64`
  }
  return meta.picture || meta.avatar_url || ''
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

//-- fires callOnLogin as a background task on subsequent page loads (not SIGNED_IN)
//-- logs ip + timezone on every visit, checks if account got locked server-side
function logVisitInBackground(accessToken) {
  callOnLogin(accessToken).then(result => {
    if (result?.profile?.locked && !currentProfile?.locked) {
      showLockScreen(result.profile.lock_reason)
    }
  }).catch(err => {
    console.warn('background ip log failed (non-fatal):', err.message)
  })
}

init()