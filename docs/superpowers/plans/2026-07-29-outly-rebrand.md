# Outly Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from `Intrack` to `Outly: Expense & Budget Tracker` across every code, config, storage, and documentation surface, without touching the third-party `Intrak` analytics integration or any Razorpay wire-protocol field name — both of which look similar but are unrelated systems that must not be renamed.

**Architecture:** This is a pure find-and-rename exercise plus a small number of manual console changes (Google Cloud, Supabase, Vercel, Razorpay, GitHub). No new features, no new data flows. The only structural risk is scope creep of the rename into `Intrak`/Razorpay identifiers, and the localStorage key rename orphaning existing users' local data (accepted per spec).

**Tech Stack:** React 19 + TypeScript + Vite, Capacitor (mobile shell, unpublished), Supabase (Postgres + Auth), Vercel (hosting + serverless functions + cron), Razorpay (payments), vitest (tests).

**Source spec:** `docs/superpowers/specs/2026-07-28-outly-rebrand-design.md` — read it before starting if anything here is ambiguous; the plan below is a literal execution of that spec.

---

## Before You Start

Run this once to confirm the baseline is clean:

```bash
npm run test
npm run build
```

Both must pass before Task 1. If either fails on the unmodified tree, stop and report — do not rebrand on top of a broken build.

Create the working branch:

```bash
git checkout -b rebrand/outly
```

---

## Guardrail — Read This Before Every Task

Every task below touches strings containing `intrack`. Two other strings exist in this codebase that look similar but are **NOT to be renamed under any circumstances**:

1. **`Intrak` / `intrak*`** — a separate third-party analytics product at `intrakv1.vercel.app`, unrelated to this rebrand. Lives in `api/webhook.ts`, `api/verify-payment.ts`, `api/create-order.ts`, `api/create-order.test.ts`, `src/pages/PricingPage.tsx`, `vercel.json`, `index.html`, and the env var `VITE_INTRAK_WEBSITE_ID`.
2. **`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`** — Razorpay's own wire-protocol field names. Renaming these breaks payment signature verification.

If a task's file also contains `intrak` or `razorpay_*` text, edit only the `intrack`/`Intrack`/`INTRACK` occurrences and leave everything else on that line/file untouched. Each task below explicitly calls this out again wherever it applies.

---

## Task 1: Build config and native/PWA identity

**Files:**
- Modify: `package.json:2`
- Modify: `capacitor.config.ts:4-5`
- Modify: `public/manifest.json:2-3`
- Modify: `public/sw.js:1`

- [ ] **Step 1: Rename the npm package**

In `package.json`, change:

```json
  "name": "intrack",
```

to:

```json
  "name": "outly",
```

- [ ] **Step 2: Rename the Capacitor app identity**

In `capacitor.config.ts`, change:

```ts
const config: CapacitorConfig = {
  appId: 'com.intrack.app',
  appName: 'Intrack',
```

to:

```ts
const config: CapacitorConfig = {
  appId: 'com.outly.app',
  appName: 'Outly',
```

- [ ] **Step 3: Rename the PWA manifest**

In `public/manifest.json`, change:

```json
  "short_name": "Intrack",
  "name": "Intrack — Personal Finance Tracker",
  "description": "Your secure sandboxed personal wealth guardian. Track expenses, manage budgets, and safeguard savings.",
```

to:

```json
  "short_name": "Outly",
  "name": "Outly: Expense & Budget Tracker",
  "description": "Know where every unit goes. Track expenses, manage budgets, and see exactly where your money moves.",
```

- [ ] **Step 4: Bump the service worker cache name**

In `public/sw.js`, change:

```js
const CACHE_NAME = 'intrack-cache-v4';
```

to:

```js
const CACHE_NAME = 'outly-cache-v1';
```

This is a plain string bump, not a version increment tied to the old `v4` — the existing `activate` handler in this same file already deletes any cache key that isn't the current `CACHE_NAME`, so this single-line change self-cleans old cached assets on next visit. No other code changes needed in this file.

- [ ] **Step 5: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Verify no old strings remain in these four files**

Run: `grep -ric intrack package.json capacitor.config.ts public/manifest.json public/sw.js`
Expected: `0` for each file (grep prints `0` per matched file when using `-c` with no matches, or exits silently — if a file returns nothing at all, that also means zero matches).

- [ ] **Step 7: Commit**

```bash
git add package.json capacitor.config.ts public/manifest.json public/sw.js
git commit -m "rebrand: update build config and PWA/native identity to Outly"
```

---

## Task 2: localStorage/sessionStorage key rename — services layer

**Files:**
- Modify: `src/services/googleAuth.ts`
- Modify: `src/services/emailScanner.ts`
- Modify: `src/services/learningEngine.ts`
- Modify: `src/services/feedback.ts`
- Test: `src/services/googleAuth.test.ts` (verify only, no edits needed — confirmed it contains no hardcoded key strings)

This task renames the storage-key string literals. Per the approved spec, there is **no migration shim** — existing users' locally-cached values under the old keys are abandoned. This is intentional.

- [ ] **Step 1: Rename keys in `src/services/googleAuth.ts`**

Find and replace these four literal string constants (they appear as the `TOKEN_KEY`, `EXPIRY_KEY`, `REFRESH_TOKEN_KEY` constant values near the top of the file, and inside `purgeOldTokenKey()`):

```ts
const TOKEN_KEY = 'intrack_google_token'
const EXPIRY_KEY = 'intrack_google_token_expiry'
const REFRESH_TOKEN_KEY = 'intrack_google_refresh_token'
```

becomes:

```ts
const TOKEN_KEY = 'outly_google_token'
const EXPIRY_KEY = 'outly_google_token_expiry'
const REFRESH_TOKEN_KEY = 'outly_google_refresh_token'
```

And further down, inside `purgeOldTokenKey()`:

```ts
export function purgeOldTokenKey(): void {
  localStorage.removeItem('intrack_oauth_provider_token')
}
```

becomes:

```ts
export function purgeOldTokenKey(): void {
  localStorage.removeItem('outly_oauth_provider_token')
}
```

Note: this function's job is to delete a *stale legacy key from a prior app version*. Renaming the literal here just means it now purges the Outly-era stale key instead of the Intrack-era one — this is correct behavior, not a bug, since the actual pre-v2 key it originally targeted is long gone from any current user's storage anyway.

- [ ] **Step 2: Rename the key in `src/services/emailScanner.ts`**

Three call sites reference two literal keys. Find:

```ts
localStorage.getItem('intrack_merchant_weights')
```
```ts
localStorage.getItem('intrack_merchant_settings')
```
```ts
localStorage.setItem('intrack_merchant_settings', JSON.stringify(current))
```
```ts
localStorage.setItem('intrack_merchant_weights', JSON.stringify(weights))
```
(appears twice)
```ts
localStorage.setItem('intrack_merchant_settings', JSON.stringify(settings))
```

Replace every `intrack_merchant_weights` → `outly_merchant_weights` and every `intrack_merchant_settings` → `outly_merchant_settings` in this file (6 occurrences total across get/set call sites).

Also in this same file, rename the per-user key template:

```ts
const storedYear = localStorage.getItem(`intrack_active_financial_year_${user.id}`)
```

to:

```ts
const storedYear = localStorage.getItem(`outly_active_financial_year_${user.id}`)
```

