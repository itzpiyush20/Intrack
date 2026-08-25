# Outly Rebrand — Design & Execution Spec

**Date:** 2026-07-28
**Status:** Awaiting approval
**Scope:** Full rebrand of `Intrack` → `Outly` across frontend, backend, payment infra, PWA/mobile, third-party consoles, and docs.

---

## 1. Why

Two drivers:

1. **Product:** The owner is renaming the product to `Outly` with a new positioning ("Know where every unit goes.").
2. **Blocking dependency:** The app must complete Google OAuth **restricted-scope verification** for `gmail.readonly`. Until verified, Google caps every refresh token at ~7 days and then revokes it — which is the confirmed root cause of the daily "Gmail disconnected + auto-sync stops" failure. Branding changes made *after* verification can trigger a re-review, so the rename must land **before** the verification submission.

The rebrand is therefore a prerequisite, not a cosmetic detour.

---

## 2. Brand definition (canonical strings)

These are the only approved values. Do not invent variants.

| Token | Value |
| --- | --- |
| Short name (UI, PWA short_name, Razorpay checkout) | `Outly` |
| Full product title (`<title>`, manifest `name`, OG title) | `Outly: Expense & Budget Tracker` |
| Subtitle / tagline (≤30 chars) | `Know where every unit goes.` |
| Brand voice | Minimal, precise, empowering, transparent |
| npm package name | `outly` |
| Capacitor `appId` | `com.outly.app` |
| Capacitor `appName` | `Outly` |
| localStorage / sessionStorage prefix | `outly_` |
| Service worker cache name | `outly-cache-v1` |
| Production origin | `https://outly.vercel.app` |
| Export file prefix | `Outly_` |

**Retired strings (must not survive anywhere):** `Intrack`, `INTRACK`, `intrack`, `intrack-five`, `Effortless Tracking. Smart Saving.`, `Your personal wealth guardian`, `personal wealth guardian`, `com.intrack.app`, `intrack-cache-v4`.

---

## 3. Decisions locked (do not re-litigate during execution)

| Decision | Choice | Consequence |
| --- | --- | --- |
| Domain | Vercel subdomain rename → `outly.vercel.app` | No registrar/DNS work. OAuth redirect URIs + `ALLOWED_ORIGIN` still change. |
| localStorage keys | Rename to `outly_*`, **no migration shim** | Existing users lose theme, cached subscription, device registration, merchant-learning weights, local Gmail token. Accepted — 7 users total. |
| Mobile app ID | Change to `com.outly.app` | Safe: never published to any store; no `android/` or `ios/` folder exists. |
| Infra identities | Rename GitHub repo, Vercel project, Supabase project display name, Razorpay business name | Supabase project **ref** (`urmxysuwailvwwglxuxn`) is permanent and does not change. |
| Email sender domain | Not rebranded this phase | No custom domain owned. `DIGEST_FROM_EMAIL` moves to Resend's shared sender. See §5.7. |
| Support email address | Unchanged this phase | `support@intrack.in` is tied to a domain, not the app. Flagged as follow-up in §9. |

---

## 4. DO NOT TOUCH (critical — blind find/replace will break production)

A naive `s/intrack/outly/gi` across the repo **will cause outages**. These must be preserved exactly:

1. **`Intrak` / `intrak*` — a SEPARATE THIRD-PARTY PRODUCT, not a legacy brand.**
   It is an external analytics/attribution service at `https://intrakv1.vercel.app`. Appears in `api/webhook.ts` (21×), `api/verify-payment.ts` (21×), `api/create-order.ts` (17×), `api/create-order.test.ts` (19×), `src/pages/PricingPage.tsx` (8×), `vercel.json` CSP, `index.html` tracking script, and env var `VITE_INTRAK_WEBSITE_ID`. **Leave every occurrence untouched.**
