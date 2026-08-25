# Core App UI/UX Behavioral Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 13 findings (F1-F8, F10-F14) from
[`docs/superpowers/specs/2026-08-04-core-app-uiux-behavioral-audit-design.md`](../specs/2026-08-04-core-app-uiux-behavioral-audit-design.md) — nav duplication, split mental models, banner
stacking, inconsistent destructive-action patterns, and placement/polish issues across the
logged-in app.

**Architecture:** Each task is a self-contained, isolated edit to one or two files with no shared
state between tasks — they can be executed and reviewed independently, in the order below (which
matches the spec's "Recommended fix order"). No new components or abstractions are introduced;
every fix reuses styling/patterns already established elsewhere in the codebase (e.g. the
warning-color tokens already used on Budgets' near-limit state, the undo-toast pattern already
used for Approve).

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind CSS. Routing via `react-router-dom`.
No component test suite exists in this repo (only `vitest` is installed with zero test files) and
no `@testing-library/react` dependency is present — adding one would be a disproportionate
tooling investment for IA/copy/layout changes. Verification is therefore: (1) `npx tsc --noEmit`
after every task to catch type/import regressions, and (2) live-browser verification at
375px / 768px / 1024-1280px / 1440px+ widths, matching the precedent already set by
`docs/superpowers/specs/2026-08-02-mobile-uiux-review-design.md`'s Methodology section. Where the
Browser tool cannot reach a logged-in view (this environment has no test account credentials),
the step says so explicitly and asks the user to spot-check instead of claiming an unverified pass.

---

## File Structure

No new files. Modified files, one concern per task:

- `src/layouts/AppLayout.tsx` — Tasks 1, 10
- `src/pages/BudgetsPage.tsx` — Task 2
- `src/pages/AnalyticsPage.tsx` — Tasks 2, 3
- `src/pages/PendingPage.tsx` — Tasks 4, 5
- `src/pages/SettingsPage.tsx` — Tasks 6, 8, 12, 13
- `src/pages/ProfilePage.tsx` — Tasks 6, 7
- `src/pages/SubscriptionsPage.tsx` — Tasks 9, 13
- `src/components/dashboard/InsurancePremiumCard.tsx` — Task 11

---

### Task 1: Remove redundant mobile sub-nav strip (F1)

**Files:**
- Modify: `src/layouts/AppLayout.tsx:734-759`

The mobile hamburger menu (`AppLayout.tsx:762-827`, unaffected by this task) already lists all
six nav items plus Profile/Settings/Pricing/Sign Out. The horizontal-scroll strip below the header
duplicates the same six items on a second, less-reachable surface, and the fixed bottom tab bar
duplicates five of them on a third. This task removes the middle one (the scroll strip), leaving
the bottom bar as the canonical quick-access surface and the hamburger menu as the canonical
full-list surface.

- [ ] **Step 1: Delete the sub-nav strip block**

In `src/layouts/AppLayout.tsx`, delete this entire block (starts right after the `</header>`-bound
mobile-menu-dropdown's preceding sibling, specifically the block commented "Mobile/Tablet
Horizontal Scrollable Sub-Nav Row"):

```tsx
        {/* Mobile/Tablet Horizontal Scrollable Sub-Nav Row (Only visible if logged in and below lg viewport) */}
        {user && isAppRoute && (
          <div className={cn("h-11 border-t flex items-center lg:hidden overflow-hidden select-none", isStaticLight ? "border-sb-hairline bg-sb-canvas-soft" : "border-border-subtle bg-surface-1/40")}>
            <div className="mx-auto max-w-7xl w-full flex items-center px-4 sm:px-6 overflow-x-auto scrollbar-none flex-nowrap py-1 gap-2">
              {navItems
                .filter(item => item.path !== ROUTES.PRICING)
                .map((item) => {
                  const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "transition-colors py-2 px-2.5 rounded-lg text-xs font-semibold shrink-0",
                      isActive 
                        ? (isStaticLight ? "bg-sb-canvas text-sb-ink font-bold border border-sb-hairline" : "bg-white/10 text-white font-bold") 
                        : (isStaticLight ? "text-sb-ink-muted hover:text-sb-ink" : "text-zinc-400 hover:text-white")
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        )}
```

Delete it entirely — leave nothing in its place (the mobile menu dropdown block that follows it
stays untouched).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`navItems` and `ROUTES` are still used elsewhere in this file — desktop
nav and mobile dropdown — so no unused-variable issues.)

- [ ] **Step 3: Browser verification**

If a logged-in session is reachable in this environment: `preview_start` the `intrack-dev`
config, `resize_window` to 375px, navigate to `/dashboard`, and confirm via `read_page` that (a)
no horizontal scroll strip renders below the header, (b) the fixed bottom tab bar (Home/Expenses/
+Add/Pending/Insights) still renders, (c) tapping the hamburger icon still shows all six nav items
plus Profile/Settings. Repeat at 768px to confirm the strip doesn't reappear at tablet width
either (it was `lg:hidden`, so it should already be fully gone).

If no logged-in session is reachable (no test credentials in this environment), skip this step
and ask the user to spot-check the three points above after this task lands.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/AppLayout.tsx
git commit -m "fix(nav): remove redundant mobile sub-nav strip

Bottom tab bar and hamburger menu already cover every route this
strip listed — a third nav surface on the same screen was splitting
attention and burying Budgets/Subscriptions off the thumb-reachable
bottom bar without actually making them any more discoverable."
```

---

### Task 2: Sharpen Budgets/Insights subtitles and add cross-link cards (F2)

**Files:**
- Modify: `src/pages/BudgetsPage.tsx:1-16` (import), `:168-177` (header)
- Modify: `src/pages/AnalyticsPage.tsx` (import), `:663-666` (subtitle), after `:678` (cross-link)

- [ ] **Step 1: Add the `Link` import to BudgetsPage**

In `src/pages/BudgetsPage.tsx`, change:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { AppLayout } from '@/layouts'
```

to:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
```

- [ ] **Step 2: Sharpen the Budgets subtitle and add a cross-link to Insights**

In `src/pages/BudgetsPage.tsx`, change:

```tsx
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Budget Limits</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Establish monthly limits per category and monitor your limits.
            </p>
          </div>

          <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
        </div>
```

to:

```tsx
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Budget Limits</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Set per-category monthly limits and get overspend warnings before they happen.
            </p>
          </div>

          <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
        </div>

        <Link
          to="/insights"
          className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle/40 bg-surface-2/30 px-4 py-2.5 text-xs text-zinc-400 hover:bg-surface-2/60 hover:text-zinc-200 transition-colors"
        >
          <span>Want the full picture of this month's spending, not just limits?</span>
          <span className="font-semibold text-brand-400 shrink-0">Insights →</span>
        </Link>
```

- [ ] **Step 3: Add the `Link` import to AnalyticsPage**

In `src/pages/AnalyticsPage.tsx`, find the import block starting `import { useState, useEffect,
useMemo } from 'react'` and add a new import line directly after it:

```tsx
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
```

- [ ] **Step 4: Sharpen the Insights subtitle and add a cross-link to Budgets**

In `src/pages/AnalyticsPage.tsx`, change:

```tsx
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Insights</h1>
            <p className="mt-1 text-xs text-zinc-400">
              CA-verified budget diagnostics, cashflow trend analytics, and smart wealth advisors unified.
            </p>
```

to:

```tsx
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Insights</h1>
            <p className="mt-1 text-xs text-zinc-400">
              Understand where your money went this period and whether your spending split is healthy.
            </p>
```

Then, immediately after the header's closing `</div>` (the one right before `{error && (`), add:

```tsx
        <Link
          to="/budgets"
          className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle/40 bg-surface-2/30 px-4 py-2.5 text-xs text-zinc-400 hover:bg-surface-2/60 hover:text-zinc-200 transition-colors"
        >
          <span>Want spending limits with overspend alerts instead?</span>
          <span className="font-semibold text-brand-400 shrink-0">Budgets →</span>
        </Link>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Browser verification**

If reachable: load `/budgets` and `/insights` at 375px and 1280px, confirm both subtitles read
correctly, confirm the cross-link card renders and navigates to the other page on click. If not
reachable, ask the user to spot-check.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BudgetsPage.tsx src/pages/AnalyticsPage.tsx
git commit -m "fix(nav): differentiate Budgets and Insights with subtitles and cross-links

Both pages answer a version of 'am I spending too much' under
different names with no acknowledgment of each other. Sharper
subtitles plus a one-line cross-link card on each page let a user
self-correct on first read instead of by trial and error."
```

---

### Task 3: Scope the Insights "Advisory period" control to the section it governs (F3)

**Files:**
- Modify: `src/pages/AnalyticsPage.tsx` (header block, showAdvanced block)

No hard dependency on Task 2 — they touch different lines within the same header block (Task 2
only changes the subtitle `<p>` text and adds content after the block; this task only changes the
Range/Advisory-period `<div>` within it). Listed after Task 2 simply because both land in the same
file and this order matches the spec's fix-order numbering.

- [ ] **Step 1: Remove "Advisory period" from the shared header**

In `src/pages/AnalyticsPage.tsx`, change:

```tsx
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-4 self-start sm:self-center shrink-0 bg-surface-2/40 border border-border-subtle/30 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Range:</span>
              <PeriodSelector value={range} onChange={setRange} id="insights-range" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Advisory period:</span>
              <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
            </div>
          </div>
```

to:

```tsx
          <div className="flex items-center gap-2 self-start sm:self-center shrink-0 bg-surface-2/40 border border-border-subtle/30 rounded-xl px-3 py-2">
            <span className="text-xs text-zinc-500">Range:</span>
            <PeriodSelector value={range} onChange={setRange} id="insights-range" />
          </div>
```

- [ ] **Step 2: Reinsert "Advisory period" inside the advanced-analysis section it controls**

In `src/pages/AnalyticsPage.tsx`, change:

```tsx
        {showAdvanced && (
          <>
            {/* Executive Diagnostic Summary */}
```

to:

```tsx
        {showAdvanced && (
          <>
            <div className="flex items-center justify-end gap-2 -mt-2">
              <span className="text-xs text-zinc-500">Advisory period:</span>
              <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
            </div>

            {/* Executive Diagnostic Summary */}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

If reachable: load `/insights`, confirm the header now shows only "Range." Click "Show advanced
analysis" and confirm "Advisory period" appears directly above the health-score/50-30-20 section,
changing it updates that section's numbers (health score, needs/wants/savings, burn-down) without
affecting the trend chart / category breakdown / merchant leaderboard above the toggle. If not
reachable, ask the user to spot-check this specific behavior since it's the core of the fix.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AnalyticsPage.tsx
git commit -m "fix(insights): scope Advisory period control to the section it governs

Range and Advisory period sat side by side in the header controlling
different sections below with no visual cue which did what. Moving
Advisory period inside the advanced-analysis toggle it actually
drives makes the relationship obvious instead of implicit."
```

---

### Task 4: Single-priority banner on the Pending page (F4)

**Files:**
- Modify: `src/pages/PendingPage.tsx`

Up to six independent banners can currently all render simultaneously. This task computes one
`activeBanner` value and gates each banner block on it, in priority order: blocking error >
premium gate > Gmail-connect prompt > inactivity warning > cooldown > success. The always-shown
"your data stays on your device" / "explore with demo data" explainer cards (rendered separately,
guarded by `!isGoogleConnected` further down) are informational content, not transient banners,
and are intentionally left untouched.

- [ ] **Step 1: Compute the active banner**

In `src/pages/PendingPage.tsx`, immediately before the `return (` statement (right after the
`handleReconnectGoogle` function definition, before the component's JSX), add:

```tsx
  // Only one banner shows at a time — a first-time or trial user hitting this
  // page could otherwise see up to six stacked alerts before a single
  // transaction. Priority: blocking error > premium gate > connect prompt >
  // inactivity > cooldown > success.
  const activeBanner: 'error' | 'premium' | 'connect' | 'inactivity' | 'cooldown' | 'success' | null =
    error ? 'error'
    : isPremiumRequired ? 'premium'
    : !isGoogleConnected ? 'connect'
    : showInactivityBanner ? 'inactivity'
    : scanCooldownMessage ? 'cooldown'
    : scanSuccessMessage ? 'success'
    : null

  return (
```

- [ ] **Step 2: Gate the premium-gate banner**

Change:

```tsx
        {isPremiumRequired && (
          <div className="rounded-3xl bg-brand-500/10 border border-brand-500/30 p-6 flex flex-col items-center text-center gap-4 shadow-[var(--shadow-md)] animate-fade-in">
```

to:

```tsx
        {activeBanner === 'premium' && (
          <div className="rounded-3xl bg-brand-500/10 border border-brand-500/30 p-6 flex flex-col items-center text-center gap-4 shadow-[var(--shadow-md)] animate-fade-in">
```

- [ ] **Step 3: Gate the error banner**

Change:

```tsx
        {error && (
          <div role="alert" className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-md">
```

to:

```tsx
        {activeBanner === 'error' && (
          <div role="alert" className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-md">
```

- [ ] **Step 4: Gate the inactivity banner**

Change:

```tsx
        {showInactivityBanner && (
          <div role="alert" className="rounded-2xl bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] p-4 text-sm text-[var(--status-warning-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-md">
```

to:

```tsx
        {activeBanner === 'inactivity' && (
          <div role="alert" className="rounded-2xl bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] p-4 text-sm text-[var(--status-warning-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-md">
```

- [ ] **Step 5: Gate the success banner**

Change:

```tsx
        {scanSuccessMessage && (
          <div role="status" className="rounded-2xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-4 text-sm text-[var(--status-positive-text)] flex items-start justify-between gap-3 animate-fade-in shadow-md">
```

to:

```tsx
        {activeBanner === 'success' && (
          <div role="status" className="rounded-2xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-4 text-sm text-[var(--status-positive-text)] flex items-start justify-between gap-3 animate-fade-in shadow-md">
```

- [ ] **Step 6: Gate the cooldown banner**

Change:

```tsx
        {scanCooldownMessage && (
          <div role="status" className="rounded-2xl bg-brand-500/10 border border-brand-500/20 p-4 text-sm text-brand-500 flex items-start justify-between gap-3 animate-fade-in shadow-md">
```

to:

```tsx
        {activeBanner === 'cooldown' && (
          <div role="status" className="rounded-2xl bg-brand-500/10 border border-brand-500/20 p-4 text-sm text-brand-500 flex items-start justify-between gap-3 animate-fade-in shadow-md">
```

- [ ] **Step 7: Gate the Gmail-connect-prompt banner (not the two-card explainer below it)**

Change (note the `role="status"` — this uniquely identifies the connect *banner*, distinct from
the two-card explainer grid further down which shares the same `!isGoogleConnected` guard but has
no `role="status"`):

```tsx
        {!isGoogleConnected && (
          <div role="status" className="rounded-2xl bg-brand-500/10 border border-brand-500/20 p-4 text-sm text-brand-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-md">
```

to:

```tsx
        {activeBanner === 'connect' && (
          <div role="status" className="rounded-2xl bg-brand-500/10 border border-brand-500/20 p-4 text-sm text-brand-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-md">
```

Do **not** change the later block that starts `{!isGoogleConnected && (` followed by
`<div className="grid gap-6 md:grid-cols-2 animate-fade-in">` — that one stays as-is.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Browser verification**

If reachable: this is hard to fully exercise without controlling backend state for every
condition (premium gate, cooldown, etc.). At minimum, load `/pending` while disconnected from
Gmail and confirm only the connect-prompt banner shows (not also an inactivity banner
underneath), and confirm the two-card "data stays on device / demo data" explainer still renders
below it as before. If not reachable, ask the user to spot-check by triggering at least two
conditions at once (e.g. being logged in with Gmail disconnected AND having a stale scan) and
confirming only one banner shows.

- [ ] **Step 10: Commit**

```bash
git add src/pages/PendingPage.tsx
git commit -m "fix(pending): show at most one priority banner instead of stacking all

Up to six independent banners could render simultaneously, meaning a
new or trial user's first visit could be a wall of alerts before a
single transaction was visible. Priority order: blocking error >
premium gate > Gmail-connect > inactivity > cooldown > success."
```

---

### Task 5: Align Reject to the same undo-toast pattern as Approve (F5)

**Files:**
- Modify: `src/pages/PendingPage.tsx`

- [ ] **Step 1: Remove the `ConfirmDialog` import (no longer used after this task) and the
`confirmRejectId` state**

Change:

```tsx
import { Card, Button, Input, Select, Badge, EmptyState, Modal, ConfirmDialog } from '@/components/ui'
```

to:

```tsx
import { Card, Button, Input, Select, Badge, EmptyState, Modal } from '@/components/ui'
```

Change:

```tsx
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
```

to:

```tsx
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
```

- [ ] **Step 2: Rewrite `handleReject` to be fire-and-forget (called from a timer, not a click
handler) and add `handleRejectWithUndo`**

Change:

```tsx
  const handleReject = async (id: string) => {
    setActionLoadingId(id)
    setError(null)
    try {
      const { error } = await deleteTransaction(id)
      if (error) throw error
      await fetchPendingData()
    } catch (err: any) {
      console.error('Error rejecting transaction:', err)
      setError(err.message || 'Failed to reject transaction.')
    } finally {
      setActionLoadingId(null)
    }
  }
```

to:

```tsx
  // Writes the actual rejection to the database. Split from the tap handler
  // below so the write can be delayed a few seconds for the undo window —
  // mirrors commitApproval's split for the same reason.
  const handleReject = async (id: string) => {
    try {
      const { error } = await deleteTransaction(id)
      if (error) throw error
      await fetchPendingData()
    } catch (err: any) {
      console.error('Error rejecting transaction:', err)
      showToast(err.message || 'Failed to reject transaction.', 'error')
      // Put it back in view so the user isn't left wondering where it went.
      await fetchPendingData()
    }
  }

  // One-tap reject: removes the row immediately, commits the delete a few
  // seconds later, and gives a real Undo window — same friction-reduction
  // pattern as handleApproveWithUndo, since a blocking confirm modal here
  // was an arbitrary extra step for a comparably reversible action.
  const handleRejectWithUndo = (txn: TransactionRow) => {
    setPendingTxns((prev) => prev.filter((t) => t.id !== txn.id))
    setTotalPendingCount((prev) => Math.max(0, prev - 1))
    setTotalPendingValue((prev) => Math.max(0, prev - Number(txn.amount)))

    const timer = setTimeout(() => {
      pendingCommitTimers.delete(txn.id)
      handleReject(txn.id)
    }, 5000)
    pendingCommitTimers.set(txn.id, timer)

    showToast('Alert rejected.', 'success', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingCommitTimers.get(txn.id)
          if (pending) {
            clearTimeout(pending)
            pendingCommitTimers.delete(txn.id)
          }
          setPendingTxns((prev) => [txn, ...prev])
          setTotalPendingCount((prev) => prev + 1)
          setTotalPendingValue((prev) => prev + Number(txn.amount))
        },
      },
    })
  }
```

(`pendingCommitTimers` is the same `Map` already declared above for approve — defined via
`pendingCommitTimersRef` earlier in this file — so no new ref is needed.)

- [ ] **Step 3: Wire the Reject button to the new handler and drop the confirm modal**

Change:

```tsx
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-[var(--status-danger-text)] border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] hover:bg-[var(--status-danger-border)] hover:border-[var(--status-danger-text)]/40 w-full sm:w-auto justify-center gap-1.5"
                      onClick={() => setConfirmRejectId(txn.id)}
                      disabled={actionLoadingId === txn.id}
                    >
                      <Trash2 className="h-4 w-4" /> Reject Alert
                    </Button>
```

to:

```tsx
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-[var(--status-danger-text)] border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] hover:bg-[var(--status-danger-border)] hover:border-[var(--status-danger-text)]/40 w-full sm:w-auto justify-center gap-1.5"
                      onClick={() => handleRejectWithUndo(txn)}
                    >
                      <Trash2 className="h-4 w-4" /> Reject Alert
                    </Button>
```

- [ ] **Step 4: Remove the now-unused `ConfirmDialog` at the bottom of the file**

Delete:

```tsx
      <ConfirmDialog
        isOpen={confirmRejectId !== null}
        onClose={() => setConfirmRejectId(null)}
        onConfirm={async () => {
          if (confirmRejectId) await handleReject(confirmRejectId)
          setConfirmRejectId(null)
        }}
        title="Reject alert"
        message="This transaction alert will be deleted and won't appear in your ledger."
        confirmLabel="Reject"
      />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`actionLoadingId`/`setActionLoadingId` remain used elsewhere in this file for
the category/description edit fields, so they stay declared.)

- [ ] **Step 6: Browser verification**

If reachable: on `/pending`, click "Reject Alert" on a row, confirm the row disappears immediately
(no modal), confirm a toast appears with an "Undo" action, click Undo within 5 seconds and confirm
the row reappears in its original position. Let a rejection run past 5 seconds without undoing and
confirm the row does not reappear on refresh. If not reachable, ask the user to verify this exact
sequence since it changes a data-deletion flow.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PendingPage.tsx
git commit -m "fix(pending): align Reject with Approve's undo-toast pattern

Same row, two different friction models for comparably reversible
actions — Approve used optimistic-UI-plus-undo, Reject used a
blocking confirm modal. Reject now removes the row immediately and
offers a 5s Undo toast instead, matching Approve."
```

---

### Task 6: Cross-reference the two password-change paths (F10)

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (Change Account Password card)
- Modify: `src/pages/ProfilePage.tsx` (Reset My Password card)

- [ ] **Step 1: Add a cross-reference note to Settings' "Change Account Password" card**

In `src/pages/SettingsPage.tsx`, change:

```tsx
              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Update your account password. Passwords must be at least 6 characters.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-3">
```

to:

```tsx
              <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                Update your account password. Passwords must be at least 6 characters.
              </p>
              <p className="text-xs text-zinc-500 mb-4 leading-relaxed italic">
                Forgotten your password entirely? Use "Reset My Password" on your Profile page
                instead — it emails you a reset link.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-3">
```

- [ ] **Step 2: Add a cross-reference note to Profile's "Reset My Password" card**

In `src/pages/ProfilePage.tsx`, change:

```tsx
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                Trigger a secure password reset link. We will send guidelines directly to <strong className="text-zinc-200">{user?.email}</strong>.
              </p>

              <form onSubmit={handlePasswordReset} className="space-y-4">
```

to:

```tsx
              <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                Trigger a secure password reset link. We will send guidelines directly to <strong className="text-zinc-200">{user?.email}</strong>.
              </p>
              <p className="text-xs text-zinc-500 mb-6 leading-relaxed italic">
                Already logged in and know your current password? Change it directly from
                Settings instead — faster, no email required.
              </p>

              <form onSubmit={handlePasswordReset} className="space-y-4">
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

If reachable: load `/settings` and `/profile`, confirm both cross-reference lines render legibly
under each password card at 375px (no truncation/overflow). If not reachable, ask the user to
spot-check.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/ProfilePage.tsx
git commit -m "fix(account): cross-reference the two password-change paths

Change Account Password (Settings) and Reset My Password (Profile)
are both legitimate but neither page told the user the other
existed. A one-line note on each now points at the other."
```

---

### Task 7: Collapse the danger zone behind an explicit expand step (F11)

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Add `showDangerZone` state**

Change:

```tsx
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false)
```

to:

```tsx
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false)
  const [showDangerZone, setShowDangerZone] = useState(false)
```

- [ ] **Step 2: Wrap the two destructive cards behind a toggle**

Change:

```tsx
            {/* Account Data Reset zone */}
            <Card className="border-[var(--status-danger-border)]/50 bg-[var(--status-danger-subtle)]/10">
```

to:

```tsx
            {!showDangerZone ? (
              <button
                type="button"
                onClick={() => setShowDangerZone(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--status-danger-border)]/40 bg-[var(--status-danger-subtle)]/5 text-xs font-semibold text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]/15 transition-colors"
              >
                ⚠️ Show danger zone (reset data / delete account)
              </button>
            ) : (
              <>
            {/* Account Data Reset zone */}
            <Card className="border-[var(--status-danger-border)]/50 bg-[var(--status-danger-subtle)]/10">
```

Then, at the very end of the right column — right after the closing `</Card>` of the "Danger Zone:
Permanent Deletion" card and before the column's closing `</div>` — change:

```tsx
              </form>
            </Card>
          </div>
        </div>
```

(this is the closing of the Delete Account form/Card, followed by the right-column `</div>` and
the outer grid's `</div>`) to:

```tsx
              </form>
            </Card>
              </>
            )}
          </div>
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (JSX fragment indentation doesn't need to be perfectly aligned for TSX to
compile — run a formatter afterward if the project has one configured; check for a `.prettierrc`
or `prettier` in `package.json` first, and if present, run it on this file only.)

- [ ] **Step 4: Browser verification**

If reachable: load `/profile`, confirm "Populate Demo Data" card shows immediately, confirm
"Reset Account Data" and "Delete Account" cards are hidden behind a "Show danger zone" button,
click it, confirm both cards appear. If not reachable, ask the user to spot-check.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "fix(profile): collapse danger zone behind explicit expand step

Reset Account Data and Delete Account sat one scroll below a playful
Populate Demo Data button with only color differentiating severity.
Requiring an explicit 'Show danger zone' click adds a deliberate
extra step before either destructive control is even reachable."
```

---

### Task 8: Warning-tier styling for the Financial Year rollover (F12)

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Restyle the card and icon to warning-tier colors**

Change:

```tsx
            {/* Financial Year Management Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Financial Year Management</span>
              </h2>
```

to:

```tsx
            {/* Financial Year Management Card */}
            <Card className="border-[var(--status-warning-border)]/50 bg-[var(--status-warning-subtle)]/10 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[var(--status-warning-text)] shrink-0" />
                <span>Financial Year Management</span>
              </h2>
```

- [ ] **Step 2: Add explicit caution copy next to the rollover action**

Change:

```tsx
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-col">
                    <span className="text-zinc-400 font-medium">Start New Financial Year</span>
                    <span className="text-xs text-zinc-500">Enable scanning for the next calendar year ({activeYear + 1})</span>
                  </div>
                  <Button
```

to:

```tsx
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-col">
                    <span className="text-zinc-400 font-medium">Start New Financial Year</span>
                    <span className="text-xs text-zinc-500">Enable scanning for the next calendar year ({activeYear + 1})</span>
                    <span className="text-xs text-[var(--status-warning-text)] font-medium mt-1">
                      ⚠️ Scanning for {activeYear} stops once you do this — it can't be reversed.
                    </span>
                  </div>
                  <Button
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

If reachable: load `/settings`, confirm the Financial Year Management card now has an amber/warning
border and icon (matching Budgets' near-limit warning color), confirm the new caution line renders
above the "Start" button. If not reachable, ask the user to spot-check.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "fix(settings): give Financial Year rollover warning-tier styling

It changes state in a way that stops the current year's scanning,
comparable in severity to Profile's Reset Account Data, but had no
caution styling at all — just a plain neutral card."
```

---

### Task 9: Reorder Subscriptions content so mobile sees the calendar first (F6)

**Files:**
- Modify: `src/pages/SubscriptionsPage.tsx`

- [ ] **Step 1: Add order classes to both columns**

Change:

```tsx
          <div className="grid gap-6 md:grid-cols-3">
            {/* Left Column: Summary Card and Manual Creator */}
            <div className="md:col-span-1 space-y-6">
```

to:

```tsx
          <div className="grid gap-6 md:grid-cols-3">
            {/* Left Column: Summary Card and Manual Creator — ordered after the
                calendar on mobile since the calendar is why someone opens this page */}
            <div className="md:col-span-1 space-y-6 order-2 md:order-1">
```

Change:

```tsx
            {/* Right Column: Active Subscriptions List */}
            <div className="md:col-span-2">
```

to:

```tsx
            {/* Right Column: Active Subscriptions List */}
            <div className="md:col-span-2 order-1 md:order-2">
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Browser verification**

If reachable: load `/subscriptions` at 375px, confirm the renewal calendar (search/filter row +
subscription list) renders before the "Total Subscriptions" summary card and manual-add form.
Resize to 1024px+ and confirm the original left/right two-column layout is unchanged. If not
reachable, ask the user to spot-check both widths.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SubscriptionsPage.tsx
git commit -m "fix(subscriptions): show renewal calendar before setup widgets on mobile

Summary/optimization/manual-add cards (secondary/setup content)
preceded the renewal calendar (the actual reason to open this page)
in DOM order, pushing it below the fold on narrow viewports."
```

---

### Task 10: Per-type icons in the notification dropdown (F8)

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

- [ ] **Step 1: Add the new icon imports**

Change:

```tsx
import {
  Bell,
  User,
  Settings,
  Crown,
  LogOut,
  Menu,
  X,
  BarChart3,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Star,
  Home,
  CreditCard,
  Plus,
  Sparkles,
} from 'lucide-react'
```

to:

```tsx
import {
  Bell,
  User,
  Settings,
  Crown,
  LogOut,
  Menu,
  X,
  BarChart3,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Star,
  Home,
  CreditCard,
  Plus,
  Sparkles,
  Wallet,
  HandCoins,
  ShieldAlert,
} from 'lucide-react'
```

- [ ] **Step 2: Add a notification-type-to-icon helper**

Directly above the `return (` statement of the `AppLayout` component (same insertion point style
as other helpers in this file — place it near `getFirstName`), add:

```tsx
  // Maps a notification's key prefix (set when the item was pushed in
  // fetchNotifications above) to its source concern, so the dropdown reads
  // at a glance instead of requiring every line to be read individually.
  const getNotificationIcon = (key: string) => {
    if (key.startsWith('budget_')) return Wallet
    if (key.startsWith('receivable_')) return HandCoins
    if (key.startsWith('insurance_')) return ShieldAlert
    return Bell
  }
```

- [ ] **Step 3: Render the icon per notification row**

Change:

```tsx
                          <div className="space-y-2">
                            {notifications.map((n) => (
                              <Link
                                key={n.key}
                                to={n.href}
                                onClick={() => setNotificationDropdownOpen(false)}
                                className={cn(
                                  "block p-2.5 rounded-lg border text-xs leading-relaxed font-semibold transition-all hover:opacity-85",
                                  n.type === 'danger'
                                    ? 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]'
                                    : n.type === 'warning'
                                    ? 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]'
                                    : (isStaticLight ? 'bg-sb-canvas-soft border-sb-hairline text-sb-ink' : 'bg-surface-2 border-border-subtle text-zinc-300')
                                )}
                              >
                                {n.message}
                              </Link>
                            ))}
                          </div>
```

to:

```tsx
                          <div className="space-y-2">
                            {notifications.map((n) => {
                              const NotifIcon = getNotificationIcon(n.key)
                              return (
                                <Link
                                  key={n.key}
                                  to={n.href}
                                  onClick={() => setNotificationDropdownOpen(false)}
                                  className={cn(
                                    "flex items-start gap-2 p-2.5 rounded-lg border text-xs leading-relaxed font-semibold transition-all hover:opacity-85",
                                    n.type === 'danger'
                                      ? 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]'
                                      : n.type === 'warning'
                                      ? 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]'
                                      : (isStaticLight ? 'bg-sb-canvas-soft border-sb-hairline text-sb-ink' : 'bg-surface-2 border-border-subtle text-zinc-300')
                                  )}
                                >
                                  <NotifIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span>{n.message}</span>
                                </Link>
                              )
                            })}
                          </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Browser verification**

If reachable: trigger at least a budget-warning and a pending-count notification (or read
`fetchNotifications` in `AppLayout.tsx` to confirm key prefixes match: `pending_count`,
`budget_over_*`/`budget_near_*`, `receivable_overdue_*`/`receivable_soon_*`,
`insurance_overdue_*`/`insurance_soon_*`), open the bell dropdown, confirm each row shows a
distinct icon matching its concern type. If not reachable, ask the user to spot-check.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/AppLayout.tsx
git commit -m "fix(notifications): add per-type icon to bell dropdown rows

Four unrelated concern types (pending txns, budget breach,
receivables, insurance) shared one undifferentiated stream with only
background color to distinguish them. A type icon per row lets users
triage without reading every line."
```

---

### Task 11: Link Dashboard's insurance card to where premiums are managed (F13)

**Files:**
- Modify: `src/components/dashboard/InsurancePremiumCard.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add the `Link` import and a "Manage" link to the card header**

In `src/components/dashboard/InsurancePremiumCard.tsx`, change:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Card, Button } from '@/components/ui'
```

to:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, Button } from '@/components/ui'
```

Change:

```tsx
      <h2 className="text-sm font-bold text-text-primary flex items-center gap-2 mb-3">
        <ShieldCheck className="h-4 w-4 text-brand-400" />
        Premium Due
      </h2>
```

to:

```tsx
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand-400" />
          Premium Due
        </h2>
        <Link
          to="/settings#insurance-policies"
          className="text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors shrink-0"
        >
          Manage →
        </Link>
      </div>
```

- [ ] **Step 2: Add the anchor target in Settings**

In `src/pages/SettingsPage.tsx`, change:

```tsx
            {/* Insurance Policies Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
```

to:

```tsx
            {/* Insurance Policies Card */}
            <Card id="insurance-policies" className="border-border-subtle bg-surface-1 shadow-md">
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Browser verification**

If reachable: with at least one insurance policy due within 7 days, load `/dashboard`, confirm the
Premium Due card shows a "Manage →" link, click it, confirm it navigates to `/settings` and
scrolls to (or lands near) the Insurance Policies card. If not reachable, ask the user to
spot-check — this needs seeded insurance-policy data to even render the card.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/InsurancePremiumCard.tsx src/pages/SettingsPage.tsx
git commit -m "fix(insurance): link Dashboard's premium card to where premiums are managed

Viewing due premiums (Dashboard) and managing policies (Settings)
were two disconnected surfaces with no path between them."
```

---

### Task 12: Responsive fix for the merchant-rule inline form (F14)

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Change the grid breakpoint**

Change:

```tsx
              <form onSubmit={handleAddCustomRule} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4 p-3 bg-surface-2/40 border border-border-subtle/30 rounded-xl">
```

to:

```tsx
              <form onSubmit={handleAddCustomRule} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-4 p-3 bg-surface-2/40 border border-border-subtle/30 rounded-xl">
```

This form sits inside the page's `md:col-span-7` column (out of 12). At `md`/`lg` widths
(768-1279px) that column is roughly 450-620px — a 4-way split gives each field only ~110-150px,
tight for a `<select>` carrying emoji plus label text. Dropping to 2 columns until `xl` (1280px+,
where the same column is ~745px, ~180px per field) avoids the squeeze without changing anything
on mobile (still single-column) or on the widest screens (still 4-column).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Browser verification**

If reachable: load `/settings`, `resize_window` to 768px and confirm the keyword input, category
select, type select, and auto-approve/button row now wrap into a 2-column layout instead of 4
squeezed columns; resize to 1280px+ and confirm it returns to 4 columns comfortably. If not
reachable, ask the user to spot-check specifically at 768-1023px, since that's the range this
fix targets.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "fix(settings): fix tablet-width squeeze on merchant-rule inline form

4-column form nested inside the page's 7/12 column gave each field
~110px at tablet width — too tight for a select carrying emoji plus
label. Now 2 columns until xl (1280px+), where there's enough room."
```

---

### Task 13: Replace emoji section headers with Lucide icons (F7)

**Files:**
- Modify: `src/pages/SubscriptionsPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add the `FileText` import to SubscriptionsPage**

Change:

```tsx
import { RefreshCw } from 'lucide-react'
```

to:

```tsx
import { RefreshCw, FileText } from 'lucide-react'
```

- [ ] **Step 2: Replace the two emoji headers in SubscriptionsPage**

Change:

```tsx
                <h2 className="text-sm font-bold text-zinc-200 mb-4">📝 Add Manual Subscription</h2>
```

to:

```tsx
                <h2 className="text-sm font-bold text-zinc-200 mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-400 shrink-0" />
                  Add Manual Subscription
                </h2>
```

Change:

```tsx
                <h2 className="text-base font-bold text-zinc-200 mb-4">📅 Subscription Renewal Calendar</h2>
```

to:

```tsx
                <h2 className="text-base font-bold text-zinc-200 mb-4 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-brand-400 shrink-0" />
                  Subscription Renewal Calendar
                </h2>
```

- [ ] **Step 3: Add the `Shield` import to SettingsPage**

Change:

```tsx
import {
  Brain,
  Trash2,
  Lock,
  Download,
  Upload,
  FileSpreadsheet,
  FileJson,
  Key,
  Globe,
  Calendar,
  Rocket,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Plus,
  Check,
} from 'lucide-react'
```

to:

```tsx
import {
  Brain,
  Trash2,
  Lock,
  Download,
  Upload,
  FileSpreadsheet,
  FileJson,
  Key,
  Globe,
  Calendar,
  Rocket,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Plus,
  Check,
  Shield,
} from 'lucide-react'
```

- [ ] **Step 4: Replace the Insurance Policies emoji header in SettingsPage**

Change:

```tsx
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <span>🛡️</span>
                <span>Insurance Policies</span>
              </h2>
```

to:

```tsx
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Shield className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Insurance Policies</span>
              </h2>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Browser verification**

If reachable: load `/subscriptions` and `/settings`, confirm the three headers now show Lucide
icons instead of emoji, matching the icon style already used in the nav and on Pending. If not
reachable, ask the user to spot-check.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SubscriptionsPage.tsx src/pages/SettingsPage.tsx
git commit -m "fix(polish): replace emoji section headers with Lucide icons

Nav and Pending use Lucide icons throughout; Subscriptions and
Settings headers mixed in raw emoji, breaking icon-language
consistency within a single session."
```

---

## Post-implementation

After all 13 tasks land, re-open
[`docs/superpowers/specs/2026-08-04-core-app-uiux-behavioral-audit-design.md`](../specs/2026-08-04-core-app-uiux-behavioral-audit-design.md)'s
"Deferred to later specs" section — the first-login onboarding tour (F9) is the next piece of
work, and should be brainstormed fresh once this layout is the one being taught.