And update the file's header comment:

```ts
// Email Scanner Service V2 — Intrack
```

to:

```ts
// Email Scanner Service V2 — Outly
```

- [ ] **Step 3: Rename the key in `src/services/learningEngine.ts`**

Find:

```ts
const migrationDoneKey = 'intrack_ls_migration_done'
```

Replace with:

```ts
const migrationDoneKey = 'outly_ls_migration_done'
```

- [ ] **Step 4: Rename the key in `src/services/feedback.ts`**

Find the two occurrences of `intrack_tester_feedback` (a get and a set call) and replace both with `outly_tester_feedback`.

- [ ] **Step 5: Run the existing service test suite**

Run: `npx vitest run src/services/googleAuth.test.ts src/services/learningEngine.test.ts src/services/transactions.test.ts src/services/aiService.test.ts src/services/insurance.test.ts`
Expected: all pass. These tests don't assert on the literal key strings, so renaming should not break them — this run just confirms nothing else broke.

- [ ] **Step 6: Verify no old keys remain in these four files**

Run: `grep -rn "intrack_" src/services/googleAuth.ts src/services/emailScanner.ts src/services/learningEngine.ts src/services/feedback.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/services/googleAuth.ts src/services/emailScanner.ts src/services/learningEngine.ts src/services/feedback.ts
git commit -m "rebrand: rename storage keys to outly_ in services layer"
```

---

## Task 3: localStorage/sessionStorage key rename — AuthContext

**Files:**
- Modify: `src/context/AuthContext.tsx`

This is the single largest concentration of storage keys (7 distinct prefixes, ~20 call sites). Handle it as its own task to keep the diff reviewable.

- [ ] **Step 1: Rename all `intrack_`-prefixed key literals in this file**

Replace every occurrence of each of these string prefixes (they appear both as plain literals and inside template literals like `` `intrack_sub_status_${state.user.id}` ``):

| Old prefix | New prefix |
| --- | --- |
| `intrack_sub_status_` | `outly_sub_status_` |
| `intrack_sub_expires_` | `outly_sub_expires_` |
| `intrack_sub_plan_` | `outly_sub_plan_` |
| `intrack_promo_code_` | `outly_promo_code_` |
| `intrack_active_financial_year_` | `outly_active_financial_year_` |
| `intrack_daily_scan_time_` | `outly_daily_scan_time_` |
| `intrack_device_id` | `outly_device_id` |
| `intrack_requesting_gmail_scope` | `outly_requesting_gmail_scope` |

Every one of these is used consistently by prefix — e.g. `` `intrack_sub_status_${state.user.id}` `` — so a straightforward string substitution of each left-hand value with its right-hand value, everywhere it appears in this file, is correct and complete.

- [ ] **Step 2: Rename the visible brand string in the device-limit modal copy**

Find:

```tsx
              Intrack limits account access to a maximum of <strong>2 devices</strong>. To connect this device, please select at least one active session to disconnect:
```

Replace with:

```tsx
              Outly limits account access to a maximum of <strong>2 devices</strong>. To connect this device, please select at least one active session to disconnect:
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc -b --noEmit`
Expected: no type errors.

- [ ] **Step 4: Verify no old strings remain**

Run: `grep -n -i "intrack" src/context/AuthContext.tsx`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.tsx
git commit -m "rebrand: rename storage keys and copy in AuthContext to Outly"
```

---

## Task 4: localStorage key rename — page components (part 1: Dashboard, Analytics, Settings, Subscriptions)

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/AnalyticsPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SubscriptionsPage.tsx`

- [ ] **Step 1: `src/pages/DashboardPage.tsx` — rename storage keys and export filenames**

Rename these key prefixes wherever they appear as template literals in this file:

| Old prefix | New prefix |
| --- | --- |
| `intrack_checklist_dismissed_` | `outly_checklist_dismissed_` |
| `intrack_last_seen_month_` | `outly_last_seen_month_` |
| `intrack_visited_analytics_` | `outly_visited_analytics_` |
| `intrack_dashboard_widgets` | `outly_dashboard_widgets` |
| `intrack_ls_migration_done` | `outly_ls_migration_done` |

Rename the export filename prefix (two occurrences):

```ts
      filename = `Intrack_Financial_Year_${priorYear}_Export.csv`
```
```ts
      filename = `Intrack_Financial_Year_${priorYear}_Export.json`
```

to:

```ts
      filename = `Outly_Financial_Year_${priorYear}_Export.csv`
```
```ts
      filename = `Outly_Financial_Year_${priorYear}_Export.json`
```

Rename the visible copy:

```tsx
    document.title = 'Dashboard | Intrack'
```
→
```tsx
    document.title = 'Dashboard | Outly'
```

```tsx
            <p className="text-xs text-zinc-500 mt-0.5 mb-4">A quick tour of what makes Intrack useful.</p>
```
→
```tsx
            <p className="text-xs text-zinc-500 mt-0.5 mb-4">A quick tour of what makes Outly useful.</p>
```

```tsx
              Intrack operates on a calendar-year budget cycle (Jan 1 to Dec 31). To start fresh for the current year, please export your prior records.
```
→
```tsx
              Outly operates on a calendar-year budget cycle (Jan 1 to Dec 31). To start fresh for the current year, please export your prior records.
```

```tsx
                Once you confirm, Intrack will restore everything to blank (wipe prior transactions, budgets, and logs) so the scanner can work as new.
```
→
```tsx
                Once you confirm, Outly will restore everything to blank (wipe prior transactions, budgets, and logs) so the scanner can work as new.
```

- [ ] **Step 2: `src/pages/AnalyticsPage.tsx` — rename storage keys and title**

Rename:

| Old | New |
| --- | --- |
| `intrack_analytics_advanced` | `outly_analytics_advanced` |
| `intrack_visited_analytics_` | `outly_visited_analytics_` |

And:

```tsx
    document.title = 'Insights | Intrack'
```
→
```tsx
    document.title = 'Insights | Outly'
```

- [ ] **Step 3: `src/pages/SettingsPage.tsx` — rename storage keys, export/backup filenames, title, copy**

Rename storage keys:

| Old | New |
| --- | --- |
| `intrack_theme` | `outly_theme` |
| `intrack_theme_changed` | `outly_theme_changed` |

Rename export filenames (two occurrences):

```ts
        filename = `Intrack_Transactions_Export_${new Date().toISOString().split('T')[0]}.csv`
```
```ts
        filename = `Intrack_Transactions_Export_${new Date().toISOString().split('T')[0]}.json`
```
to:
```ts
        filename = `Outly_Transactions_Export_${new Date().toISOString().split('T')[0]}.csv`
```
```ts
        filename = `Outly_Transactions_Export_${new Date().toISOString().split('T')[0]}.json`
```

Rename the backup filename:

```ts
      link.setAttribute('download', `Intrack_Encrypted_Backup_${new Date().toISOString().split('T')[0]}.drbak`)
```
to:
```ts
      link.setAttribute('download', `Outly_Encrypted_Backup_${new Date().toISOString().split('T')[0]}.drbak`)
```

Rename the title and copy:

```tsx
    document.title = 'Settings | Intrack'
```
→
```tsx
    document.title = 'Settings | Outly'
```