2. **Razorpay API identifiers** — `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `external_id: razorpay_${order.id}`. These are wire-protocol field names. Renaming breaks signature verification and payment idempotency.
3. **Supabase auth storage key** — `sb-<project-ref>-auth-token`. Not brand-prefixed; `readStoredSession()` in `src/services/supabase.ts` regex-matches `/^sb-.*-auth-token$/`. Leave alone — this is what keeps users logged into the app itself.
4. **Supabase project ref** — `urmxysuwailvwwglxuxn.supabase.co`. Permanent, unchangeable.
5. **Intrak visitor keys** — `_df_vid` (localStorage) and `_df_sid` (sessionStorage) in `PricingPage.tsx`. Owned by Intrak's `track.js`, not by us. Renaming breaks purchase attribution.
6. **Database column/table names** — no schema identifiers contain the brand. Only a SQL comment does. No migration needed.

---

## 5. Execution phases

Run phases in order. Each phase ends with its stated verification before moving on.

### Phase 0 — Prep & safety

1. Create branch: `git checkout -b rebrand/outly`
2. Confirm `outly.vercel.app` is available in the Vercel dashboard (Project → Settings → Domains). If taken, fall back to `outly-app.vercel.app` and substitute that value everywhere `outly.vercel.app` appears in this spec.
3. Record the current production deployment URL for rollback.
4. Confirm baseline is green: `npm run test` and `npm run build`.

**Verify:** tests and build pass on an unmodified tree.

---

### Phase 1 — Build config, PWA, and native identity

| File | Change |
| --- | --- |
| `package.json` | `"name": "intrack"` → `"name": "outly"` |
| `capacitor.config.ts` | `appId: 'com.intrack.app'` → `'com.outly.app'`; `appName: 'Intrack'` → `'Outly'` |
| `public/manifest.json` | `short_name` → `Outly`; `name` → `Outly: Expense & Budget Tracker`; `description` → `Know where every unit goes. Track expenses, manage budgets, and see exactly where your money moves.` |
| `public/sw.js` | `CACHE_NAME = 'intrack-cache-v4'` → `'outly-cache-v1'` |

The service worker's existing `activate` handler deletes any cache whose key ≠ `CACHE_NAME`, so renaming the cache self-cleans old assets. No extra purge code needed.

**Verify:** `npm run build` succeeds; `grep -ri intrack package.json capacitor.config.ts public/` returns nothing.

---

### Phase 2 — localStorage / sessionStorage key rename (highest risk)

Rename **every** key below from `intrack_*` to `outly_*`. No migration shim — old values are abandoned by design.

**Per-user-suffixed keys** (template literals ending in `${user.id}` — preserve the suffix):

| Old key | New key | Files |
| --- | --- | --- |
| `intrack_sub_status_` | `outly_sub_status_` | `src/context/AuthContext.tsx` |
| `intrack_sub_expires_` | `outly_sub_expires_` | `src/context/AuthContext.tsx` |
| `intrack_sub_plan_` | `outly_sub_plan_` | `src/context/AuthContext.tsx` |
| `intrack_promo_code_` | `outly_promo_code_` | `src/context/AuthContext.tsx` |
| `intrack_active_financial_year_` | `outly_active_financial_year_` | `src/context/AuthContext.tsx`, `src/services/emailScanner.ts` |
| `intrack_daily_scan_time_` | `outly_daily_scan_time_` | `src/context/AuthContext.tsx` |
| `intrack_checklist_dismissed_` | `outly_checklist_dismissed_` | `src/pages/DashboardPage.tsx` |
| `intrack_last_seen_month_` | `outly_last_seen_month_` | `src/pages/DashboardPage.tsx` |
| `intrack_visited_analytics_` | `outly_visited_analytics_` | `src/pages/DashboardPage.tsx`, `src/pages/AnalyticsPage.tsx` |
| `intrack_ignored_subscriptions_` | `outly_ignored_subscriptions_` | `src/pages/SubscriptionsPage.tsx` |

**Global keys:**

| Old key | New key | Files |
| --- | --- | --- |
| `intrack_theme` | `outly_theme` | `index.html`, `src/App.tsx`, `src/layouts/AppLayout.tsx`, `src/pages/SettingsPage.tsx` |
| `intrack_theme_changed` (CustomEvent name, not storage) | `outly_theme_changed` | `src/layouts/AppLayout.tsx`, `src/pages/SettingsPage.tsx` |
| `intrack_device_id` | `outly_device_id` | `src/context/AuthContext.tsx` |
| `intrack_google_token` | `outly_google_token` | `src/services/googleAuth.ts` |
| `intrack_google_token_expiry` | `outly_google_token_expiry` | `src/services/googleAuth.ts` |
| `intrack_google_refresh_token` | `outly_google_refresh_token` | `src/services/googleAuth.ts` |
| `intrack_oauth_provider_token` (legacy purge target) | `outly_oauth_provider_token` | `src/services/googleAuth.ts`, `src/main.tsx` |
| `intrack_requesting_gmail_scope` | `outly_requesting_gmail_scope` | `src/context/AuthContext.tsx` |
| `intrack_merchant_weights` | `outly_merchant_weights` | `src/services/emailScanner.ts` |
| `intrack_merchant_settings` | `outly_merchant_settings` | `src/services/emailScanner.ts` |
| `intrack_ls_migration_done` (sessionStorage) | `outly_ls_migration_done` | `src/services/learningEngine.ts`, `src/pages/DashboardPage.tsx` |
| `intrack_dashboard_widgets` | `outly_dashboard_widgets` | `src/pages/DashboardPage.tsx` |
| `intrack_analytics_advanced` | `outly_analytics_advanced` | `src/pages/AnalyticsPage.tsx` |
| `intrack_notifications_cache` | `outly_notifications_cache` | `src/layouts/AppLayout.tsx` |
| `intrack_dismissed_notifications` | `outly_dismissed_notifications` | `src/layouts/AppLayout.tsx` |
| `intrack_security_acknowledged` | `outly_security_acknowledged` | `src/layouts/AppLayout.tsx` |
| `intrack_pwa_dismissed` | `outly_pwa_dismissed` | `src/layouts/AppLayout.tsx` |
| `intrack_install_prompt_dismissed` | `outly_install_prompt_dismissed` | `src/components/InstallPrompt.tsx` |
| `intrack_cookie_consent` | `outly_cookie_consent` | `src/components/CookieConsent.tsx` |
| `intrack_support_tickets` | `outly_support_tickets` | `src/pages/SupportPage.tsx` |
| `intrack_tester_feedback` | `outly_tester_feedback` | `src/services/feedback.ts` |
| `intrack_last_auto_reload` (sessionStorage) | `outly_last_auto_reload` | `index.html`, `src/components/AutoUpdateChecker.tsx` |
| `intrack_purge_v4` | `outly_purge_v1` | `index.html` |

**Known, accepted side effects:**

- `migrateLocalStorageRulesToDB()` in `learningEngine.ts` reads `outly_merchant_weights`, which will be empty → returns `{ migrated: 0 }` and no-ops. Merchant-learning history is lost. Accepted.
- The `signOut()` cleanup loop in `AuthContext.tsx` scans for keys containing `'oauth'` — `outly_oauth_provider_token` still matches. No change needed, but confirm the loop still catches the renamed keys.

**Verify:** `npm run test` passes; `grep -rn "intrack_" src/ index.html` returns nothing.

---

### Phase 3 — Backend origin defaults

Replace the hardcoded fallback origin in all six API handlers plus two test files:

| File | Change |
| --- | --- |
| `api/create-order.ts:33` | `'https://intrack-five.vercel.app'` → `'https://outly.vercel.app'` |
| `api/verify-payment.ts:34` | same |
| `api/gemini-proxy.ts:24` | same |
| `api/refresh-google-token.ts:4` | same |
| `api/save-google-refresh-token.ts:4` | same |
| `api/create-order.test.ts:40,61` | same |
| `api/save-google-refresh-token.test.ts:34,40,49,63` | same |

`ALLOWED_ORIGIN` is set as a Vercel env var and takes precedence — the literal is only a fallback, but it must still be correct.

**Verify:** `npm run test` passes; `grep -rn "intrack-five" api/` returns nothing.

---

### Phase 4 — App constants and user-facing copy

**`src/constants/index.ts` — `APP_CONFIG`:**

```ts
APP_NAME: 'Outly',
APP_TAGLINE: 'Know where every unit goes.',
SUPPORT_NAME: 'Outly Support',
```

Leave `SUPPORT_EMAIL`, `SUPPORT_DESIGNATION`, `SUPPORT_ADDRESS`, `CURRENCY`, `LOCALE` unchanged.

**`index.html`:**

- `<title>` → `Outly: Expense & Budget Tracker`
- `<meta name="description">` → `Outly — Know where every unit goes. Track expenses, manage budgets, and see exactly where your money moves.`
- `og:url`, `twitter:url` → `https://outly.vercel.app/`
- `og:title`, `twitter:title` → `Outly: Expense & Budget Tracker`
- `og:image`, `twitter:image` → `https://outly.vercel.app/favicon.svg`
- `og:description`, `twitter:description` → rewrite in brand voice, dropping "wealth guardian"
- `<meta name="apple-mobile-web-app-title">` → `Outly`
- Keep the Intrak `<script src="https://intrakv1.vercel.app/track.js">` untouched.

