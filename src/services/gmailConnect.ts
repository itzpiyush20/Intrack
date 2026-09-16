// ============================================================
// gmailConnect.ts — "Connect Gmail Inbox" as a permission, not a sign-in
//
// Connect Gmail used to be a Supabase sign-in with Google that also asked for
// gmail.readonly. Picking a different Google account on Google's chooser signed
// the user into (or CREATED) a different Intrack account. See
// plans/gmail-connect-permission-only.md.
//
// This asks Google for an access token only, through Google Identity Services'
// token client in a popup. The Supabase session is never touched, so no account
// can be created or switched. Owner rule (2026-09-16): the Gmail address must be
// the Intrack login email. A different pick is refused and the permission just
// granted is revoked at Google.
// ============================================================

import { revokeGoogleAccessToken } from './googleAuth'

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const GIS_LOAD_TIMEOUT_MS = 10000

export type GmailConnectResult =
  | { ok: true; token: string }
  | {
      ok: false
      reason:
        | 'not_configured'
        | 'no_login_email'
        | 'script_failed'
        | 'popup_closed'
        | 'popup_blocked'
        | 'scope_denied'
        | 'verify_failed'
        | 'wrong_account'
      pickedEmail?: string
    }

export interface TokenResponse {
  access_token?: string
  scope?: string
  error?: string
}

export interface GmailConnectDeps {
  /** Opens Google's popup. Rejects with Error('popup_closed' | 'popup_blocked' | 'script_failed'). */
  requestToken: (clientId: string, loginHint: string) => Promise<TokenResponse>
  /** Gmail address the token belongs to; null when it cannot be read. */
  fetchGmailAddress: (token: string) => Promise<string | null>
  revokeToken: (token: string) => Promise<void>
}

// ── Email comparison ─────────────────────────────────────────

/**
 * Canonical form for comparing a login email with a Gmail address. Gmail
 * ignores dots and "+tag" in the local part, and googlemail.com is gmail.com,
 * so "Piyush.S+bank@googlemail.com" and "piyushs@gmail.com" are one mailbox.
 * Other domains (including Google Workspace) are compared case-insensitively
 * only — their dot and plus rules are the domain owner's to decide.
 */
export function normalizeMailbox(email: string): string {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return trimmed
  let local = trimmed.slice(0, at)
  let domain = trimmed.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') {
    local = local.split('+')[0].replace(/\./g, '')
  }
  return `${local}@${domain}`
}

export function isSameMailbox(a: string, b: string): boolean {
  return normalizeMailbox(a) === normalizeMailbox(b)
}

export function hasGmailScope(scope: string | undefined): boolean {
  return !!scope && scope.split(/\s+/).includes(GMAIL_READONLY_SCOPE)
}

// ── Flow ─────────────────────────────────────────────────────

export async function connectGmailInbox(
  { clientId, loginEmail }: { clientId: string | undefined; loginEmail: string | null | undefined },
  deps: GmailConnectDeps = browserDeps
): Promise<GmailConnectResult> {
  if (!clientId) return { ok: false, reason: 'not_configured' }
  if (!loginEmail) return { ok: false, reason: 'no_login_email' }

  let response: TokenResponse
  try {
    response = await deps.requestToken(clientId, loginEmail)
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'popup_closed' || code === 'popup_blocked') return { ok: false, reason: code }
    return { ok: false, reason: 'script_failed' }
  }

  const token = response.access_token
  if (response.error === 'access_denied') return { ok: false, reason: 'scope_denied' }
  if (!token) return { ok: false, reason: 'script_failed' }
  if (!hasGmailScope(response.scope)) return { ok: false, reason: 'scope_denied' }

  const picked = await deps.fetchGmailAddress(token).catch(() => null)
  // Unverifiable: refuse, but do not revoke — it may well be the right account.
  if (!picked) return { ok: false, reason: 'verify_failed' }

  if (!isSameMailbox(picked, loginEmail)) {
    await deps.revokeToken(token).catch(() => {})
    return { ok: false, reason: 'wrong_account', pickedEmail: picked }
  }

  return { ok: true, token }
}