```tsx
                Rules learned from your manual approvals. Intrack automatically categorizes subsequent transactions and auto-approves them when confidence is high.
```
→
```tsx
                Rules learned from your manual approvals. Outly automatically categorizes subsequent transactions and auto-approves them when confidence is high.
```

- [ ] **Step 4: `src/pages/SubscriptionsPage.tsx` — rename storage key and title**

Rename:

```ts
intrack_ignored_subscriptions_
```
to:
```ts
outly_ignored_subscriptions_
```

And:

```tsx
    document.title = 'Subscriptions | Intrack'
```
→
```tsx
    document.title = 'Subscriptions | Outly'
```

- [ ] **Step 5: Verify build**

Run: `npx tsc -b --noEmit`
Expected: no type errors.

- [ ] **Step 6: Verify no old strings remain**

Run: `grep -n -i "intrack" src/pages/DashboardPage.tsx src/pages/AnalyticsPage.tsx src/pages/SettingsPage.tsx src/pages/SubscriptionsPage.tsx`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/AnalyticsPage.tsx src/pages/SettingsPage.tsx src/pages/SubscriptionsPage.tsx
git commit -m "rebrand: rename storage keys, filenames, and copy in Dashboard/Analytics/Settings/Subscriptions pages"
```

---

## Task 5: localStorage key rename — layouts and small components

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Modify: `src/layouts/MarketingLayout.tsx`
- Modify: `src/components/AutoUpdateChecker.tsx`
- Modify: `src/components/CookieConsent.tsx`
- Modify: `src/components/InstallPrompt.tsx`
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `index.html`

- [ ] **Step 1: `src/layouts/AppLayout.tsx` — rename storage keys and copy**

Rename these key prefixes (all appear as plain string literals in this file):

| Old | New |
| --- | --- |
| `intrack_theme` | `outly_theme` |
| `intrack_theme_changed` | `outly_theme_changed` |
| `intrack_dismissed_notifications` | `outly_dismissed_notifications` |
| `intrack_notifications_cache` | `outly_notifications_cache` |
| `intrack_security_acknowledged` | `outly_security_acknowledged` |
| `intrack_pwa_dismissed` | `outly_pwa_dismissed` |

Rename visible copy (four occurrences):

```tsx
            <Clock className="h-3.5 w-3.5 shrink-0" /> Intrack Trial: You have {daysLeft} days remaining of full Pro access.
```
→
```tsx
            <Clock className="h-3.5 w-3.5 shrink-0" /> Outly Trial: You have {daysLeft} days remaining of full Pro access.
```

```tsx
            <p className={cn("font-semibold", isStaticLight ? "text-sb-ink" : "text-zinc-300")}>© 2026 Intrack · All Rights Reserved</p>
```
→
```tsx
            <p className={cn("font-semibold", isStaticLight ? "text-sb-ink" : "text-zinc-300")}>© 2026 Outly · All Rights Reserved</p>
```

```tsx
                  Thank you! Your feedback helps us make Intrack better.
```
→
```tsx
                  Thank you! Your feedback helps us make Outly better.
```

```tsx
                <h4 className="text-xs font-bold text-white leading-tight">Install Intrack PWA</h4>
```
→
```tsx
                <h4 className="text-xs font-bold text-white leading-tight">Install Outly PWA</h4>
```

- [ ] **Step 2: `src/layouts/MarketingLayout.tsx` — rename title template, footer, page copy**

```tsx
    document.title = `${title} | Intrack`
```
→
```tsx
    document.title = `${title} | Outly`
```

```tsx
            <span className="text-sb-ink font-medium">Intrack</span>
```
→
```tsx
            <span className="text-sb-ink font-medium">Outly</span>
```

```tsx
        <p>© 2026 Intrack. Your Personal CFO.</p>
```
→
```tsx
        <p>© 2026 Outly. Your Personal CFO.</p>
```

- [ ] **Step 3: `src/components/AutoUpdateChecker.tsx` — rename storage key**

Rename `intrack_last_auto_reload` → `outly_last_auto_reload` (appears as a sessionStorage key literal).

- [ ] **Step 4: `src/components/CookieConsent.tsx` — rename storage key**

Rename `intrack_cookie_consent` → `outly_cookie_consent` (two occurrences: a get and a set).

- [ ] **Step 5: `src/components/InstallPrompt.tsx` — rename storage key and copy**

Rename `intrack_install_prompt_dismissed` → `outly_install_prompt_dismissed`.

```tsx
        <p className="text-sm font-semibold text-zinc-100">Install Intrack</p>
```
→
```tsx
        <p className="text-sm font-semibold text-zinc-100">Install Outly</p>
```

- [ ] **Step 6: `src/components/ErrorBoundary.tsx` — rename log prefix and copy**

```tsx
    console.error('[Intrack] Unhandled render error:', error, info.componentStack)
```
→
```tsx
    console.error('[Outly] Unhandled render error:', error, info.componentStack)
```

```tsx
              Intrack encountered an unexpected error. Your data is safe — this is a display issue only.
```
→
```tsx
              Outly encountered an unexpected error. Your data is safe — this is a display issue only.
```

- [ ] **Step 7: `src/App.tsx` — rename storage key**

Rename `intrack_theme` → `outly_theme` (one occurrence).

- [ ] **Step 8: `src/main.tsx` — rename storage key**

Rename `intrack_oauth_provider_token` → `outly_oauth_provider_token` (one occurrence — this mirrors the same key renamed in `googleAuth.ts` Task 2 Step 1; both must match exactly since this file also purges that legacy key on boot).

- [ ] **Step 9: `index.html` — rename all metadata, keys, and inline script references**

Rename the meta description:

```html
    <meta name="description" content="Intrack — Your personal wealth guardian. Track expenses, manage budgets, and gain financial clarity." />
```
→
```html
    <meta name="description" content="Outly — Know where every unit goes. Track expenses, manage budgets, and see exactly where your money moves." />
```

Rename Open Graph tags:

```html
    <meta property="og:url" content="https://intrack-five.vercel.app/" />
    <meta property="og:title" content="Intrack — Personal Finance Dashboard" />
    <meta property="og:description" content="Automated, privacy-first personal wealth guardian. Tracks daily expenses instantly from secure, read-only bank email alerts with zero manual logs and 100% data ownership." />
    <meta property="og:image" content="https://intrack-five.vercel.app/favicon.svg" />
```
→
```html
    <meta property="og:url" content="https://outly.vercel.app/" />
    <meta property="og:title" content="Outly: Expense & Budget Tracker" />
    <meta property="og:description" content="Know where every unit goes. Tracks daily expenses instantly from secure, read-only bank email alerts with zero manual logs and 100% data ownership." />
    <meta property="og:image" content="https://outly.vercel.app/favicon.svg" />
```

Rename Twitter tags:

```html
    <meta property="twitter:url" content="https://intrack-five.vercel.app/" />
    <meta property="twitter:title" content="Intrack — Personal Finance Dashboard" />
    <meta property="twitter:description" content="Automated, privacy-first personal wealth guardian. Tracks daily expenses instantly from secure, read-only bank email alerts with zero manual logs." />
    <meta property="twitter:image" content="https://intrack-five.vercel.app/favicon.svg" />