**`src/pages/PricingPage.tsx:118`** — Razorpay checkout `name: 'Intrack'` → `'Outly'`. Do not touch the `intrak_*` note fields below it.

**`src/pages/SettingsPage.tsx`** — export filename prefixes:
`Intrack_Transactions_Export_` → `Outly_Transactions_Export_`; `Intrack_Encrypted_Backup_` → `Outly_Encrypted_Backup_`.

**`src/pages/DashboardPage.tsx`** — `Intrack_Financial_Year_` → `Outly_Financial_Year_`.

**Remaining prose files** — replace every visible `Intrack` with `Outly` and rewrite any "wealth guardian" phrasing to the new voice:
`src/pages/LandingPage.tsx`, `AboutPage.tsx`, `TermsPage.tsx`, `PrivacyPage.tsx`, `RefundPage.tsx`, `SupportPage.tsx`, `PricingPage.tsx`, `ProfilePage.tsx`, `PendingPage.tsx`, `DashboardPage.tsx`, `AnalyticsPage.tsx`, `ExpensesPage.tsx`, `BudgetsPage.tsx`, `SubscriptionsPage.tsx`, `SettingsPage.tsx`, `ResetPasswordPage.tsx`, `ForgotPasswordPage.tsx`, `src/layouts/AppLayout.tsx`, `src/layouts/MarketingLayout.tsx`, `src/components/ErrorBoundary.tsx`, `src/components/InstallPrompt.tsx`, `src/context/AuthContext.tsx` (device-limit modal copy), `src/services/emailScanner.ts` (header comment), `src/types/index.ts`, `src/index.css`.

