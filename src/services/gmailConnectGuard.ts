// ============================================
// Gmail connect guard
//
// "Connect Gmail Inbox" is a full Supabase sign-in with Google (see
// signInWithGoogle in AuthContext), not a link to the account already signed
// in. If the user picks a different Google account on Google's chooser, the
// app comes back signed in as whichever Intrack account belongs to that
// address — a brand-new trial account if none existed — and their real data
// appears to vanish.
//
// Before redirecting we remember who was signed in. When the app loads again,
// AuthContext compares the returning session with this record and, on a
// mismatch, withholds the new session and restores the original one.
// ============================================

import type { Session } from '@supabase/supabase-js'

// Contains "oauth" on purpose: signOut() purges every localStorage key whose
// name includes it, so a stale record never outlives the session it copies.
export const GMAIL_CONNECT_ORIGIN_KEY = 'intrack_gmail_oauth_origin'

// Long enough for a Google sign-in with 2-step verification; short enough that
// an abandoned attempt is not acted on days later.
export const GMAIL_CONNECT_ORIGIN_TTL_MS = 15 * 60 * 1000

export interface GmailConnectOrigin {
  userId: string
  email: string | null
  accessToken: string
  refreshToken: string
  startedAt: number
}

/** Record the signed-in account just before redirecting to Google. */
export function rememberGmailConnectOrigin(
  session: Pick<Session, 'access_token' | 'refresh_token' | 'user'>,
  now: number = Date.now()
): void {
  const origin: GmailConnectOrigin = {
    userId: session.user.id,
    email: session.user.email ?? null,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    startedAt: now,
  }
  try {
    localStorage.setItem(GMAIL_CONNECT_ORIGIN_KEY, JSON.stringify(origin))
  } catch {
    // Storage unavailable: the connect still works, only the guard is lost.
  }
}

/**
 * Read and delete the record. Returns null when there is none, it is
 * malformed, or it is older than the TTL. Always deletes, so a record is acted
 * on at most once.
 */
export function takeGmailConnectOrigin(now: number = Date.now()): GmailConnectOrigin | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(GMAIL_CONNECT_ORIGIN_KEY)
    localStorage.removeItem(GMAIL_CONNECT_ORIGIN_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<GmailConnectOrigin>
    if (
      typeof parsed?.userId !== 'string' || !parsed.userId ||
      typeof parsed.accessToken !== 'string' || !parsed.accessToken ||
      typeof parsed.refreshToken !== 'string' || !parsed.refreshToken ||
      typeof parsed.startedAt !== 'number'
    ) {
      return null
    }
    const age = now - parsed.startedAt
    if (age < 0 || age > GMAIL_CONNECT_ORIGIN_TTL_MS) return null
    return {
      userId: parsed.userId,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

/** True when the session that came back belongs to another Intrack account. */
export function isDifferentGmailConnectAccount(
  origin: GmailConnectOrigin | null,
  returnedUserId: string | null | undefined
): boolean {
  return !!origin && !!returnedUserId && returnedUserId !== origin.userId
}