```
→
```html
    <meta property="twitter:url" content="https://outly.vercel.app/" />
    <meta property="twitter:title" content="Outly: Expense & Budget Tracker" />
    <meta property="twitter:description" content="Know where every unit goes. Tracks daily expenses instantly from secure, read-only bank email alerts with zero manual logs." />
    <meta property="twitter:image" content="https://outly.vercel.app/favicon.svg" />
```

Rename the title:

```html
    <title>Intrack — Personal Finance Dashboard</title>
```
→
```html
    <title>Outly: Expense & Budget Tracker</title>
```

Rename the inline boot script's theme key (inside the `<script>` block right after `<title>`):

```js
          var stored = localStorage.getItem('intrack_theme');
```
→
```js
          var stored = localStorage.getItem('outly_theme');
```

Rename the Apple PWA title:

```html
    <meta name="apple-mobile-web-app-title" content="Intrack" />
```
→
```html
    <meta name="apple-mobile-web-app-title" content="Outly" />
```

Rename the auto-reload guard keys inside the global error-handler script:

```js
              var lastReload = sessionStorage.getItem('intrack_last_auto_reload');
```
→
```js
              var lastReload = sessionStorage.getItem('outly_last_auto_reload');
```

(There is a second `intrack_last_auto_reload` reference further down in the same script block for the `setItem` call — rename that one too.)

Rename the purge-version key:

```js
intrack_purge_v4
```
→
```js
outly_purge_v1
```

**Do not touch** the Intrak tracking script tag in this file:

```html
    <script async src="https://intrakv1.vercel.app/track.js" data-website-id="62be126f-4cbc-492e-b12f-5e9beb2c71ee"></script>
```

Leave it exactly as-is.

- [ ] **Step 10: Verify build**

Run: `npx tsc -b --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 11: Verify no old strings remain (excluding the intentional Intrak script)**

Run: `grep -n -i "intrack" src/layouts/AppLayout.tsx src/layouts/MarketingLayout.tsx src/components/AutoUpdateChecker.tsx src/components/CookieConsent.tsx src/components/InstallPrompt.tsx src/components/ErrorBoundary.tsx src/App.tsx src/main.tsx index.html`
Expected: no output.

Run: `grep -n "intrakv1.vercel.app" index.html`
Expected: exactly one line — the untouched Intrak script tag.

- [ ] **Step 12: Commit**

```bash
git add src/layouts/AppLayout.tsx src/layouts/MarketingLayout.tsx src/components/AutoUpdateChecker.tsx src/components/CookieConsent.tsx src/components/InstallPrompt.tsx src/components/ErrorBoundary.tsx src/App.tsx src/main.tsx index.html
git commit -m "rebrand: rename storage keys, meta tags, and copy in layouts/components/index.html to Outly"
```

---

## Task 6: Marketing and legal pages

**Files:**
- Modify: `src/pages/LandingPage.tsx`
- Modify: `src/pages/AboutPage.tsx`
- Modify: `src/pages/PricingPage.tsx`
- Modify: `src/pages/TermsPage.tsx`
- Modify: `src/pages/PrivacyPage.tsx`
- Modify: `src/pages/RefundPage.tsx`
- Modify: `src/pages/SupportPage.tsx`

This task is copy-only — no storage keys live in these files. **Legal pages caution:** in `TermsPage.tsx`, `PrivacyPage.tsx`, and `RefundPage.tsx`, change only the product name — do not alter policy clauses, refund windows, or the grievance-officer block, since these are Razorpay-compliance surfaces.

- [ ] **Step 1: `src/pages/LandingPage.tsx` — rename all copy**

Replace every occurrence of `Intrack` with `Outly` in this file. Specific lines to change:

```tsx
    document.title = 'Intrack | Auto-track your expenses. Zero manual entry.'
```
→
```tsx
    document.title = 'Outly | Auto-track your expenses. Zero manual entry.'
```

```tsx
    { q: 'How does the app automatically detect what I spent?', a: 'When you pay with UPI, debit card, or credit card, your bank sends a transaction alert SMS or email. Intrack reads these alerts to detect the amount and merchant — so you never have to type anything manually.' },
```
→
```tsx
    { q: 'How does the app automatically detect what I spent?', a: 'When you pay with UPI, debit card, or credit card, your bank sends a transaction alert SMS or email. Outly reads these alerts to detect the amount and merchant — so you never have to type anything manually.' },
```

```tsx
    { q: 'Can the app see my bank passwords or move money?', a: 'Absolutely not. Intrack is completely read-only. We never ask for your net-banking credentials, PINs, card numbers, CVV, or OTPs. We cannot touch your money in any way.' },
```
→
```tsx
    { q: 'Can the app see my bank passwords or move money?', a: 'Absolutely not. Outly is completely read-only. We never ask for your net-banking credentials, PINs, card numbers, CVV, or OTPs. We cannot touch your money in any way.' },
```

```tsx
                  Intrack reads your bank alert SMSes and emails, then logs all your{" "}
```
→
```tsx
                  Outly reads your bank alert SMSes and emails, then logs all your{" "}
```

```tsx
                This is exactly how Intrack works — reading your bank alerts and extracting the merchant, amount, and category automatically. Your real alerts are parsed on-device, never uploaded.
```
→
```tsx
                This is exactly how Outly works — reading your bank alerts and extracting the merchant, amount, and category automatically. Your real alerts are parsed on-device, never uploaded.
```

```tsx
                  Intrack never uploads your bank alerts or emails to any server. The entire parser runs inside your browser. We cannot see, store, or sell your financial data — because we never receive it.
```
→
```tsx
                  Outly never uploads your bank alerts or emails to any server. The entire parser runs inside your browser. We cannot see, store, or sell your financial data — because we never receive it.
```

```tsx
                Intrack is a Progressive Web App. No App Store, no APK, no Play Store approvals. Just open the website and install it to your home screen.
```
→
```tsx
                Outly is a Progressive Web App. No App Store, no APK, no Play Store approvals. Just open the website and install it to your home screen.
```

```tsx
            <p className="text-xs text-sb-ink-muted">© 2026 Intrack. Built with privacy by design.</p>
```
→
```tsx
            <p className="text-xs text-sb-ink-muted">© 2026 Outly. Built with privacy by design.</p>
```

- [ ] **Step 2: `src/pages/AboutPage.tsx` — rename all copy**

```tsx
          Intrack was born from a simple frustration — most personal finance apps either cost too much, share your data, or require manual effort that nobody actually does.
```
→
```tsx
          Outly was born from a simple frustration — most personal finance apps either cost too much, share your data, or require manual effort that nobody actually does.
```

```tsx
        <h2 data-reveal className="text-xl font-bold text-sb-ink">Why Intrack Exists</h2>
```
→
```tsx
        <h2 data-reveal className="text-xl font-bold text-sb-ink">Why Outly Exists</h2>
```

```tsx
            { q: 'Existing apps require too much manual input', a: 'Most people abandon expense trackers within 2 weeks because manually entering every transaction is tedious. Intrack automates this via Gmail bank alerts — the most reliable financial data source you already have.' },
```
→
```tsx
            { q: 'Existing apps require too much manual input', a: 'Most people abandon expense trackers within 2 weeks because manually entering every transaction is tedious. Outly automates this via Gmail bank alerts — the most reliable financial data source you already have.' },
```

