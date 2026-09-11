// api/selftest.ts
//
// ⚠️ TEMPORARY — DELETE AFTER USE. Added 2026-09-11 to verify one thing that
// could not be verified any other way: that a server-side error actually
// reaches Sentry in production.
//
// WHY THIS EXISTS. The browser half of error reporting was proved end to end on
// 2026-09-10 by throwing a real error at the live site and watching it arrive.
// The serverless half could not be: every failure path in api/ returns a
// validated 4xx *before* reaching the catch block that reports, which is
// correct behaviour and also means there is no way to trigger a genuine server
// error from outside. This endpoint is the missing trigger.
//
// It could not be added earlier. Vercel's Hobby plan caps the project at 12
// serverless functions and api/ sat at exactly 12; retiring the one-time
// billing endpoints dropped it to 10, which is what made room for this.
//
// SAFETY. Guarded by CRON_SECRET, the same bearer check api/cleanup-scan-
// rejections.ts uses, so it is not publicly callable. It touches no database,
// no payment provider and no user data. It never returns the DSN — only whether
// one is configured — because the point is to diagnose configuration, not to
// expose it.
//
// DELETE THIS FILE once the event has been confirmed in the intrack-api Sentry
// project. It is a diagnostic, not a feature, and every routed file in api/
// counts against the function cap.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { captureError } from './_lib/monitoring.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Reported before the throw, and independently of it. If SENTRY_DSN is
  // missing or empty in Vercel, captureError silently no-ops by design — the
  // event simply never appears and that is indistinguishable from a healthy
  // app with no errors. This flag is what tells the two apart, and it answers
  // the question even if the delivery below fails for some other reason.
  const dsnConfigured = Boolean(process.env.SENTRY_DSN)

  // Constructed rather than thrown and caught. A throw/catch round trip would
  // read as more realistic but changes nothing that matters — Sentry reports
  // the stack recorded when the Error was constructed, and an unconditional
  // throw makes the `false` initialiser dead code that lint correctly rejects.
  const error = new Error('Intrack server-side Sentry selftest — safe to resolve')

  // Awaited on purpose. A serverless function can be frozen the moment it
  // returns, so an un-awaited flush is a report that may never leave.
  await captureError(error, { route: 'selftest', deliberate: true })

  return res.status(200).json({
    dsnConfigured,
    // Length only, never the value — enough to spot an empty or truncated
    // variable without putting the DSN in an HTTP response.
    dsnLength: (process.env.SENTRY_DSN || '').length,
    environment: process.env.VERCEL_ENV ?? 'unknown',
    captureErrorCalled: true,
    note: dsnConfigured
      ? 'Check the intrack-api project in Sentry for "Intrack server-side Sentry selftest".'
      : 'SENTRY_DSN is NOT set in this environment — nothing was sent. Add it in Vercel and redeploy.',
  })
}
