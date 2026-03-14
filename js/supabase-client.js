/*
  supabase-client.js
  init the supabase client and export helpers used by main.js
  swap in your actual URL + anon key before deploying
*/

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

//-- replace both of these before going live
const SUPABASE_URL      = 'https://kucyrvkzuxoyldkgcois.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1Y3lydmt6dXhveWxka2djb2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjA4NTUsImV4cCI6MjA4ODk5Njg1NX0.ODYxi3XN5pueayu_IftYZHYtdFOlrtcbwCDTBd4mJxE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storageKey:         'nexus-auth',
  }
})

/*
  sign in with discord via supabase oauth
  redirectTo should be wherever the site is hosted
*/
export async function signInWithDiscord() {
  /*
    supabase handles the oauth redirect back to this url
    the callback url registered in the supabase discord provider settings is:
    https://kucyrvkzuxoyldkgcois.supabase.co/auth/v1/callback
    the redirectTo here is where supabase sends the user AFTER the callback completes
  */
  const redirectTo = window.location.origin + window.location.pathname
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo }
  })
  if (error) {
    console.error('discord oauth error', error.message)
    throw error
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('sign out error', error.message)
    throw error
  }
}

/*
  fetch the profile row for the current user with retry logic.
  on Vercel, the on-login edge function can cold-start and take a few seconds
  to write the profile row, so we need to be patient.
  10 attempts, delay grows from 800ms to 3000ms — roughly 20s total budget.
  returns the profile object or null if not found after all retries.
*/
export async function getProfile(userId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      //-- delay grows each attempt, capped at 3s
      const waitMs = Math.min(800 + i * 400, 3000)
      console.log(`profile not found yet (attempt ${i + 1}/${maxAttempts}), waiting ${waitMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        //-- PGRST116 = no rows returned yet, keep retrying
        if (error.code === 'PGRST116') continue

        //-- any other error is a real problem, no point retrying
        console.error('get profile error', error.code, error.message)
        return null
      }

      console.log(`profile fetched on attempt ${i + 1}:`, data)
      return data

    } catch (err) {
      console.error('unexpected error in getProfile:', err)
      //-- network error, still worth retrying unless we're on the last attempt
      if (i >= maxAttempts - 1) return null
    }
  }

  console.log('no profile found after', maxAttempts, 'attempts for user', userId)
  return null
}

/*
  call the on-login edge function after a successful sign in.
  this handles ip logging, lock checks, and profile upsert server-side.
  passes the user's timezone so the function can store it.
*/
export async function callOnLogin(accessToken) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  console.log('calling on-login edge function...')

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/on-login`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey':        SUPABASE_ANON_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ timezone }),
    })

    console.log('on-login response status:', res.status)

    if (!res.ok) {
      const text = await res.text()
      console.error('on-login function error', res.status, text)
      return null
    }

    const json = await res.json()
    console.log('on-login success:', json)
    return json

  } catch (err) {
    console.error('on-login fetch failed:', err.message)
    console.log('edge function might not be deployed - will fall back to direct profile fetch')
    return null
  }
}

export default supabase