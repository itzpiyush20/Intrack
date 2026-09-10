// ============================================
// monitoring — error reporting
//
// The app shipped with no error reporting at all. ErrorBoundary carried a
// comment promising Sentry and nothing behind it, so a user hitting a render
// crash, a failed payment verification or a scan that died mid-run produced
// exactly zero signal anywhere the operator could see it. The only channel was
// the user choosing to write to support.
//
// INERT WITHOUT A DSN. Everything here no-ops unless VITE_SENTRY_DSN is set, so
// local development and tests never talk to a third party, and a deploy that
// has not had the variable added yet behaves exactly as it did before.
//
// PRIVACY. This is a personal-finance app scanning a user's mail, so what gets
// sent needs deciding rather than defaulting:
//
//   - sendDefaultPii stays FALSE. Sentry would otherwise attach IP address and
//     the request headers, cookies included.
//   - No session replay and no profiling. Both would capture the screen and
//     the DOM, meaning transaction amounts, merchants and email subjects.
//   - beforeSend strips the query string and hash from any URL it reports.
//     Supabase returns OAuth tokens in the URL hash on the auth callback, and
//     `?auth=` deep links carry flow state; neither belongs in an error report.
//   - Breadcrumbs from console and fetch bodies are off, because the scanner
//     logs merchant names and amounts to console while it runs.
//
// The trade is deliberate: less context per error, nothing sensitive leaving
// the browser. If an error later proves undiagnosable without more, add the
// specific field rather than turning the defaults back on.
// ============================================

import * as Sentry from '@sentry/react'

let initialized = false

/** Strip everything after the path — hash carries OAuth tokens, query carries flow state. */
function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    // Not a parseable absolute URL. Cut at the first ? or # and keep the rest.
    return url.split(/[?#]/)[0]
  }
}

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn || initialized) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only. Performance tracing samples every navigation and would carry
    // the same URLs scrubbed below, at a cost in free-tier quota that buys
    // nothing while the question is "did anything break".
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // The default integrations include Breadcrumbs, which records console calls
    // and fetch/XHR. The scanner narrates merchants and amounts to console, so
    // that is exactly what must not be attached.
    integrations: (defaults) =>
      defaults.filter(
        (integration) =>
          integration.name !== 'Breadcrumbs' &&
          integration.name !== 'BrowserSession',
      ),
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url)
      // Cookies and headers are only present when sendDefaultPii is on, but
      // deleting them unconditionally means a future config change cannot
      // quietly start leaking them.
      delete event.request?.cookies
      delete event.request?.headers
      delete event.user
      return event
    },
  })

  initialized = true
}

/**
 * Report a caught error. Safe to call whether or not monitoring is configured —
 * without a DSN this is just the console line the code had before.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (initialized) {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  }
}
