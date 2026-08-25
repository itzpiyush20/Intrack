# Removing `dhanrakshak` from shipped browser storage

## Why

The Intrack rebrand is complete in every string a user *reads* — UI copy, titles,
meta tags, manifest, Capacitor app name, Razorpay checkout, all `api/` handlers,
support contact. It is **not** complete in what a user can *see*: ~28 distinct
`localStorage` / `sessionStorage` keys, one CustomEvent name, one `window` global
and one service-worker cache still carry the old brand, all visible in DevTools →
Application on every user's device.

Production Postgres was verified clean on 2026-08-25: migration 039 is applied,
`signin_logs` has exactly one SELECT policy with `qual = is_admin()`, and no
policy, function, column default, constraint or trigger in `public` mentions the
old domain.

## The constraint that shapes everything

These keys are **persisted on existing users' devices**. A bare find-and-replace
silently discards, for every current user:

| Key | What breaks on a blind rename |
|---|---|
| `dhanrakshak_google_linked`, `_google_token`, `_google_token_expiry`, `_google_refresh_token`, `_oauth_provider_token` | Gmail reads as unlinked → forced re-authorization through Google's consent screen |
| `dhanrakshak_sub_status_*`, `_sub_expires_*`, `_sub_plan_*`, `_promo_code_*` | Paying users paint as unsubscribed until the network refetch lands |
| `dhanrakshak_device_id` | Every device reads as brand-new; may trip device-limit logic |
| `dhanrakshak_ls_migration_done` | The localStorage→DB merchant-rule migration in `learningEngine.ts` re-runs |
| `dhanrakshak_cookie_consent` | Consent banner reappears for everyone — a compliance-visible regression |
| `dhanrakshak_theme` | Theme choice lost; pre-paint script flashes the OS default |
| `dhanrakshak_purge_v4` | One-shot SW/cache purge re-fires, tearing down the active service worker |
| `_dashboard_widgets`, `_dismissed_notifications`, `_pwa_dismissed`, `_security_acknowledged`, `_merchant_weights`, `_merchant_settings`, `_checklist_dismissed_*`, `_visited_analytics_*`, `_analytics_advanced`, `_last_seen_month_*`, `_daily_scan_time_*`, `_is_admin_*`, `_ignored_subscriptions_*` | Layout, dismissals and preferences reset |

So the rename must be paired with a one-time copy-forward migration.

## Where the migration must live

**In the inline `<head>` script of `index.html`, before the pre-paint theme
read.** Not in a module, not in `main.tsx`. The theme script runs before the
bundle loads specifically to avoid a flash; if the migration ran later, that read
would miss the migrated value and every existing user would get one flash of the
wrong theme on the upgrade visit. `index.html` also owns
`dhanrakshak_last_auto_reload` and `dhanrakshak_purge_v4`, which are read in the
same document before any module executes.

The migration is prefix-based rather than a hardcoded list, so the per-user-id
key families (`_sub_status_<uid>`, `_checklist_dismissed_<uid>`, …) are covered
without enumerating them.

## Not a concern

`sw.js`'s `activate` handler already deletes every cache whose key `!== CACHE_NAME`,
so renaming the cache constant self-cleans the old `dhanrakshak-cache-v4` on the
next activation. No purge-key bump is needed for that.

## Phases

### Phase 1 — Migration shim
Add a prefix-based `localStorage`/`sessionStorage` migration to the top of
`index.html`'s head, guarded by a `intrack_key_migration_v1` done-flag so later
loads skip the scan. Copies `dhanrakshak_*` → `intrack_*` (never overwriting an
existing target), then removes the old key. Wrapped in `try/catch` — Safari
private mode throws on storage access and must not take down the page.

### Phase 2 — Rename every read/write site
28 key literals across 15 files, plus:
- `THEME_CHANGE_EVENT` `dhanrakshak_theme_changed` → `intrack_theme_changed`
  (an event name, no persistence, no migration needed)
- `window.__dhanrakshakPurge` → `window.__intrackPurge` (`index.html` +
  `main.tsx` must move together — `main.tsx` awaits it before registering the SW)
- `public/sw.js` `CACHE_NAME` → `intrack-cache-v1`

### Phase 3 — Comments, docs and metadata
`PricingPage.tsx:768`, `ProtectedRoute.tsx:39`, `AuthContext.tsx:66`/`:729`,
`constants/index.ts:82`, `DESIGN.md:11`, `README.md:160` (which still documents
the removed `%@dhanrakshak.in` RLS backdoor as the *live* admin mechanism — false
and misleading, fix regardless of branding), `package-lock.json` name field.
`supabase/*.sql` hits are left alone: there the string is the record of a
security fix, not branding. `docs/superpowers/` is historical record, left alone.

### Phase 4 — Verify
`npx tsc -b`, `npm test`, `npm run lint`, then a browser pass confirming an
existing user's seeded `dhanrakshak_*` values survive as `intrack_*`.

## Rollback

Phase 1 is additive and idempotent. If Phase 2 must be reverted, the old keys are
already deleted from users' devices — so revert Phase 1 and 2 together, or ship a
mirror-back shim. Do not revert Phase 2 alone.
