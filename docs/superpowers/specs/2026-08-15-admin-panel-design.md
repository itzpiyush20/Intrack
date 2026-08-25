# Admin Panel — Phase 1: Read-Only Metrics

**Date:** 2026-08-15
**Status:** Approved design, ready for planning
**Phase:** 1 of 4 (see *Later phases* at the end)

## Purpose

Intrack has no admin interface. Every operational question — how many users are
there, how many are paying, is the scanner failing, what did users write in — is
answered today by opening the Supabase SQL editor and writing a query by hand.

This phase builds a read-only admin section that answers those questions in the app.
It also establishes the route, the access gate, and the page shell that the three
later phases plug into.

### Framing: built for an operator, not for one person

The owner may sell this app. Nothing here is wired to a specific person: admin status
is a database flag, not an email address in code, so a buyer grants it to themselves
without touching the source. Every query is written to work at 50,000 users, not just
at today's handful. Setup is documented in `TRANSFER_GUIDE.md`, not held in the
owner's memory.

The panel is also written to answer an investor's questions, not only an operator's:
growth, paying users, retention risk, running cost, and user sentiment.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Who is admin | `profiles.is_admin` only | One source of truth, already enforced by RLS. `VITE_OWNER_EMAILS` is compiled into the public JS bundle and cannot be enforced by the database. |
| Entry point | Item in the profile dropdown beside "Settings Section" | Mirrors an existing pattern; invisible to non-admins; leaves the main nav untouched. |
| Layout | One `/admin` route with tabs | Each tab loads its own data; later phases have an obvious home. |
| User detail | Aggregates plus a searchable user list | Enough for support without exposing anyone's transactions. |
| Where aggregation happens | Postgres functions, called via `supabase.rpc` | The browser receives a few numbers, not thousands of rows. Scales; keeps raw financial rows out of the client. |
| Writes | None in this phase | Read-only means the worst case of an access-control bug is disclosure, not data loss. |

Rejected: aggregating in the browser behind broadened RLS. It would grant admins
database-level read of every user's transactions — wider than the privacy line drawn
above — and it degrades as the table grows. Serverless endpoints were also rejected
*for reads* as duplicating what Postgres does natively; they return in Phase 2, where
writes leave no alternative.

## Access control

Two checks, only one of which matters.

**Browser (cosmetic).** `AdminRoute` renders children when `profile.is_admin` is true
and redirects to `/dashboard` otherwise. It sits inside the existing `ProtectedRoute`.
A determined user can defeat this in their own browser; it decides what is displayed,
not what is permitted.

**Database (authoritative).** Every admin SQL function opens with:

```sql
IF NOT public.is_admin() THEN
  RAISE EXCEPTION 'admin only';
END IF;
```

The functions are `SECURITY DEFINER`, so they read across users regardless of RLS.
That guard is the only thing making this safe and is therefore the most
safety-critical line in the feature. A defeated browser check yields an empty page
and a series of exceptions.

Admin is granted by SQL alone:

```sql
UPDATE public.profiles SET is_admin = true WHERE email = '<owner email>';
```

There is deliberately no UI for this. A button that grants admin rights is the most
dangerous control an app for sale could ship.

**Known behaviour:** when the profile read fails, `AuthContext` reconstructs the
profile from `localStorage`, which carries no `is_admin`, so the value is `undefined`
and the admin item disappears until the next successful load. This fails closed, which
is correct, but explains a vanishing menu item.

## Architecture

```
src/pages/admin/
  AdminPage.tsx        tab shell, admin gate
  OverviewTab.tsx
  UsersTab.tsx
  ScannerTab.tsx
  AiUsageTab.tsx
  FeedbackTab.tsx
  AdminBarChart.tsx    simple counts-over-time bar chart
  useAdminQuery.ts     shared loading/error/empty handling
```

Mirrors the existing `src/pages/analytics/` layout. Route `/admin` is added to
`App.tsx` inside `ProtectedRoute`, wrapped in `AdminRoute`.

Each tab fetches only when first opened, and independently: a failing scanner query
leaves the other four tabs working.

### Database functions (migration `022_admin_metrics.sql`)

All `SECURITY DEFINER`, all guarded as above.

| Function | Returns |
|---|---|
| `admin_overview_stats()` | One row: total accounts, new signups (7d/30d), active paying count, monthly vs annual split, approximate MRR, expiring within 7 days, sign-ins (7d/30d), transactions created (7d/30d), transactions awaiting approval. |
| `admin_growth_series(days int)` | Per-day signups and sign-ins for charting. |
| `admin_user_list(search text, lim int, off int)` | Paginated: email, status, plan, expiry, signup date, last sign-in, scans in last 30 days. Plus total count for pagination. |
| `admin_scanner_stats(days int)` | Per-day scan counts split manual/scheduled, success/partial/failed totals, average emails processed, average transactions found. |
| `admin_scan_failures(lim int)` | Recent failed scans with error message and the account's email. |
| `admin_rejection_gates(days int)` | Rejection counts grouped by gate. |
| `admin_ai_usage()` | Raw call counts today and over 7 days, per account and in total. Does **not** compute cap proximity — see *AI quota limits* below. |
| `admin_feedback_summary()` | Average rating, counts by category, total. |
| `admin_feedback_list(lim int, off int)` | Paginated feedback with message, rating, category, email, date. |

No new RLS policies. The functions are the controlled door, so admins gain aggregate
visibility without gaining blanket read of `transactions` or `email_scan_logs`.

Sorting, filtering and pagination happen in SQL. No endpoint returns an unbounded set.

### Prerequisite type changes

Found during design review; both block compilation otherwise.

