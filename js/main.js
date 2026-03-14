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

  /*
    onAuthStateChange is the single source of truth for session state.
    INITIAL_SESSION fires once on page load once supabase has finished
    restoring auth from localStorage — this replaces the old getSession()
    call which had a race condition on Vercel where it could resolve before
    the OAuth hash fragment was parsed and stored.
  */
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
        //-- fast path: profile is in sessionStorage, no db hit needed
        console.log('restored from session cache instantly')
        currentProfile = cached
        if (currentProfile.locked) {
          showLockScreen(currentProfile.lock_reason)
        } else {
          renderLoggedIn(session.user, currentProfile)
          //-- fire ip log silently, never blocks ui
          logVisitInBackground(session.access_token)
        }
        return
      }

      //-- slow path: no cache, fetch from db
      console.log('INITIAL_SESSION: no cache, fetching profile...')
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
        //-- profile somehow got lost, recover it
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
        call the edge function first — it creates/upserts the profile row
        and does ip logging. if it returns a profile, use that directly.
        if it fails (cold start, network, not deployed) we fall through
        and let getProfile() retry until the row appears.
        on Vercel, the edge function can take a few seconds on cold start,
        so getProfile() in supabase-client.js now retries up to 10 times.
      */
      let result = null
      try {
        result = await callOnLogin(session.access_token)
      } catch (err) {
        console.error('callOnLogin threw:', err)
      }

      if (result?.profile) {
        currentProfile = result.profile
      } else {
        //-- edge function failed or returned nothing — poll until the row exists
        console.log('SIGNED_IN: edge function returned no profile, polling db...')
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

//-- fires callOnLogin as a background task — no await, never blocks the ui.
//-- logs ip + timezone to ip_logs and sessions on every page load.
//-- if the edge function is down it just warns quietly and moves on.
function logVisitInBackground(accessToken) {
  callOnLogin(accessToken).then(result => {
    if (result?.profile) {
      if (result.profile.locked && !currentProfile?.locked) {
        showLockScreen(result.profile.lock_reason)
      }
    }
  }).catch(err => {
    console.warn('background ip log failed (non-fatal):', err.message)
  })
}

init()