```tsx
            { q: 'Bank apps show data, not insight', a: 'Your HDFC or ICICI app tells you what happened. Intrack tells you what it means — whether you are on track, overspending, or wasting money on subscriptions you forgot about.' },
```
→
```tsx
            { q: 'Bank apps show data, not insight', a: 'Your HDFC or ICICI app tells you what happened. Outly tells you what it means — whether you are on track, overspending, or wasting money on subscriptions you forgot about.' },
```

```tsx
            { q: 'Privacy should not be negotiable', a: 'We built Intrack on a read-only Gmail connection, with Row Level Security on every database table, and zero advertising business model. Your data is yours.' },
```
→
```tsx
            { q: 'Privacy should not be negotiable', a: 'We built Outly on a read-only Gmail connection, with Row Level Security on every database table, and zero advertising business model. Your data is yours.' },
```

```tsx
        <p className="text-sm leading-relaxed text-sb-ink-secondary" style={{ maxWidth: 480, margin: '0 auto' }}>Connect your Gmail and let Intrack handle the tracking while you focus on the decisions.</p>
```
→
```tsx
        <p className="text-sm leading-relaxed text-sb-ink-secondary" style={{ maxWidth: 480, margin: '0 auto' }}>Connect your Gmail and let Outly handle the tracking while you focus on the decisions.</p>
```

- [ ] **Step 3: `src/pages/PricingPage.tsx` — rename title, Razorpay checkout label, and copy (leave Intrak fields untouched)**

```tsx
  useEffect(() => { document.title = 'Pricing & Plans | Intrack' }, [])
```
→
```tsx
  useEffect(() => { document.title = 'Pricing & Plans | Outly' }, [])
```

```tsx
        name: 'Intrack', description: `Upgrade to ${planName} Plan`,
```
→
```tsx
        name: 'Outly', description: `Upgrade to ${planName} Plan`,
```

```tsx
              <span className="inline-flex items-center bg-surface-1 border border-border-subtle px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 uppercase tracking-widest">The Intrack Standard</span>
```
→
```tsx
              <span className="inline-flex items-center bg-surface-1 border border-border-subtle px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 uppercase tracking-widest">The Outly Standard</span>
```

```tsx
                We believe your banking transcripts are private. Intrack is designed from the ground up to prevent data brokerage.
```
→
```tsx
                We believe your banking transcripts are private. Outly is designed from the ground up to prevent data brokerage.
```

There is also an uppercase `INTRACK` literal elsewhere in this file (a promo code or banner string) — find it with `grep -n "INTRACK" src/pages/PricingPage.tsx` and replace it with `OUTLY`.

**Do not modify** any line in this file containing `intrak_website_id`, `intrak_visitor_id`, `intrak_session_id`, `intrak_event_name`, `intrak_path`, `intrak_referrer`, `intrak_utm_source`, `intrak_utm_medium`, `intrak_utm_campaign`, `_df_vid`, or `_df_sid` — these belong to the separate Intrak attribution integration.

- [ ] **Step 4: `src/pages/TermsPage.tsx` — rename product name only, preserve all legal clauses**

Replace every occurrence of `Intrack` with `Outly` in this file (9 occurrences: intro paragraph, service description, email-access clause, subscription clause, cancellation clause, liability clause). Do not change wording, refund terms, or the structure of any clause — only the product name token changes. For example:

```tsx
            Please read these Terms of Service ("Terms") carefully before using Intrack (the "Service" or "App").
```
→
```tsx
            Please read these Terms of Service ("Terms") carefully before using Outly (the "Service" or "App").
```

Apply the same literal `Intrack` → `Outly` substitution to the remaining 8 occurrences in this file, changing nothing else on each line.

- [ ] **Step 5: `src/pages/PrivacyPage.tsx` — rename product name and domain reference**

```tsx
              <strong className="text-sb-ink">Our commitment:</strong> Intrack is built on a foundation of trust. We never sell your financial data, never store your banking passwords, and never share your personal information with advertisers. Your financial data belongs to you — always.
```
→
```tsx
              <strong className="text-sb-ink">Our commitment:</strong> Outly is built on a foundation of trust. We never sell your financial data, never store your banking passwords, and never share your personal information with advertisers. Your financial data belongs to you — always.
```

```tsx
          Intrack ("we", "us", "our") is a personal financial intelligence platform operated by its founder. The platform is accessible at intrack-five.vercel.app and any associated domains.
```
→
```tsx
          Outly ("we", "us", "our") is a personal financial intelligence platform operated by its founder. The platform is accessible at outly.vercel.app and any associated domains.
```

```tsx
          Intrack is not intended for children under 18. We do not knowingly collect data from minors. If you believe a minor has created an account, please contact us and we will delete it.
```
→
```tsx
          Outly is not intended for children under 18. We do not knowingly collect data from minors. If you believe a minor has created an account, please contact us and we will delete it.
```

```tsx
          Intrack's use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.
```
→
```tsx
          Outly's use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.
```

- [ ] **Step 6: `src/pages/RefundPage.tsx` — rename product name only, preserve refund policy wording**

Replace every occurrence of `Intrack` with `Outly` (5 occurrences). For example:

```tsx
              At <strong className="text-sb-ink">Intrack</strong>, we strive to maintain complete transparency in our billing operations. Please read this policy carefully to understand your rights and options regarding subscription cancellations and refund claims for payments processed through our payment gateway provider, Razorpay.
```
→
```tsx
              At <strong className="text-sb-ink">Outly</strong>, we strive to maintain complete transparency in our billing operations. Please read this policy carefully to understand your rights and options regarding subscription cancellations and refund claims for payments processed through our payment gateway provider, Razorpay.
```

Apply the same substitution to the remaining 4 occurrences (14-day trial clause, cancellation-rights clause, non-refundable-fees clause, Razorpay-processing clause). Leave the word `Razorpay` untouched everywhere it appears in this file — it is the correct, unrelated payment-provider name.

- [ ] **Step 7: `src/pages/SupportPage.tsx` — rename title and copy**

```tsx
    document.title = 'Support & Privacy | Intrack'
```
→
```tsx
    document.title = 'Support & Privacy | Outly'
```

```tsx
      q: 'Why does Intrack scan emails?',
```
→
```tsx
      q: 'Why does Outly scan emails?',
```

```tsx
      a: 'Absolutely. Intrack never requests, stores, or transmits netbanking passwords, credit/debit card PINs, or OTPs. Email access is delegated securely via standard OAuth 2.0 authorization tokens directly provided by Google, allowing you to revoke access at any time.',
```
→
```tsx
      a: 'Absolutely. Outly never requests, stores, or transmits netbanking passwords, credit/debit card PINs, or OTPs. Email access is delegated securely via standard OAuth 2.0 authorization tokens directly provided by Google, allowing you to revoke access at any time.',
```

```tsx
                        Intrack reads transactions strictly client-side. The email scanning heuristics and regular expression engines parse bank alerts locally inside your browser cache. Personal correspondence, newsletters, and private emails never leave your physical device.
```
→
```tsx
                        Outly reads transactions strictly client-side. The email scanning heuristics and regular expression engines parse bank alerts locally inside your browser cache. Personal correspondence, newsletters, and private emails never leave your physical device.
```

```tsx
                        Intrack's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not store raw emails on our servers, nor do we sell or use your Google data for advertisements or AI model training.
```
→
```tsx
                        Outly's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not store raw emails on our servers, nor do we sell or use your Google data for advertisements or AI model training.
```