`src/pages/PricingPage.tsx` also contains an uppercase `INTRACK` (promo code or banner) — replace with `OUTLY`.

**Legal pages caution:** `TermsPage.tsx`, `PrivacyPage.tsx`, and `RefundPage.tsx` are Razorpay-compliance surfaces. Change only the entity name; do not alter policy clauses, refund windows, or the grievance-officer block.

**Verify:** `npm run build` passes; `grep -rn -i "intrack" src/ index.html` returns nothing.

---

### Phase 5 — Docs and SQL comments

| File | Action |
| --- | --- |
| `README.md` | Rename product, update the `%@intrack.in` RLS note |
| `PRODUCT.md`, `DESIGN.md` | Rename product + `intrack_theme` key reference |
| `MOBILE_SETUP.md` | Rename product, `com.outly.app`, `outly.apk` |
| `TRANSFER_GUIDE.md` | Rename product and service references |
| `GOOGLE_VERIFICATION_GUIDE.md` | Rename product and all `intrack-five.vercel.app` → `outly.vercel.app` |
| `user_login_guide.md` | Rename product |
| `supabase/schema.sql:2` | Comment header → `Outly — Database Schema` |

**Do not edit** `supabase/archive/*.sql` (historical migrations — rewriting history is misleading), `plans/*.md`, `docs/superpowers/plans/*.md`, `docs/superpowers/specs/*` (except this file), or `.impeccable/`. These are dated historical records. Add a one-line note at the top of `README.md` recording that the product was formerly named Intrack.

