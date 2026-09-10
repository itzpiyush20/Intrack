# Architecture

What this repo actually contains, verified against the code on **2026-09-10**.
Written for anyone — human or AI tool — who needs a true picture before changing
something. `README.md` is the setup guide, `CLAUDE.md` is the rules, this file is
the map.

If this document and the code disagree, the code is right and this file is stale
— fix it in the same commit as the change that made it stale.

---

## 1. Shape of the system

A single-page React app talks directly to Supabase (Postgres + Auth + RLS) for
all user data. A small set of Vercel serverless functions exists only for work
that must not happen in the browser: anything holding a secret (Razorpay keys,
the Gemini key, the Google client secret, the Supabase service-role key).

```
Browser (React 19 SPA, Vite)
  ├── @supabase/supabase-js ──────────► Supabase Postgres  (RLS: user sees only own rows)
  │                                     Supabase Auth      (email/password + Google OAuth)
  ├── fetch → gmail.googleapis.com ───► Gmail API, readonly scope, user's access token
  └── fetch → /api/*  (Vercel) ───────► Razorpay API, Google token endpoint, Gemini API
```

There is **no backend server** beyond those functions, and **no background
process** of any kind except one daily cleanup cron (below).

---

## 2. Serverless functions (`api/`)

Twelve deployed handlers. Files ending `.test.ts` are Vitest suites, not
endpoints — `.vercelignore` excludes them, because Vercel otherwise deploys every
top-level `api/*.ts` as its own function and they were eating the function cap.
Shared helpers live in `api/_lib/` and are not routable.

| Handler | Purpose |
|---|---|
| `gemini-proxy.ts` | Server-side proxy to Google Gemini. Holds `GEMINI_API_KEY`, enforces the per-user daily AI quota, and serves two purposes: `scan` (classify emails) and `insights`. |
| `create-subscription.ts` | Creates a Razorpay **subscription** (mandate) for the monthly or annual plan. This is the live purchase path. |
| `cancel-subscription.ts` | Cancels the mandate at Razorpay. The only correct way to stop billing — marking a profile `cancelled` in the DB does not stop Razorpay charging. |
| `webhook.ts` | Razorpay webhook. HMAC-SHA256 signature verified, fulfillment is idempotent, and double charges are flagged rather than silently kept. |
| `redeem-promo.ts` | Redeems a promo code, writing a zero-amount `payments` row and a `promo_redemptions` row. |
| `admin.ts` | Every admin write, behind one function, gated on `profiles.is_admin`. |
| `refresh-google-token.ts` | Exchanges a stored Google refresh token for a new access token. Holds `GOOGLE_CLIENT_SECRET`. |
| `save-google-refresh-token.ts` | Persists a refresh token into `google_oauth_tokens` (service-role only). |
| `disconnect-gmail.ts` | Real disconnect: revokes the grant at Google **and** deletes the stored refresh token. Clearing `localStorage` alone would leave both standing. |
| `cleanup-scan-rejections.ts` | Daily cron (`0 3 * * *`, declared in `vercel.json`). Deletes `email_scan_rejections` rows older than 30 days. **The only scheduled job in the system.** |
| `create-order.ts` | Legacy one-time-purchase order creation. **No client code calls it** since billing moved to Razorpay Subscriptions. |
| `verify-payment.ts` | Legacy one-time-payment verification. **No client code calls it**; `webhook.ts` still references its behaviour in comments. |

`api/_lib/`: `pricing.ts` (plan amounts in paise — mirrored from
`src/constants/pricing.ts` and guarded by `pricing.test.ts`), `subscriptionPlans.ts`,
`pendingPlan.ts`, `promo.ts`, `razorpaySignature.ts`, `geminiModel.ts`,
`monitoring.ts` (server-side Sentry).

> Vercel's Hobby plan caps a project at 12 serverless functions. This repo
> deploys exactly 12 — **the cap is full**, so adding an endpoint breaks the
> deploy until one is removed or the project moves to Pro. Hobby also forbids
> commercial use, which is its own reason to move before charging.

---

## 3. Routes (`src/App.tsx`)

**Public / marketing:** `/`, `/pricing`, `/about`, `/support`, `/privacy`,
`/terms`, `/refund-policy`, plus `/login`, `/signup`, `/forgot-password`,
`/reset-password`.

**Authenticated:** `/dashboard`, `/expenses`, `/budgets`, `/pending`,
`/insights`, `/subscriptions`, `/settings`, `/profile`. `/payment-success`
redirects to `/dashboard`. `/admin` is additionally gated on admin status.
Anything unmatched redirects to `/`.