- [ ] **Step 8: Verify build**

Run: `npx tsc -b --noEmit`
Expected: no type errors.

- [ ] **Step 9: Verify no old strings remain**

Run: `grep -n -i "intrack" src/pages/LandingPage.tsx src/pages/AboutPage.tsx src/pages/PricingPage.tsx src/pages/TermsPage.tsx src/pages/PrivacyPage.tsx src/pages/RefundPage.tsx src/pages/SupportPage.tsx`
Expected: no output.

Run: `grep -c "intrak" src/pages/PricingPage.tsx`
Expected: a nonzero count matching what existed before this task (the Intrak fields were not touched).

- [ ] **Step 10: Commit**

```bash
git add src/pages/LandingPage.tsx src/pages/AboutPage.tsx src/pages/PricingPage.tsx src/pages/TermsPage.tsx src/pages/PrivacyPage.tsx src/pages/RefundPage.tsx src/pages/SupportPage.tsx
git commit -m "rebrand: rename product name in marketing and legal page copy to Outly"
```

---

## Task 7: Remaining page components, constants, types, and CSS header

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`
- Modify: `src/pages/BudgetsPage.tsx`
- Modify: `src/pages/PendingPage.tsx`
- Modify: `src/pages/ProfilePage.tsx`
- Modify: `src/pages/ForgotPasswordPage.tsx`
- Modify: `src/pages/ResetPasswordPage.tsx`
- Modify: `src/constants/index.ts`
- Modify: `src/types/index.ts`
- Modify: `src/index.css`

- [ ] **Step 1: `src/pages/ExpensesPage.tsx`**

```tsx
    document.title = 'Expenses | Intrack'
```
→
```tsx
    document.title = 'Expenses | Outly'
```

- [ ] **Step 2: `src/pages/BudgetsPage.tsx`**

```tsx
    document.title = 'Budgets | Intrack'
```
→
```tsx
    document.title = 'Budgets | Outly'
```

- [ ] **Step 3: `src/pages/PendingPage.tsx` — title and three copy blocks**

```tsx
    document.title = 'Pending Alerts | Intrack'
```
→
```tsx
    document.title = 'Pending Alerts | Outly'
```

```tsx
                Automatically capture transactions from your Gmail inbox. Upgrade to Premium to scan your bank alerts and let Intrack do the work.
```
→
```tsx
                Automatically capture transactions from your Gmail inbox. Upgrade to Premium to scan your bank alerts and let Outly do the work.
```

```tsx
                  Link your Gmail inbox to allow Intrack to read your bank alert emails and auto-detect transactions.{' '}
```
→
```tsx
                  Link your Gmail inbox to allow Outly to read your bank alert emails and auto-detect transactions.{' '}
```

```tsx
                Intrack uses <strong>Private Local Processing</strong>. When you connect your Gmail inbox, our app fetches your bank alert emails and reads them <em>directly inside your browser</em>.
```
→
```tsx
                Outly uses <strong>Private Local Processing</strong>. When you connect your Gmail inbox, our app fetches your bank alert emails and reads them <em>directly inside your browser</em>.
```

- [ ] **Step 4: `src/pages/ProfilePage.tsx` — title and two copy blocks**

```tsx
    document.title = 'Security Profile | Intrack'
```
→
```tsx
    document.title = 'Security Profile | Outly'
```

```tsx
            ? 'Your account and all data have been deleted. Thank you for using Intrack.'
```
→
```tsx
            ? 'Your account and all data have been deleted. Thank you for using Outly.'
```

```tsx
                Instantly fill your account with sample transactions, MoM charts, category budgets, and pending alerts. Perfect for exploring Intrack before linking your email.
```
→
```tsx
                Instantly fill your account with sample transactions, MoM charts, category budgets, and pending alerts. Perfect for exploring Outly before linking your email.
```

- [ ] **Step 5: `src/pages/ForgotPasswordPage.tsx`**

```tsx
    document.title = 'Forgot Password | Intrack'
```
→
```tsx
    document.title = 'Forgot Password | Outly'
```

- [ ] **Step 6: `src/pages/ResetPasswordPage.tsx`**

```tsx
    document.title = 'Reset Password | Intrack'
```
→
```tsx
    document.title = 'Reset Password | Outly'
```

- [ ] **Step 7: `src/constants/index.ts` — rename `APP_CONFIG` values**

Find:

```ts
export const APP_CONFIG = {
  APP_NAME: 'Intrack',
  APP_TAGLINE: 'Effortless Tracking. Smart Saving.',
  CURRENCY: 'INR',
  LOCALE: 'en-IN',
  DEFAULT_PAGE_SIZE: 20,
  EMAIL_SCAN_BATCH_SIZE: 50,
  SUPPORT_EMAIL: 'support@intrack.in',
  SUPPORT_NAME: 'Intrack Support',
  SUPPORT_DESIGNATION: 'Data Protection Officer & Grievance Officer',
  SUPPORT_ADDRESS: 'Jaipur, Rajasthan, India',
} as const
```

Replace with:

```ts
export const APP_CONFIG = {
  APP_NAME: 'Outly',
  APP_TAGLINE: 'Know where every unit goes.',
  CURRENCY: 'INR',
  LOCALE: 'en-IN',
  DEFAULT_PAGE_SIZE: 20,
  EMAIL_SCAN_BATCH_SIZE: 50,
  SUPPORT_EMAIL: 'support@intrack.in',
  SUPPORT_NAME: 'Outly Support',
  SUPPORT_DESIGNATION: 'Data Protection Officer & Grievance Officer',
  SUPPORT_ADDRESS: 'Jaipur, Rajasthan, India',
} as const
```

Note: `SUPPORT_EMAIL` is deliberately left as `support@intrack.in` — per the approved spec, no new domain is being purchased this phase, so this address stays live. Do not change it.

- [ ] **Step 8: `src/types/index.ts` — rename header comment**

```ts
// Intrack — Core Type Definitions
```
→
```ts
// Outly — Core Type Definitions
```

- [ ] **Step 9: `src/index.css` — rename header comment**

```css
   Intrack — Design Token System v3
```
→
```css
   Outly — Design Token System v3
```

- [ ] **Step 10: Verify build**

Run: `npx tsc -b --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 11: Verify no old strings remain**

Run: `grep -rn -i "intrack" src/pages/ExpensesPage.tsx src/pages/BudgetsPage.tsx src/pages/PendingPage.tsx src/pages/ProfilePage.tsx src/pages/ForgotPasswordPage.tsx src/pages/ResetPasswordPage.tsx src/constants/index.ts src/types/index.ts src/index.css`
Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add src/pages/ExpensesPage.tsx src/pages/BudgetsPage.tsx src/pages/PendingPage.tsx src/pages/ProfilePage.tsx src/pages/ForgotPasswordPage.tsx src/pages/ResetPasswordPage.tsx src/constants/index.ts src/types/index.ts src/index.css
git commit -m "rebrand: rename remaining page copy, app constants, and headers to Outly"
```

---

## Task 8: Backend API origin defaults

**Files:**
- Modify: `api/create-order.ts:33`
- Modify: `api/verify-payment.ts:34`
- Modify: `api/gemini-proxy.ts:24`
- Modify: `api/refresh-google-token.ts:4`
- Modify: `api/save-google-refresh-token.ts:4`
- Modify: `api/create-order.test.ts:40,61`
- Modify: `api/save-google-refresh-token.test.ts:34,40,49,63`
- Modify: `api/weekly-digest.ts:37`

This task changes the hardcoded fallback origin used when the `ALLOWED_ORIGIN` env var is unset, plus the digest sender address. **Guardrail reminder:** `api/create-order.ts`, `api/verify-payment.ts`, and `api/create-order.test.ts` also contain `intrak_*` and `razorpay_*` identifiers — touch only the exact lines shown below in each file.

- [ ] **Step 1: `api/create-order.ts` — rename origin fallback only**

Find:

```ts
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://intrack-five.vercel.app'
```

Replace with:

```ts
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://outly.vercel.app'
```

Do not touch any other line in this file — it contains Razorpay order-creation logic that must remain unchanged.

- [ ] **Step 2: `api/verify-payment.ts` — rename origin fallback only**

Same change as Step 1, same line pattern. Do not touch the `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, or `external_id: razorpay_${order.id}` lines elsewhere in this file.

