/*
  supabase-client.js
  init the supabase client and export helpers used by main.js
  swap in your actual URL + anon key before deploying
*/

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

//-- replace both of these before going live
const SUPABASE_URL      = 'https://kucyrvkzuxoyldkgcois.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_TIOJAgZ-xperGTVO6KbXyg_xIQ8qwx5'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:      true,
    autoRefreshToken:    true,
    detectSessionInUrl:  true,
    storageKey:          'nexus-auth',
  }
})

/*
  sign in with discord via supabase oauth
  redirectTo should be wherever the site is hosted
  on live server it's usually http://localhost:5500
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
  fetch the profile row for the current user with retry logic
  the database trigger creates the profile async, so we might need to wait a bit
  returns the profile object or null if not found after retries
*/
export async function getProfile(userId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        // PGRST116 = no rows returned
        if (error.code === 'PGRST116') {
          if (i < retries - 1) {
            console.log(`profile not found yet (attempt ${i + 1}/${retries}), waiting...`)
            await new Promise(resolve => setTimeout(resolve, 800))
            continue
          }
          console.log('no profile found after retries for user', userId)
          return null
        }
        console.error('get profile error', error.code, error.message)
        return null
      }

      console.log('profile fetched successfully:', data)
      return data
    } catch (err) {
      console.error('unexpected error in getProfile:', err)
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 800))
        continue
      }
      return null
    }
  }
  return null
}

/*
  call the on-login edge function after a successful sign in
  this is what handles ip logging, lock checks, and profile upsert server-side
  passes the user's timezone so the function can store it
*/
export async function callOnLogin(accessToken) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  console.log('calling on-login edge function...')

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/on-login`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
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