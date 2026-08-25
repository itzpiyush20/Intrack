# Quick-Add, Real Logging Streak & Consistent Filters

## Problem

Intrack already has strong daily-check-in mechanics (safe-to-spend, month-end recap,
first-run checklist) but two gaps keep it from being an everyday habit rather than an
occasional tool:

1. **Manual entry is a chore.** The only way to log a transaction is the full modal form
   (`src/components/expenses/ExpenseForm.tsx`) — type, amount, category, date, description,
   tags. For a cash spend or a UPI payment the scanner won't see, that's too much friction
   for something that should take seconds, so people stop logging and the data goes stale.
2. **The streak rewards the wrong thing.** `recordVisitAndGetStreak()` in
   `src/pages/DashboardPage.tsx` counts distinct days the app was *opened* (from a
   `localStorage` list), not days anything was actually logged. It can't function as a real
   habit loop and doesn't survive a login on a second device.

Separately, filtering is inconsistent across tabs:

- **Expenses** (`ExpensesPage.tsx`) has a full filter bar (search, type, category, date range)
  — this is the reference pattern.
- **Insights** (`AnalyticsPage.tsx`) has three uncoordinated range controls: an independent
  "Trend range" dropdown, an independent "Allocation range" dropdown (both drawing from the
  same `RangeType`), and a separate "Selected Month" picker for the advisory/health-score
  section.
- **Subscriptions** (`SubscriptionsPage.tsx`) has no filter at all.

## Goals

- Log a transaction in one row of fields, no modal, from the Dashboard.
- Streak reflects real logging activity, computed server-side from `transactions`, not a
  per-device `localStorage` visit log.
- One shared range control drives both the Trend chart and the Allocation/breakdown on
  Insights, sitting next to the (semantically distinct) Advisory month picker in a single
  filter-bar row.
- Subscriptions gets a filter bar (search, category, renewal window) that filters the
  *displayed* list without narrowing the data the detection algorithm sees.

## Non-goals

- No push notifications / reminders (tracked separately as a possible follow-up).
- No changes to `ExpenseForm.tsx`'s full modal — it stays the path for backdated entries,
  tags, and edits.
- No change to subscription *detection* logic (`detectSubscriptions()`) — only what's
  displayed is filtered.
- No gamification beyond the streak count itself (no badges/levels).

## Design

### 1. Quick-Add widget

New component `src/components/dashboard/QuickAddWidget.tsx`, rendered at the top of
`DashboardPage.tsx`, above the "safe to spend" hero card.

Fields, single row (wraps on mobile):
- **Amount** — numeric input, auto-focused.
- **Description** — optional text input, placeholder "What was this for?".
- **Category chips** — up to 4 one-tap chips computed from the user's most-frequent
  categories over their last 90 days of transactions (falls back to `food`, `transport`,
  `shopping`, `utilities` for accounts with no history yet), plus a "More" chip that reveals
  the existing `Select` dropdown inline for the rest of `CATEGORIES`.
- **Type toggle** — a small Expense/Income switch, defaults to Expense (`debit`).
- **Add** button.

Date is always today (`new Date().toISOString().split('T')[0]`) — no date picker in this
widget; backdating still goes through `ExpenseForm`.

On submit, calls the existing `createTransaction()` from `src/services/transactions.ts` with
`source: 'manual'`, `approval_status: 'approved'`, same as `ExpenseForm`. On success: toast
via the existing `useToast()`, form clears and re-focuses Amount, and the widget calls a
`onAdded` callback so `DashboardPage` re-fetches dashboard data and recomputes the streak —
no page reload.

Top-category computation is a small pure function taking `TransactionRow[]` (the recent
transactions already available/fetchable on Dashboard) and returning up to 4 category codes
sorted by frequency; lives alongside the widget since it's not needed elsewhere.

### 2. Real logging streak

Replace the `localStorage`-based `recordVisitAndGetStreak()` with a server-computed streak.

**New function**, `src/services/transactions.ts`:

```ts
/** Consecutive days (ending today or yesterday) with at least one transaction logged */
export async function getLoggingStreak() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: 0, error: new Error('User not authenticated') }

  const since = new Date()
  since.setDate(since.getDate() - 60)

  const { data, error } = await supabase
    .from('transactions')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .gte('created_at', since.toISOString())

  if (error || !data) return { data: 0, error }

  const days = new Set(data.map((t) => t.created_at.slice(0, 10)))
  const today = new Date()
  let streak = 0
  const cursor = new Date(today)

  // Grace: if nothing logged yet today, start counting from yesterday so the
  // streak doesn't zero out before the day is over.
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return { data: streak, error: null }
}
```

Uses `created_at` (when the record was logged), not `date` (what date the expense is *for*),
so backdated entries don't let someone log five days of streak in one sitting.

**`DashboardPage.tsx` changes**:
- Remove `recordVisitAndGetStreak()` and its `localStorage` key.
- Call `getLoggingStreak()` alongside `fetchDashboardData` (on mount and after Quick-Add
  submits) to set `streakDays`.
- Chip copy changes from "Checked in N days this week" to "🔥 N day streak" (only shown when
  `streakDays > 1`, same as today).
- When `streakDays === 0` and no transaction has `created_at` today, show a small inline
  nudge under the Quick-Add widget: "Log an expense today to start your streak."

### 3. Insights filter bar

`AnalyticsPage.tsx` header row currently has only the "Selected Month" picker. Add the shared
range selector next to it:

- Hoist a single `RangeType` state (rename `trendRange` → drop `allocationRange`, both
  `TrendChart` and `ExpenseBreakdown` receive the same `range`/`setRange` props).
- Header row becomes: `Range: [This Week ▾]` next to the existing `Selected Month: [month
  picker]`, both in the same bordered filter-bar container, visually matching the style
  already used in `ExpensesPage.tsx`'s filter row (`bg-surface-2`, `border-border-subtle/50`,
  `rounded-xl` controls).
- Label the month picker "Advisory month" (small label above/beside it) so it's clear it
  drives a different section (health score, 50/30/20, forecast) than the range selector
  (trend chart, category breakdown).
- `TrendChart` and `ExpenseBreakdown` prop signatures simplify from two independent
  range+setter pairs to one shared pair.

### 4. Subscriptions filter bar

Add a filter row to `SubscriptionsPage.tsx`, styled like the Expenses filter bar, above the
"Subscription Renewal Calendar" card:

- **Search** input — matches `sub.merchant` (case-insensitive substring).
- **Category** select — options built from the categories actually present in
  `detectedSubs`, same pattern as `ExpensesPage`'s `uniqueCategories`.
- **Renewal window** select — `Next 7 days` / `Next 30 days` / `Next 90 days` / `All`,
  filters on `sub.daysToRenewal`.

These filters apply only to rendering `detectedSubs` in the calendar list (`const
visibleSubs = detectedSubs.filter(...)`). `detectSubscriptions()` itself keeps analyzing the
full `transactions` array — narrowing that input would break pattern detection (it needs
history to see a charge repeat every ~30 days). The "Total Subscriptions" summary card and
duplicate-alert logic continue to use the unfiltered `detectedSubs`/`totalMonthlyOutflow`, so
the headline number doesn't silently change when someone filters the list below it.

## Testing

- `getLoggingStreak`: unit test with a mocked Supabase client covering — consecutive days
  ending today, consecutive days ending yesterday (grace), a gap that resets the streak, and
  zero transactions.
- Quick-Add: manual verification — add an expense, confirm it appears in Recent Activity and
  the streak increments, confirm category chips reflect actual transaction history.
- Insights range unification: manual verification — changing the range updates both Trend
  chart and category breakdown together; changing Advisory month only affects the
  score/50-30-20 section.
- Subscriptions filters: manual verification — search/category/window narrow the visible
  list; "Total Subscriptions" and duplicate alerts stay based on the full set.