1. `is_admin: boolean` must be added to the `profiles` Row (and optional in
   Insert/Update) in `src/types/database.ts`. The value already arrives at runtime via
   `select('*')` but the type omits it.
2. `src/types/database.ts` has no `Functions` section at all. One must be added
   declaring the return shape of each function above, otherwise `supabase.rpc(...)`
   is untyped.

## Tab contents

**Overview.** Total accounts; new this week and this month; paying users split monthly
and annual; approximate monthly revenue; plans expiring within 7 days; sign-ins over
7 and 30 days; transactions created over 7 and 30 days; transactions currently awaiting
approval in Pending; a bar chart of signups per day.

Transactions awaiting approval is a product-health signal as much as a usage one: a
number that climbs steadily means the scanner is finding things users are not acting
on.

Revenue is derived from the plans people hold *today* (monthly count × ₹31, annual
count × ₹365 ÷ 12) and must be labelled approximate in the UI. See *Known gap* below.

**Users.** One row per account: email, status, plan, expiry, signup date, last
sign-in, scans in last 30 days. Search by email; server-side pagination. No transaction
amounts.

**Scanner.** Scans per day for 30 days, manual vs scheduled; success/partial/failed
counts; average emails processed and transactions found per scan; recent failures with
error text and account; rejection counts by gate — which distinguishes "the scanner is
correctly binning junk" from "the scanner is discarding real receipts".

**AI.** Gemini calls today and over 7 days, per account and in total, highest consumers
first; how often quota rejection fires. No cap percentage — see below. Call counts only — the app does not know the owner's Gemini
pricing, and an invented rupee figure would be worse than none.

### AI quota limits — where the numbers live

The daily caps are constants inside the serverless proxy: `DAILY_AI_CALL_LIMIT = 50`
and `DAILY_AI_SCAN_CALL_LIMIT = 500` (`api/gemini-proxy.ts`). The database records only
the running counts, so SQL cannot express "80% of cap" without the limits being
restated in SQL, where the two copies would drift the first time a cap changes.

Therefore: `admin_ai_usage()` returns raw counts, and the AI tab computes proximity in
TypeScript. Both the proxy and the tab import the limits from one shared module.

**DECIDED 2026-08-15: the proxy is not touched.** Extracting the constants would have
meant editing `api/gemini-proxy.ts`, which CLAUDE.md lists as scanner infrastructure.
The owner's instruction is that the scanner must not be impacted, so phase 1 takes the
fallback: the AI tab shows raw call counts with no cap percentage, and no file on the
scanner path is modified.

Nor are the limits copied into SQL or into admin code. A second copy would silently
disagree with the proxy the first time a cap changed, and a wrong percentage is worse
than no percentage. If cap proximity is wanted later, the extraction is the way to get
it, and it needs its own approval.

**Feedback.** Message, rating, category, email, date; average rating; category
breakdown. Read-only — marking items handled is a write and belongs to Phase 3.

## Known gap: no payment history

There is no payments table. `verify-payment.ts` writes a single `razorpay_order_id`
onto the profile and overwrites it on the next purchase, so each account remembers only
its most recent order.

The app therefore cannot answer how much revenue arrived last month, how many renewed,
or when anyone cancelled. Historic payments are unrecoverable. Current-plan revenue is
an approximation of today's run rate, nothing more.

Agreed follow-up, specced separately and next: a `payments` table appended to by
`verify-payment.ts` and `webhook.ts`. It only accrues value from the day it ships,
which argues for shipping it soon — these are the first questions any buyer asks.

## Error handling and empty states

Per-tab failure isolation: each tab renders its own error state and a retry, leaving
siblings untouched.

Every tab needs a real empty state — "No scans yet" rather than a broken chart or a
bare zero that reads as a bug. A fresh install has empty tables, and this is a buyer's
first impression of the panel.

A non-admin reaching `/admin` by URL is redirected to `/dashboard`; the SQL exception
is never surfaced as a raw error.

## Testing

- **Access control (critical):** a non-admin caller of each function is refused. The
  guard is what makes `SECURITY DEFINER` safe, so it is tested per function, not once.
- **Calculations:** approximate MRR, scan success rate, and expiring-within-7-days
  against known inputs, including boundaries (expiry exactly now; zero users).
- **Empty database:** every function returns sensible zeros rather than null rows.
- **Pagination:** offsets and totals behave at boundaries.
- **UI:** `AdminRoute` redirects a non-admin and renders for an admin.

## Non-goals for this phase

No writes of any kind: no granting plans, no editing users, no marking feedback
handled, no triggering scans. No admin-granting UI. No email or alerting. No cost
estimates in currency. No new dependencies.

**No file on the scanner path is touched.** Not `emailScanner.ts`, `aiService.ts`,
`emailScanGates.ts`, `learningEngine.ts`, `api/gemini-proxy.ts`, or
`api/auto-sync-gmail.ts`. The panel only reads tables the scanner writes
(`email_scan_logs`, `email_scan_rejections`) through separate `SELECT`-only functions,
which cannot alter scanner behaviour. Any future phase that needs a scanner-path change
requires its own explicit approval.

## Later phases

2. **User operations** — grant/extend plans, expire subscriptions. Requires serverless
   endpoints under `api/` using the service-role key, because the
   `protect_server_only_profile_columns` trigger blocks browser writes to subscription
   columns by design. The riskiest phase, and the reason this one is read-only.
3. **Support inbox** — mark feedback handled, add internal notes. Needs a status column
   on `feedback`.
4. **Scanner deep-dive** — per-user scan history, per-gate drill-down, prompt
   diagnostics.

`payments` (see *Known gap*) is specced separately and comes before all of these.
