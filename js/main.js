/*
  main.js
  auth state management, nav rendering, lock screen, preloader, misc ui
*/

import { supabase, signInWithDiscord, signOut, getProfile, callOnLogin } from './supabase-client.js'

let currentProfile = null

/*
  cache profile in sessionStorage so tab switches don't re-auth
  sessionStorage is per-tab and clears when the tab closes — safe to use
*/
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

  /*
    step 1: check sessionStorage cache — if we already loaded the profile
    this tab session, use it instantly with no network call at all
    this is what prevents the re-auth flash when switching tabs
  */
  const cached = getCachedProfile()

  /*
    step 2: getSession() reads from localStorage — no network, instant
    same call debug.html makes that always works
  */
  const { data: { session: initialSession } } = await supabase.auth.getSession()

  if (!initialSession) {
    clearCachedProfile()
    clearNav()
  } else if (cached) {
    /*
      session exists AND we have a cached profile — render immediately
      no network call needed, tab switch won't re-auth
    */
    console.log('restored from session cache instantly')
    currentProfile = cached
    if (currentProfile.locked) {
      showLockScreen(currentProfile.lock_reason)
    } else {
      renderLoggedIn(initialSession.user, currentProfile)
    }
  } else {
    /*
      session exists but no cache (first load, or cache cleared)
      fetch the profile from supabase
    */
    console.log('session found, fetching profile...')
    currentProfile = await getProfile(initialSession.user.id)

    if (!currentProfile) {
      showAuthError('Profile not found. Try signing out and back in.')
    } else if (currentProfile.locked) {
      showLockScreen(currentProfile.lock_reason)
    } else {
      cacheProfile(currentProfile)
      renderLoggedIn(initialSession.user, currentProfile)
    }
  }

  /*
    step 3: listen for actual state changes after initial load
    INITIAL_SESSION is skipped — already handled above
    TOKEN_REFRESHED is skipped if we already have a profile — no re-auth on tab switch
  */
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('auth state change:', event)

    if (event === 'INITIAL_SESSION') {
      return // handled above
    }

    if (event === 'SIGNED_OUT' || !session) {
      currentProfile = null
      clearCachedProfile()
      hideLockScreen()
      document.body.classList.remove('is-authed')
      clearNav()
      return
    }

    if (event === 'TOKEN_REFRESHED') {
      /*
        this fires when you switch back to the tab — DO NOT re-auth
        if we have a profile, we're fine, just silently refresh the token
        if somehow we don't, fetch quietly without showing the loading state
      */
      if (!currentProfile) {
        currentProfile = getCachedProfile() || await getProfile(session.user.id)
        if (currentProfile) {
          cacheProfile(currentProfile)
          if (!currentProfile.locked) renderLoggedIn(session.user, currentProfile)
        }
      }
      return
    }

    if (event === 'SIGNED_IN') {
      /*
        actual fresh login from discord oauth redirect
        run the edge function for ip logging + lock check
      */
      showAuthLoading()
      clearCachedProfile()

      try {
        const result = await callOnLogin(session.access_token)
        if (result?.profile) {
          currentProfile = result.profile
        } else {
          currentProfile = await getProfile(session.user.id)
        }
      } catch (err) {
        console.error('login flow error:', err)
        currentProfile = await getProfile(session.user.id)
      }

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
      renderLoggedIn(session.user, currentProfile)
    }
  })
}

function setupLoginBtn() {
  const btn = document.getElementById('btn-login')
  if (!btn) return

  btn.addEventListener('click', async () => {
    btn.disabled = true
    const span = btn.querySelector('span')
    if (span) span.textContent = 'Redirecting...'
    try {
      await signInWithDiscord()
    } catch {
      btn.disabled = false
      if (span) span.textContent = 'Login with Discord'
    }
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

function renderLoggedIn(user, profile) {
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

init()