/** User-facing text for a failed connect. null = say nothing (user closed the popup). */
export function gmailConnectErrorMessage(
  result: Exclude<GmailConnectResult, { ok: true }>,
  loginEmail: string | null | undefined
): string | null {
  const login = loginEmail || 'your Intrack email'
  switch (result.reason) {
    case 'popup_closed':
      return null
    case 'wrong_account':
      return `You picked ${result.pickedEmail ?? 'a different Google account'}, but Gmail can only be connected with the account you sign in to Intrack with (${login}). We cancelled the permission you just gave. Try again and pick ${login}.`
    case 'popup_blocked':
      return "Your browser blocked Google's window. Allow pop-ups for this site and try again."
    case 'scope_denied':
      return "Intrack needs permission to read your Gmail to scan it. Try again and allow Gmail access on Google's screen."
    case 'verify_failed':
      return "We couldn't confirm which Gmail account you picked, so it wasn't connected. Please try again."
    case 'no_login_email':
      return 'Your Intrack account has no email address, so Gmail cannot be connected.'
    case 'not_configured':
      return 'Gmail connection is not set up on this site yet. Please contact support.'
    case 'script_failed':
    default:
      return "Couldn't reach Google. Check your connection and try again."
  }
}

// ── Browser implementation (Google Identity Services) ────────

interface GisTokenClient {
  requestAccessToken: () => void
}

interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    login_hint?: string
    prompt?: string
    include_granted_scopes?: boolean
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string }) => void
  }) => GisTokenClient
}

type GisWindow = Window & { google?: { accounts?: { oauth2?: GisOAuth2 } } }

let gisLoad: Promise<GisOAuth2> | null = null

/**
 * Load the GIS script once. Call on mount of any page with a Connect button:
 * browsers only allow a popup shortly after the click, so the script must
 * already be there when the user presses it.
 */
export function preloadGmailConnect(): Promise<GisOAuth2> {
  if (typeof window === 'undefined') return Promise.reject(new Error('script_failed'))
  const existing = (window as GisWindow).google?.accounts?.oauth2
  if (existing) return Promise.resolve(existing)
  if (gisLoad) return gisLoad

  gisLoad = new Promise<GisOAuth2>((resolve, reject) => {
    const fail = () => {
      gisLoad = null
      // Drop a failed tag so the next attempt downloads the script again.
      document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`)?.remove()
      reject(new Error('script_failed'))
    }
    const timer = setTimeout(fail, GIS_LOAD_TIMEOUT_MS)
    const done = () => {
      clearTimeout(timer)
      const oauth2 = (window as GisWindow).google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else fail()
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = GIS_SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', () => { clearTimeout(timer); fail() }, { once: true })
  })
  // Avoid an unhandled rejection when nobody awaits the preload.
  gisLoad.catch(() => {})
  return gisLoad
}

const browserDeps: GmailConnectDeps = {
  requestToken: async (clientId, loginHint) => {
    const oauth2 = await preloadGmailConnect()
    return new Promise<TokenResponse>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GMAIL_READONLY_SCOPE,
        login_hint: loginHint,
        // Account chooser / consent only when Google needs it.
        prompt: '',
        include_granted_scopes: true,
        callback: resolve,
        error_callback: (err) => {
          if (err?.type === 'popup_closed') reject(new Error('popup_closed'))
          else if (err?.type === 'popup_failed_to_open') reject(new Error('popup_blocked'))
          else reject(new Error('script_failed'))
        },
      })
      client.requestAccessToken()
    })
  },

  fetchGmailAddress: async (token) => {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { emailAddress?: string }
    return body.emailAddress ?? null
  },

  revokeToken: revokeGoogleAccessToken,
}
