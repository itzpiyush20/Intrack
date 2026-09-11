// ============================================
// api/_lib/monitoring — server-side error reporting
//
// The serverless half of src/lib/monitoring.ts. Vercel's runtime logs already
// hold a thrown exception, but they are retention-limited, unsearchable across
// functions, and nobody is watching them at 2am — which is precisely when a
// webhook failure silently costs a customer their subscription.
//
// INERT WITHOUT A DSN. No SENTRY_DSN, no initialisation, no network call. Note
// this is SENTRY_DSN, not VITE_SENTRY_DSN: the client variable is embedded in
// the browser bundle, and the two should be separate Sentry projects so a
// server error is never confused for a user's crash.
//
// PRIVACY. Same posture as the client: sendDefaultPii off, no tracing, and
// beforeSend drops request headers. `authorization` and `x-razorpay-signature`
// both live in headers on these routes, and neither is worth having in an
// error report.
//
// A serverless function may be frozen between invocations, so captureError
// flushes with a short timeout rather than trusting a background send that the
// platform is entitled to kill the moment the handler returns.
// ============================================

import * as Sentry from '@sentry/node'

let initialized = false

function ensureInit(): boolean {
  if (initialized) return true

  const dsn = process.env.SENTRY_DSN
  if (!dsn) return false

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.request?.headers
      delete event.request?.cookies
      delete event.user
      return event
    },
  })

  initialized = true
  return true
}

/**
 * Report a caught server error. Awaiting this is optional but preferred on a
 * path that is about to return a response — see the flush note above.
 *
 * Never throws: a monitoring failure must not turn a handled 500 into an
 * unhandled one.
 */
export async function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!ensureInit()) return
    Sentry.captureException(error, context ? { extra: context } : undefined)
    await Sentry.flush(2000)
  } catch {
    // Swallowed deliberately. Reporting is best-effort.
  }
}

/**
 * Report a condition that is not an exception but that an operator needs to
 * see — the upstream Gemini 429 being the motivating case.
 *
 * Why this is not `captureError`: nothing threw. The request was handled
 * correctly and the user got a correct, gracefully degraded result. There is
 * no stack trace worth keeping and no bug to fix in this repo. What there IS,
 * is a fact about the outside world (an exhausted API quota) that is
 * invisible everywhere else, because every layer below is built to shrug a
 * missing AI verdict off.
 *
 * Flushes like captureError, and for the same reason — the platform may freeze
 * this instance the moment the handler returns. Callers on a hot path must
 * throttle rather than skip the await; see `shouldReportUpstream429` in
 * gemini-proxy.
 *
 * Never throws.
 */
export async function captureWarning(
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!ensureInit()) return
    Sentry.captureMessage(message, {
      level: 'warning',
      ...(context ? { extra: context } : {}),
    })
    await Sentry.flush(2000)
  } catch {
    // Swallowed deliberately. Reporting is best-effort.
  }
}
