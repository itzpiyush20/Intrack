# Intrack

Personal-finance / expense tracker for the Indian market (INR, dd/mm/yyyy). React +
TypeScript + Vite, Supabase (Postgres + auth), Vercel serverless functions under `api/`,
packaged for mobile with Capacitor.

Commands: `npm run dev`, `npm test` (vitest), `npm run lint`, `npm run build`
(`tsc -b && vite build`). Type-check alone with `npx tsc -b`.

## Email scanner — read before touching

The Gmail email scanner is the app's crucial feature. It scans the user's inbox for
bank/payment alerts and receipts, classifies them with Gemini, and inserts transactions
for review. "The scanner" in this repo always means this, never a camera.

**Two documents govern it. Read both before changing scanner code:**

- `plans/email-scanner-requirements.md` — **canonical owner-specified behaviour.** What
  the scanner must do: scan window, tier quotas, scope, duplicate handling, currency.
  Where code and this document disagree, the document wins.
- `plans/email-scanner-performance-plan.md` — phased plan for making it fast and
  responsive enough to meet those requirements.

Main files: `src/services/emailScanner.ts` (engine, `scanRealGmailInbox`),
`src/services/aiService.ts` (Gemini classifier), `src/services/emailScanGates.ts`
(rejection gates + audit logging), `src/services/learningEngine.ts` (merchant rules),
`api/gemini-proxy.ts` (server-side AI proxy + quota). UI entry points:
`src/pages/PendingPage.tsx`, `src/pages/DashboardPage.tsx`.

**Every scan is user-initiated.** Automatic scanning was removed on 2026-08-27
(`plans/remove-auto-sync.md`), taking `api/auto-sync-gmail.ts` with it, and
sign-in no longer requests `access_type=offline` — Google issues no new refresh
token to this app. Do not reintroduce either: an unused always-on permission is
a liability in the Gmail verification review. Refresh tokens granted before that
change are still honoured, which is why the refresh path in
`src/services/googleAuth.ts` stays.

### Non-negotiable invariants

1. **Nothing auto-approves.** Every scanned transaction lands in Pending for explicit
   user approval. `applyMerchantRulesFromDB` never returns `approved`; tests assert it.
2. **Gate ordering is load-bearing:** dedup → date window → bulk-marketing → AI → regex.
   Junk must be rejected *before* it costs an AI call and the user's daily quota.
3. **AI failure degrades to the regex ladder, never to a dropped email.** A 429, quota
   rejection, or timeout must never surface to the user as a scan failure.
4. **Rejection logging is fire-and-forget** — `bufferRejection` pushes to an
   in-memory buffer during the per-email loop and `flushRejections` writes once
   after the scan. Never await a rejection write inside the loop. (The older
   `logRejection` in `emailScanGates.ts`, which inserted per rejection, is gone.)
5. **The `23505` row-by-row insert fallback is what makes concurrent and retried scans
   safe.** Reuse it; don't rewrite it. It pairs with
   `UNIQUE (email_message_id, user_id)` in `supabase/schema.sql`.
6. **Don't edit the AI prompt's STRICT RULES text** without a requirement that explicitly
   calls for it — it encodes hard-won classification fixes.

## Conventions

- Commits: `fix:` / `feat:` / `docs:` prefixes.
- Multi-phase work gets a plan document in `plans/` first, executed phase by phase.
- Supabase migrations are numbered sequentially in `supabase/` (next is `040_`).
- `schema.sql` is only run when a database is created. Anything added to it later
  reaches production **only** if a numbered migration also delivers it — twice now
  (`razorpay_subscription_id`, `is_admin`) a column existed in `schema.sql` and not in
  production, breaking every `UPDATE` on `profiles` via the guard trigger. When you add
  a column to `schema.sql`, add an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to the
  safety-net block *and* ship a migration.
- Lint has a large pre-existing baseline of `@typescript-eslint/no-explicit-any` and
  `setState`-in-effect errors. Don't treat those as regressions; just don't add new ones
  in files you touch.