18 page components in `src/pages/`, with sub-folders for `admin/`, `analytics/`,
`landing/` and `pricing/` sections.

---

## 4. Services (`src/services/`)

Every Supabase call lives here; pages do not query the database directly.

**Scanner (read `CLAUDE.md` before touching any of these):**
`emailScanner.ts` (the engine, `scanRealGmailInbox`), `aiService.ts` (Gemini
classifier + insights), `emailScanGates.ts` (rejection gates and audit
buffering), `emailBoilerplate.ts` (strips bank security/legal footers),
`learningEngine.ts` (per-user merchant rules, DB-backed),
`merchantNormalizer.ts` (canonical merchant names), `paymentMerge.ts` (R10 —
merges a bank alert and a merchant receipt for the same payment),
`currency.ts` (R11 — non-INR detection and formatting).

**Money & ledger:** `transactions.ts`, `budgets.ts`, `categories.ts`,
`balances.ts` (available money and card outstandings), `cards.ts`, `debts.ts`
(loans, cash advances, repayments), `plannedPayments.ts`,
`subscriptionDetection.ts` (finds recurring payments in the ledger),
`statementImporter.ts` (client-side CSV/statement import),
`backupRestore.ts` (restores from an encrypted `.inbak` file).

**Account & billing:** `supabase.ts` (typed client), `googleAuth.ts` (single
source of truth for Google tokens), `profiles.ts`, `subscription.ts` (the one
definition of "premium"), `subscriptionBilling.ts` (browser client for the
Razorpay Subscriptions endpoints), `adminAccess.ts`, `feedback.ts`, `support.ts`.

---

## 5. The Gmail scanner

**Every scan is started by the user.** Automatic scanning was removed on
2026-08-27; there is no cron, no background sync, and sign-in does not request
`access_type=offline`. Canonical behaviour is `plans/email-scanner-requirements.md`;
performance work is `plans/email-scanner-performance-plan.md`.

**Window:** a strict rolling 7 days, every scan, first or not
(`SCAN_WINDOW_MS`, `emailScanner.ts`). Nothing reaches further back — a user who
does not scan for 7 days permanently loses that gap. That trade-off was chosen
deliberately.

**Quota** (`resolveManualScanLimit`): owner accounts unlimited; premium and trial
get **2 scans per rolling 24 hours with a minimum 4-hour gap** between them.
There is no free tier — access stops when the trial or plan ends, so the
`1`-scan branch for a non-premium profile is unreachable and kept deliberately.

**Pipeline order is load-bearing** — junk must be rejected before it costs an AI
call and the user's quota:

```
dedup (existing email_message_id) → date window → bulk-marketing gate
   → AI classification (batched, via /api/gemini-proxy)
   → regex ladder (fallback when AI is unavailable or unsure)
   → Pending
```

**Invariants** (also in `CLAUDE.md`, restated because they are easy to break):

1. Nothing auto-approves. Every detected transaction waits in `/pending`.
2. AI failure — 429, quota rejection, timeout — degrades to the regex ladder.
   It must never surface as a failed scan or a dropped email.
3. Rejection logging is fire-and-forget: `bufferRejection` during the loop,
   `flushRejections` once at the end. Never await a rejection write in the loop.
4. The `23505` row-by-row insert fallback is what makes concurrent and retried
   scans safe. It pairs with `UNIQUE (email_message_id, user_id)`.

**Where email data goes:** the Gmail fetch happens in the browser with a
read-only token. To decide whether a message is a transaction, subject and body
text are sent to Google Gemini through `/api/gemini-proxy`. **No email body,
subject or sender is ever written to the database** — only the extracted
transaction fields (vendor, amount, date, card issuer/brand) and the Gmail
message id used for deduplication. `email_scan_rejections` stores a short
truncated snippet for diagnostics and is purged after 30 days.

---

## 6. Database

Supabase project `Intrack` (`ap-south-1`). **19 tables in `public`, RLS enabled
on all of them.**

