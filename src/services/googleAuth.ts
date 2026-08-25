// ============================================================
// googleAuth.ts — Single source of truth for Google OAuth tokens
//
// Google access tokens (provider_token) expire after 3600 seconds.
// Supabase stores the token only during the initial OAuth callback —
// after any session refresh or page reload, session.provider_token is null.
//
// This module persists:
//   - provider_token (access token, 58 min TTL)  → localStorage
//   - provider_refresh_token (long-lived)         → SERVER ONLY, never the browser
//
// The long-lived refresh token is deliberately NOT kept client-side: it is a
// permanent Gmail credential, so an XSS that reads localStorage would otherwise
// hand an attacker durable inbox access that survives password changes. It is
// held in the google_oauth_tokens table (RLS-locked to service-role) and used
// only by our own serverless functions.
//
// When the access token expires, tryRefreshGoogleToken() calls
// /api/refresh-google-token with just the caller's Supabase JWT; the server
// looks the refresh token up by user id and returns a fresh access token. The
// user never needs to re-authenticate unless they revoke access in their Google
// account settings or disconnect Gmail in-app.
// ============================================================

const TOKEN_KEY = 'intrack_google_token'
const EXPIRY_KEY = 'intrack_google_token_expiry'

// Non-credential marker recording that this account has a refresh token stored
// server-side. Lets tryRefreshGoogleToken() keep its cheap "not connected"
// short-circuit instead of firing a request on every load for users who have
// never linked Gmail. Losing it is harmless — it self-heals on the next
// successful save, and only costs one extra 410 in the meantime.
const LINKED_KEY = 'intrack_google_linked'

// Pre-migration key: the long-lived refresh token used to be stored here.
// Retained only so migrateLegacyRefreshToken() can move it server-side and
// erase it from browsers that still hold one.
const LEGACY_REFRESH_TOKEN_KEY = 'intrack_google_refresh_token'

const TOKEN_TTL_MS = 58 * 60 * 1000 // 58 minutes (Google tokens last 60 min)

// ── Access token ─────────────────────────────────────────────

export function saveGoogleToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(EXPIRY_KEY, (Date.now() + TOKEN_TTL_MS).toString())
}

export function getGoogleToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return null

  const expiry = localStorage.getItem(EXPIRY_KEY)
  if (expiry && Date.now() > parseInt(expiry, 10)) {
    clearGoogleToken()
    return null
  }

  return token
}

export function isGoogleConnected(): boolean {
  return getGoogleToken() !== null
}

// Clears only the access token — keeps the refresh token so silent refresh still works.
export function clearGoogleToken(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EXPIRY_KEY)
}

// Clears all local Google state — call on sign-out, on disconnect, or when the
// refresh token is revoked. The server-side refresh token is NOT covered here:
// removing that is /api/disconnect-gmail's job, so that sign-out on one device
// doesn't silently kill the daily sync the user set up.
export function clearAllGoogleTokens(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EXPIRY_KEY)
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
}

// ── Refresh token (server-held) ───────────────────────────────

/** True if this account is known to have a refresh token stored server-side. */
export function isGoogleLinked(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(LINKED_KEY) === 'true'
}

function setGoogleLinked(linked: boolean): void {
  if (typeof localStorage === 'undefined') return
  if (linked) localStorage.setItem(LINKED_KEY, 'true')
  else localStorage.removeItem(LINKED_KEY)
}

/**
 * Persist the Google refresh token server-side so the automatic daily sync
 * cron can use it without a live browser session. Never stores it locally.
 * Returns true if the save was confirmed — callers that need to know (the
 * legacy migration below) rely on this before discarding their only copy.
 * Everyone else can treat it as fire-and-forget: a failure just means the user
 * keeps manual-only sync until the next login re-attempts the save.
 */
export async function saveGoogleRefreshTokenServerSide(supabaseJwt: string, refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('/api/save-google-refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseJwt}` },
      body: JSON.stringify({ refreshToken }),
    })
    if (res.ok) setGoogleLinked(true)
    return res.ok
  } catch (e) {
    console.warn('saveGoogleRefreshTokenServerSide error:', e)
    return false
  }
}

/**
 * One-time migration for users upgrading from the build that kept the
 * long-lived refresh token in localStorage. Moves any leftover token to the
 * server and erases the local copy, so existing Gmail connections keep working
 * without a re-authorisation prompt.
 *
 * The local copy is only removed once the server confirms the save — dropping
 * it on a failed request would silently downgrade the user to manual sync.
 */
export async function migrateLegacyRefreshToken(supabaseJwt: string): Promise<void> {
  if (typeof localStorage === 'undefined') return
  const legacy = localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY)
  if (!legacy) return
  if (!supabaseJwt) return

  const saved = await saveGoogleRefreshTokenServerSide(supabaseJwt, legacy)
  if (saved) localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY)
}

/**
 * Revoke the Google grant and delete the server-side refresh token.
 * Also clears local tokens so the UI immediately reflects the disconnect.
 */
export async function disconnectGmail(supabaseJwt: string): Promise<{ error: string | null }> {
  try {
    const res = await fetch('/api/disconnect-gmail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supabaseJwt}` },
    })
    // Local state is cleared regardless: if the server call failed the user
    // should still not keep using a connection they asked to sever, and the
    // next scan attempt will surface the real error.
    clearAllGoogleTokens()
    setGoogleLinked(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      return { error: body.error || 'Failed to disconnect Gmail' }
    }
    return { error: null }
  } catch (e: any) {
    clearAllGoogleTokens()
    setGoogleLinked(false)
    return { error: e?.message || 'Failed to disconnect Gmail' }
  }
}

// ── Silent refresh ────────────────────────────────────────────

/**
 * Ask the server to exchange this user's stored refresh token for a new access
 * token. The refresh token itself never leaves the server — the endpoint looks
 * it up by the authenticated user id, so nothing about the caller's identity is
 * taken from the request body.
 *
 * Returns the new access token on success, null if refresh is not possible.
 * A 410 means the grant is gone (revoked in Google settings, or never stored):
 * local state is cleared so the UI prompts a reconnect.
 */
export async function tryRefreshGoogleToken(supabaseJwt: string): Promise<string | null> {
  if (!supabaseJwt) return null
  // Skip the round-trip entirely for accounts that have never linked Gmail.
  if (!isGoogleLinked()) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6000)

  try {
    const res = await fetch('/api/refresh-google-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseJwt}`,
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.status === 410) {
      // Grant revoked in Google account settings, or no token stored server-side
      clearAllGoogleTokens()
      setGoogleLinked(false)
      return null
    }

    if (!res.ok) return null

    const { accessToken } = await res.json() as { accessToken: string }
    if (accessToken) {
      saveGoogleToken(accessToken)
      return accessToken
    }
    return null
  } catch (e) {
    clearTimeout(timeoutId)
    console.warn('tryRefreshGoogleToken error:', e)
    return null
  }
}

// ── Validation & migration ────────────────────────────────────

export async function validateGoogleToken(token: string): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (res.status === 401 || res.status === 403) {
      if (token === localStorage.getItem(TOKEN_KEY)) {
        clearGoogleToken()
      }
      return false
    }
    return res.ok
  } catch (e) {
    clearTimeout(timeoutId)
    console.warn('validateGoogleToken error:', e)
    return false
  }
}

// Remove the very old token key from pre-v2 of the app.
export function purgeOldTokenKey(): void {
  localStorage.removeItem('intrack_oauth_provider_token')
}