**Verify:** `grep -rn -i "intrack" . --exclude-dir={.git,node_modules,dist,archive,plans,.impeccable}` returns only intentional historical references.

---

### Phase 6 — External console changes (manual, owner-only)

Order matters. Doing these out of order breaks login in production.

**6.1 — Google Cloud Console (do FIRST, additively)**
1. APIs & Services → Credentials → the OAuth 2.0 Client ID.
2. **Add** (do not remove yet) `https://outly.vercel.app` to *Authorized JavaScript origins*.
3. *Authorized redirect URIs* must contain `https://urmxysuwailvwwglxuxn.supabase.co/auth/v1/callback` — this is the only redirect Google needs, because Supabase brokers the OAuth callback and then forwards to the app's own `redirectTo`. That value is unchanged by this rebrand; verify it is present and leave it alone. The app origin belongs in *JavaScript origins* (step 2), not here.
4. Google Auth Platform → **Branding**: App name → `Outly`, update app logo, application home page → `https://outly.vercel.app`, privacy policy → `https://outly.vercel.app/privacy`, terms → `https://outly.vercel.app/terms`.

**6.2 — Supabase Dashboard**
1. Authentication → URL Configuration → **Site URL** → `https://outly.vercel.app`.
2. Add `https://outly.vercel.app/**` to *Redirect URLs*. Keep the old entry until cutover is verified.
3. Settings → General → project display name → `Outly`. (Project ref stays `urmxysuwailvwwglxuxn`.)