| Table | Holds |
|---|---|
| `profiles` | User profile, subscription status, `is_admin` |
| `transactions` | Every debit/credit — manual, imported, and scanned |
| `budgets` | Per-category monthly limits |
| `categories` | Per-user categories |
| `cards` | User-defined credit/debit cards |
| `card_periods` | Per-card statement periods and outstandings |
| `balance_periods` | Available-money periods |
| `insurance_policies` | Premium reminders |
| `merchant_rules` | Learned per-user merchant → category rules |
| `email_scan_logs` | Scan history, quota accounting |
| `email_scan_rejections` | Why an email was rejected; purged after 30 days |
| `google_oauth_tokens` | Google refresh tokens, service-role only |
| `payments` | Razorpay payment records, including promo redemptions |
| `subscription_charges` | Per-cycle subscription charges |
| `promo_codes` / `promo_redemptions` | Coupon definitions and claims |
| `feedback` | In-app feedback |
| `support_tickets` | Support requests |
| `signin_logs` | Sign-in audit trail |

**Migrations** are numbered files in `supabase/` (`047_` is the highest; next is
`048_`). They are **not** in `supabase/migrations/` and must never be moved
there — this project has no migration history in Supabase, so a replay would
drop policies and delete rows.

> ⚠️ **`supabase/schema.sql` is currently incomplete.** It creates 14 tables;
> production has 19. Missing: `categories`, `payments`, `promo_codes`,
> `promo_redemptions`, `support_tickets`, `subscription_charges`. A fresh project
> built from `schema.sql` alone would not run the app. Do not repeat the claim
> that `schema.sql` is sufficient on its own until this is fixed.

---

## 7. Auth and entitlement

Supabase Auth handles email/password and Google OAuth (`signInWithOAuth`, so the
Google client id is configured in the Supabase dashboard, not in a `VITE_` env
var). Gmail access asks for `https://www.googleapis.com/auth/gmail.readonly`
only, and only when the user connects Gmail.

Google access tokens live in the browser; refresh tokens — for grants issued
before offline access was dropped — are stored server-side in
`google_oauth_tokens`, readable only by the service role, and refreshed through
`/api/refresh-google-token`.

Entitlement is decided in one place, `src/services/subscription.ts`
(`isPremiumProfile`). There is a 7-day trial and **no free tier**: when the trial
or plan ends, access stops. Nothing is deleted.

---

## 8. Billing

Two purchasable plans, defined once in `src/constants/pricing.ts` and mirrored
in paise in `api/_lib/pricing.ts` (a test fails the build if they disagree):

| Plan | Price | Access |
|---|---|---|
| Monthly | ₹199 | 30 days |
| Annual | ₹699 | 365 days |

Billing runs on **Razorpay Subscriptions** (mandates that auto-renew). The
one-time-order path is retired but its handlers still exist. Refunds and
invoices are handled in the Razorpay dashboard, not in the app. Plan-change
rules — upgrade resets immediately, renewal and downgrade queue, anything queued
blocks a further purchase — are specified in
`plans/2026-08-18-subscription-plan-change-queue.md` and
`plans/subscription-auto-renewal-ruleset.md`.

---

## 9. Frontend stack and conventions

React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router 7, Framer Motion,
Lucide icons. **Light mode only** — dark mode and the theme toggle were removed
2026-08-25; `.light` is applied unconditionally before first paint. The token
system in `src/index.css` is the source of truth for colour and type;
`DESIGN.md` is its human summary.

Error reporting is Sentry: `@sentry/react` in the browser (build-time
`VITE_SENTRY_DSN`; unset means the SDK is not bundled at all) and `@sentry/node`
in the functions (runtime `SENTRY_DSN`). **No product analytics SDK ships** —
there is no PostHog or equivalent in the codebase.

Mobile is Capacitor 8 (`capacitor.config.ts`, `MOBILE_SETUP.md`). The `android/`
and `ios/` folders are gitignored and generated by `npx cap add`.

---

## 10. Tests and checks

```bash
npx tsc -b          # types (all three tsconfig projects)
npm test -- --run   # vitest — 755 tests in 57 files as of 2026-09-10
npm run build       # tsc -b && vite build
npm run lint        # eslint — large documented pre-existing baseline
```

Lint carries a known backlog of `@typescript-eslint/no-explicit-any` and
`setState`-in-effect errors. Those are not regressions; just do not add new ones
in a file you touch. Compare counts before and after rather than reading the
total.

---

## 11. Planning documents

`plans/` holds current, owner-facing specifications and audits — the scanner
requirements, billing and subscription rules, policy audits, the accounts and
balances design. `docs/superpowers/` holds historical plan/spec pairs for
features that shipped. Plans for features that were removed or never decided
have been deleted rather than archived, so a document in either folder should
describe something that exists.