- [ ] **Step 3: `api/gemini-proxy.ts` — rename origin fallback**

Same change as Step 1.

- [ ] **Step 4: `api/refresh-google-token.ts` — rename origin fallback**

Same change as Step 1.

- [ ] **Step 5: `api/save-google-refresh-token.ts` — rename origin fallback**

Same change as Step 1.

- [ ] **Step 6: `api/create-order.test.ts` — rename origin fallback in test setup and assertions**

This file has two occurrences of `https://intrack-five.vercel.app` — one in a `process.env.ALLOWED_ORIGIN = ...` test setup line, one in a request `origin` header. Replace both with `https://outly.vercel.app`. Do not touch the `intrak_*` note fields or `razorpay_*` fields elsewhere in this test file.

- [ ] **Step 7: `api/save-google-refresh-token.test.ts` — rename origin fallback in all four occurrences**

Replace all four occurrences of `https://intrack-five.vercel.app` with `https://outly.vercel.app` in this file (test env setup and request `origin` headers across multiple test cases).

- [ ] **Step 8: `api/weekly-digest.ts` — rename sender display name and switch to Resend's shared sender**

Find:

```ts
const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || 'Intrack <digest@intrack.app>'
```

Replace with:

```ts
const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || 'Outly <onboarding@resend.dev>'
```

This also fixes a pre-existing issue: the old fallback pointed at `digest@intrack.app`, a domain never verified in Resend, so unconfigured deployments were already silently failing to send. `onboarding@resend.dev` is Resend's shared sender that works without domain verification.

Also find and update the in-body copy reference:

```ts
        You're getting this because weekly summaries are on for your account. Manage this from Settings inside Intrack.
```

Replace with:

```ts
        You're getting this because weekly summaries are on for your account. Manage this from Settings inside Outly.
```

- [ ] **Step 9: Run the API test suite**

Run: `npx vitest run api/create-order.test.ts api/save-google-refresh-token.test.ts api/auto-sync-gmail.test.ts`
Expected: all pass.

- [ ] **Step 10: Verify no old origin/domain strings remain in these files**

Run: `grep -rn "intrack" api/create-order.ts api/verify-payment.ts api/gemini-proxy.ts api/refresh-google-token.ts api/save-google-refresh-token.ts api/create-order.test.ts api/save-google-refresh-token.test.ts api/weekly-digest.ts`
Expected: no output.

