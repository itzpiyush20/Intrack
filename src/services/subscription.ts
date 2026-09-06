// ============================================================
// Subscription entitlement — the single definition of "premium"
//
// Deliberately dependency-free. This predicate is needed by the browser scan
// path, by the UI's quota accessor, and by the serverless daily cron, and the
// cron must be able to import it WITHOUT dragging in emailScanner.ts and its
// Supabase client import chain.
//
// It lived inside emailScanner.ts, which meant the cron could not reach it and
// grew its own copy instead. The two drifted: the cron's version treated a
// trial with no expiry date as entitled, so those users received a daily
// automatic scan the free tier is not entitled to (requirement R6). Keeping
// this in one importable place is what stops that recurring.
// ============================================================

/**
 * Pure: is this profile row currently entitled to premium behaviour?
 *
 * Correcting a lapsed subscription's stored status is deliberately NOT done
 * here — that write stays on the scan path, keeping this safe to call from a
 * read.
 */
export function isPremiumProfile(
  profile: { subscription_status?: string | null; subscription_expires_at?: string | null } | null | undefined,
  now: number = Date.now()
): boolean {
  if (!profile) return false
  const expiresAt = profile.subscription_expires_at
  if (profile.subscription_status === 'active') {
    // An active subscription with no end date is open-ended.
    return !expiresAt || new Date(expiresAt).getTime() > now
  }
  if (profile.subscription_status === 'trial' || profile.subscription_status === 'cancelled') {
    // A trial or cancelled subscription retains access until its unexpired end date.
    return !!expiresAt && new Date(expiresAt).getTime() > now
  }
  return false
}