**6.3 — Vercel**
1. Project → Settings → General → rename project to `outly`.
2. Domains → confirm `outly.vercel.app` is assigned.
3. Environment Variables → set `ALLOWED_ORIGIN=https://outly.vercel.app` for Production.
4. Set `DIGEST_FROM_EMAIL=Outly <onboarding@resend.dev>` (Resend's shared sender; the current `digest@intrack.app` fallback points at an unverified domain and already fails to send).
5. Confirm `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `VITE_INTRAK_WEBSITE_ID` all survived the rename.

**6.4 — Razorpay Dashboard**
1. Account & Settings → Business/Account name → `Outly`. May require KYC re-confirmation.
2. Webhooks → update URL to `https://outly.vercel.app/api/webhook`.
3. Checkout branding/logo → `Outly`.

**6.5 — GitHub**
1. Rename `itzpiyush20/Dhanrakhshak` → `itzpiyush20/outly`. (Note: the existing repo name is misspelled — the rename corrects it.)
2. Update local remote: `git remote set-url origin https://github.com/itzpiyush20/outly.git`
3. Re-point the Vercel Git integration if it does not auto-follow.

**6.6 — PostHog / Sentry**
Rename the project display names to `Outly`. No code change — keys are opaque.

---

### Phase 7 — Cutover

1. Merge `rebrand/outly` and deploy to production.
2. Run this SQL in Supabase to clear stale device registrations (prevents the 2-device limit from locking users out after `outly_device_id` regenerates):
   ```sql
   UPDATE auth.users
   SET raw_user_meta_data = raw_user_meta_data - 'user_sessions'
   WHERE raw_user_meta_data ? 'user_sessions';
   ```
3. Verify no live RLS policy still references the old email domain:
   ```sql
   SELECT policyname, tablename, qual FROM pg_policies
   WHERE schemaname = 'public' AND qual::text ILIKE '%intrack%';
   ```
   If any row returns, replace that policy with the `public.is_admin()` check already defined in `schema.sql`.
4. After production is confirmed healthy, remove the old `intrack-five.vercel.app` entries from Google Cloud origins/redirects and from Supabase Redirect URLs.

---

### Phase 8 — Post-cutover verification

Run every check. All must pass before the rebrand is called done.

| # | Check | Expected |
| --- | --- | --- |
| 1 | `npm run test` | all pass |
| 2 | `npm run build` | clean |
| 3 | Load `https://outly.vercel.app` | tab title reads `Outly: Expense & Budget Tracker` |
| 4 | Sign in with Google | completes; account picker shows `Outly` |
| 5 | Connect Gmail → Sync Now | scan runs, transactions appear |
| 6 | Supabase → `google_oauth_tokens` | a row exists for the user |
| 7 | `curl -s -H "Authorization: Bearer $CRON_SECRET" https://outly.vercel.app/api/auto-sync-gmail` | JSON with `succeeded ≥ 1` |
| 8 | Razorpay test payment | checkout modal shows `Outly`; `verify-payment` succeeds |
| 9 | Razorpay webhook | fires to the new URL; Intrak attribution still posts |
| 10 | Install PWA | home-screen icon labelled `Outly` |
| 11 | DevTools → Application → Local Storage | only `outly_*` and `sb-*` keys present |
| 12 | Export transactions from Settings | filename starts `Outly_Transactions_Export_` |
| 13 | Theme toggle → reload | choice persists via `outly_theme` |
| 14 | Load app on a 3rd browser | no "Device Limit Reached" wall |

---

## 6. Order-of-operations constraints

- Google origins/redirects must be **added before** the Vercel rename, or OAuth breaks between rename and console update.
- Supabase Site URL and Redirect URLs must be updated **before** the first production login on the new domain.
- Old origins are removed **only after** Phase 8 passes.
- The `user_sessions` clear (Phase 7.2) must run **immediately after** deploy — the window between deploy and that query is when device-limit lockouts can occur.

---

## 7. Rollback

Code: `git revert` the merge and redeploy — the previous build is still in Vercel's deployment history and can be promoted instantly.

Console changes are additive until Phase 7.4, so the old origin keeps working throughout. Do **not** run Phase 7.4 until confident.

Irreversible once done: the `user_sessions` wipe (harmless — users just re-register devices) and the Razorpay business-name change (requires another KYC edit to undo).

---

## 8. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Blind find/replace renames `Intrak` | **Critical** — breaks payment attribution and CSP | §4 explicitly lists it; verification step 9 catches it |
| Blind replace hits `razorpay_*` field names | **Critical** — breaks signature verification | §4; test suite covers signature logic |
| Device-limit lockout after `device_id` rename | High | Phase 7.2 SQL, immediately post-deploy |
| Vercel URL taken by another account | Medium | Phase 0.2 checks first; documented fallback |
| Users lose Gmail connection | Medium | Expected. All 7 users reconnect once. Server-side refresh token in `google_oauth_tokens` is untouched, so the cron keeps running. |
| Razorpay KYC delay on name change | Medium | Payment code is name-agnostic; only the checkout label lags |
| Legal-page edits break Razorpay compliance | Medium | §Phase 4 restricts edits to the entity name only |

---

## 9. Explicitly out of scope (follow-ups)

1. **Google restricted-scope verification + CASA assessment** — the actual permanent fix for the daily Gmail disconnect. Must be submitted *after* this rebrand lands so branding is consistent in the review. Tracked separately.
2. **Custom domain** (`outly.app` / `outly.in`) — deferred; requires purchase.
3. **Support/digest email addresses** on an Outly domain — blocked on (2).
4. **Logo, favicon, icon assets** — this spec covers strings and identifiers only. New `favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-*.png`, `apple-touch-icon.png` are a separate design task.
5. **Trademark/availability check** on the name "Outly" — recommended before the Google verification submission.
6. **Self-healing `invalid_grant` notification** in `api/auto-sync-gmail.ts` — so token revocation surfaces same-day instead of silently. Recommended alongside the verification work.