Run: `grep -c "intrak\|razorpay" api/create-order.ts api/verify-payment.ts`
Expected: nonzero counts, unchanged from before this task (spot-check that these weren't accidentally touched).

- [ ] **Step 11: Commit**

```bash
git add api/create-order.ts api/verify-payment.ts api/gemini-proxy.ts api/refresh-google-token.ts api/save-google-refresh-token.ts api/create-order.test.ts api/save-google-refresh-token.test.ts api/weekly-digest.ts
git commit -m "rebrand: update API origin fallbacks to outly.vercel.app and fix digest sender"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `MOBILE_SETUP.md`
- Modify: `TRANSFER_GUIDE.md`
- Modify: `GOOGLE_VERIFICATION_GUIDE.md`
- Modify: `user_login_guide.md`
- Modify: `supabase/schema.sql:2`

**Do not modify:** `supabase/archive/*.sql`, `plans/*.md`, `docs/superpowers/plans/*.md` (except this new plan file, which correctly uses the new name throughout since it describes future work), `docs/superpowers/specs/*` (except the rebrand spec itself, already correct), `.impeccable/`. These are dated historical records — rewriting them would misrepresent history.

- [ ] **Step 1: `README.md` — rename product, add historical note, update RLS domain reference**

At the top of the file, directly under the `# Intrack — Personal Finance Dashboard` heading, add a note (before renaming the heading) recording the prior name. Change:

```md
# Intrack — Personal Finance Dashboard
```

to:

```md
# Outly: Expense & Budget Tracker

> Formerly named Intrack.
```

Rename the remaining body references, e.g.:

```md
Intrack connects to a user's Gmail inbox (read-only) and automatically extracts debit/credit transactions from bank alert emails. All parsing happens client-side in the browser — no email content is stored on the server. Users can review, approve, or reject detected transactions before they hit the ledger.
```
→
```md
Outly connects to a user's Gmail inbox (read-only) and automatically extracts debit/credit transactions from bank alert emails. All parsing happens client-side in the browser — no email content is stored on the server. Users can review, approve, or reject detected transactions before they hit the ledger.
```

And the RLS backdoor note:

```md
- Can view all feedback and signin logs via the `%@intrack.in` RLS backdoor (update domain as needed)
```
→
```md
- Can view all feedback and signin logs via the `%@intrack.in` RLS backdoor (still points at the support domain; update if that changes — see Task 8 Step 8 note on `SUPPORT_EMAIL` for why this wasn't renamed this phase)
```

- [ ] **Step 2: `PRODUCT.md` and `DESIGN.md` — rename product references**

In each file, replace `Intrack` with `Outly` in all prose headings/body text. In `DESIGN.md`, also update the `intrack_theme` key reference to `outly_theme` (this is documentation of the actual key renamed in Task 4/5, so it must match).

- [ ] **Step 3: `MOBILE_SETUP.md` — rename product, bundle ID, and file references**

```md
# Intrack Mobile App Packaging Guide (Capacitor)
```
→
```md
# Outly Mobile App Packaging Guide (Capacitor)
```

```md
Intrack is configured with **Capacitor** by Ionic, allowing you to package the React/Vite/TypeScript web application into a native Android application (APK) and an iOS application (IPA/Xcode).
```
→
```md
Outly is configured with **Capacitor** by Ionic, allowing you to package the React/Vite/TypeScript web application into a native Android application (APK) and an iOS application (IPA/Xcode).
```

```md
   Click the **locate** link in that notification to open the folder containing `app-debug.apk`. You can rename this to `intrack.apk` and transfer it to any Android device to install.
```
→
```md
   Click the **locate** link in that notification to open the folder containing `app-debug.apk`. You can rename this to `outly.apk` and transfer it to any Android device to install.
```

```md
   - Bundle Identifier is preset to `com.intrack.app`.
```
→
```md
   - Bundle Identifier is preset to `com.outly.app`.
```

- [ ] **Step 4: `TRANSFER_GUIDE.md` — rename product references**

```md
# Intrack — Transfer & Handover Guide
```
→
```md
# Outly — Transfer & Handover Guide
```

```md
This document covers everything a new owner needs to take full control of the Intrack codebase and all connected services.
```
→
```md
This document covers everything a new owner needs to take full control of the Outly codebase and all connected services.
```

- [ ] **Step 5: `GOOGLE_VERIFICATION_GUIDE.md` — rename product and update domain references**

Replace every occurrence of `Intrack` with `Outly`, and every occurrence of `intrack-five.vercel.app` with `outly.vercel.app` in this file (7 and 5 occurrences respectively). This file is what the owner will use to submit for Google verification after this rebrand lands, so it must be fully consistent with the new brand before that submission happens.

- [ ] **Step 6: `user_login_guide.md` — rename product references**

Replace every occurrence of `Intrack` with `Outly` (9 occurrences).

- [ ] **Step 7: `supabase/schema.sql` — rename header comment only**

```sql
-- Intrack — Database Schema
```
→
```sql
-- Outly — Database Schema
```

Do not touch any table, column, policy, or function definition in this file — only this one comment line changes.

- [ ] **Step 8: Verify no unintended old strings remain**

Run: `grep -rn -i "intrack" README.md PRODUCT.md DESIGN.md MOBILE_SETUP.md TRANSFER_GUIDE.md GOOGLE_VERIFICATION_GUIDE.md user_login_guide.md supabase/schema.sql`
Expected: only the intentional `> Formerly named Intrack.` line in `README.md` and the `%@intrack.in` domain reference (both deliberately preserved per the steps above).

- [ ] **Step 9: Commit**

```bash
git add README.md PRODUCT.md DESIGN.md MOBILE_SETUP.md TRANSFER_GUIDE.md GOOGLE_VERIFICATION_GUIDE.md user_login_guide.md supabase/schema.sql
git commit -m "rebrand: update documentation and schema comment to Outly"
```

---

## Task 10: Final repo-wide sweep and full verification

**Files:** none modified — this task is verification-only, to catch anything the previous nine tasks missed.

- [ ] **Step 1: Run a full repo-wide search excluding intentionally-preserved locations**

Run:

```bash
grep -rn -i "intrack" . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=archive --exclude-dir=plans --exclude-dir=.impeccable \
  --exclude=package-lock.json
```

Expected: only these remaining, intentional matches:
- `README.md` — the `> Formerly named Intrack.` note and the `%@intrack.in` RLS reference
- `src/constants/index.ts` — `SUPPORT_EMAIL: 'support@intrack.in'`
- Anything under `docs/superpowers/plans/*.md` or `docs/superpowers/specs/*.md` dated before this rebrand (historical, excluded above by the `plans` exclude, but specs are not excluded — check by hand that any spec match is a pre-existing dated file, not a live one)

If anything else appears, go back to the relevant task above and fix it before continuing.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: clean build, no errors or warnings about missing assets.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: no new errors introduced by this rebrand (pre-existing lint issues, if any, are out of scope).

- [ ] **Step 5: Manual DOM spot-check**

Run: `npm run preview` (after build) or `npm run dev`, then open the app in a browser and confirm:
- Browser tab title reads `Outly: Expense & Budget Tracker` on the landing page
- Footer copyright reads `© 2026 Outly`
- No visible `Intrack` text anywhere in the rendered UI

- [ ] **Step 6: Commit the branch as complete**

```bash
git status
```

Expected: working tree clean (everything already committed in Tasks 1–9). If anything is unstaged from a Step 1 fix-up, commit it now:

```bash
git add -A
git commit -m "rebrand: fix remaining stray Intrack references found in final sweep"
```

---

## Manual Steps (Owner Only — Not Automatable)

These are console/dashboard changes from the approved spec (`docs/superpowers/specs/2026-07-28-outly-rebrand-design.md`, §6–7). They cannot be scripted by an engineer working only in this repo — they require live access to Google Cloud Console, Supabase Dashboard, Vercel Dashboard, Razorpay Dashboard, and GitHub, performed by the account owner. List them out for the owner to execute in this exact order after Task 10 passes and the branch is merged and deployed:

1. **Google Cloud Console** (do first, additively): add `https://outly.vercel.app` to Authorized JavaScript origins; confirm the Supabase auth callback URL is already present in Authorized redirect URIs (it does not change); update Branding → App name to `Outly`, logo, homepage, privacy policy URL, terms URL.
2. **Supabase Dashboard**: Authentication → URL Configuration → Site URL → `https://outly.vercel.app`; add `https://outly.vercel.app/**` to Redirect URLs (keep the old one until verified working); Settings → General → rename project display name to `Outly`.
3. **Vercel**: rename project to `outly`; confirm domain `outly.vercel.app` is assigned; set `ALLOWED_ORIGIN=https://outly.vercel.app` and `DIGEST_FROM_EMAIL=Outly <onboarding@resend.dev>` for Production; confirm all other env vars survived the rename.
4. **Razorpay Dashboard**: update Business/Account name to `Outly` (may require KYC re-confirmation); update webhook URL to `https://outly.vercel.app/api/webhook`; update checkout branding/logo.
5. **GitHub**: rename `itzpiyush20/Dhanrakhshak` → `itzpiyush20/outly`; then run locally: `git remote set-url origin https://github.com/itzpiyush20/outly.git`; re-point the Vercel Git integration if it doesn't auto-follow the rename.
6. **PostHog / Sentry**: rename project display names to `Outly` (no code change, opaque keys).
7. **Post-deploy SQL** (run once, immediately after the first production deploy on the new domain, in the Supabase SQL editor):
   ```sql
   UPDATE auth.users
   SET raw_user_meta_data = raw_user_meta_data - 'user_sessions'
   WHERE raw_user_meta_data ? 'user_sessions';
   ```
   This prevents the 2-device session limit from locking out existing users after their `outly_device_id` regenerates.
8. **Cleanup** (only after confirming production is healthy on the new domain): remove the old `intrack-five.vercel.app` entries from Google Cloud origins and Supabase Redirect URLs.

---

## Post-Merge Verification Checklist

Run through this after the branch is merged, deployed, and all Manual Steps above are complete:

1. `npm run test` — all pass
2. `npm run build` — clean
3. Load `https://outly.vercel.app` — tab title reads `Outly: Expense & Budget Tracker`
4. Sign in with Google — completes; account picker shows `Outly`
5. Connect Gmail → Sync Now — scan runs, transactions appear
6. Supabase → `google_oauth_tokens` table — a row exists for the signed-in user
7. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://outly.vercel.app/api/auto-sync-gmail` — returns JSON with `succeeded >= 1`
8. Razorpay test payment — checkout modal shows `Outly`; `verify-payment` succeeds
9. Razorpay webhook fires to the new URL; Intrak attribution still posts (check `intrakv1.vercel.app` logs or the `notifyIntrak` console log)
10. Install PWA — home-screen icon labelled `Outly`
11. DevTools → Application → Local Storage — only `outly_*` and `sb-*` keys present
12. Export transactions from Settings — downloaded filename starts `Outly_Transactions_Export_`
13. Toggle theme, reload — choice persists via `outly_theme`
14. Load the app on a third browser/device — no "Device Limit Reached" wall (confirms the post-deploy SQL ran)
