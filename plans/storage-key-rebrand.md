# Storage-key rebrand — carrying existing users across

**Status: shipped 2026-08-25.** Kept as the record of why the migration in
`index.html` exists and must not be removed casually.

## Why

The rebrand reached every string a user *reads* — UI copy, titles, meta tags,
manifest, Capacitor app name, Razorpay checkout, every `api/` handler, support
contact. It had not reached what a user can *see*: ~28 `localStorage` /
`sessionStorage` keys under the previous brand prefix, one CustomEvent name, one
`window` global and one service-worker cache, all visible in DevTools →
Application on every user's device.

Production Postgres was verified clean the same day: migration 039 applied,
`signin_logs` carrying exactly one SELECT policy with `qual = is_admin()`, and no
policy, function, column default, constraint or trigger in `public` referencing
the old vanity domain.

## The constraint that shaped it

Those keys were **already persisted on real users' devices**. A bare
find-and-replace would have silently discarded, for every existing user:

| Key family | What a blind rename breaks |
|---|---|
| `*_google_linked`, `_google_token`, `_google_token_expiry`, `_google_refresh_token`, `_oauth_provider_token` | Gmail reads as unlinked → forced re-authorization through Google's consent screen |
| `*_sub_status_<uid>`, `_sub_expires_`, `_sub_plan_`, `_promo_code_` | Paying users paint as unsubscribed until the network refetch lands |
| `*_device_id` | Every device reads as brand-new; may trip device-limit logic |
| `*_ls_migration_done` | The localStorage→DB merchant-rule migration in `learningEngine.ts` re-runs |
| `*_cookie_consent` | Consent banner reappears for everyone — a compliance-visible regression |
| `*_theme` | Theme choice lost (since superseded — the app is light only) |
| `*_purge_v4` | One-shot SW/cache purge re-fires, tearing down the active service worker |
| `_dashboard_widgets`, `_dismissed_notifications`, `_pwa_dismissed`, `_security_acknowledged`, `_merchant_weights`, `_merchant_settings`, `_checklist_dismissed_`, `_visited_analytics_`, `_analytics_advanced`, `_last_seen_month_`, `_daily_scan_time_`, `_is_admin_` | Layout, dismissals and preferences reset |

So the rename shipped paired with a one-time copy-forward migration.

## Where the migration lives, and why there

**The inline `<head>` script of `index.html`, before the pre-paint theme read.**
Not a module, not `main.tsx`. That script runs before the bundle loads
specifically to avoid a flash; a later migration would miss the migrated value
and give every existing user one flash of the wrong theme on the upgrade visit.
`index.html` also owns `_last_auto_reload` and `_purge_v4`, read in the same
document before any module executes.

It is prefix-based rather than a hardcoded list, so the per-user-id families come
along without enumerating them, and it never overwrites a value already present
under the new name.

**The two old-prefix string literals in that script are load-bearing.** The
migration cannot match keys it cannot name. They are the only remaining
occurrences in the codebase and cannot be removed until every active user has
loaded the app at least once post-rebrand — after which the shim, and they, can
go together.

`googleAuth`'s legacy-token erase now depends on the shim running first. Without
it a stale refresh token would be stranded in `localStorage` permanently.

## Not a concern

`sw.js`'s `activate` handler already deletes every cache whose key `!== CACHE_NAME`,
so renaming the cache constant self-cleaned the old one on next activation.

## Verified

`npm run build` exit 0, 503/503 tests, lint delta zero, and a browser pass
confirming a seeded pre-rebrand profile migrated with theme, Gmail link,
subscription, device ID and learned merchant rules intact — including the
collision case, where a value already written under the new name won.
