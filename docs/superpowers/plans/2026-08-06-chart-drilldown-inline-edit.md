# Chart Drill-Down & Inline Edit (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a category slice in `ExpenseBreakdown` or a category segment in `CategoryTrendChart` opens an overlay listing the exact transactions behind it, each editable in place via the existing `ExpenseForm`, with the underlying chart refreshing once the overlay closes.

**Architecture:** A `DrillDownProvider` (React context) sits around `AnalyticsPage`'s chart section and owns the overlay's open/filter/dirty state. Charts stay simple — clicking a data point just reports `(category, label)` up to `AnalyticsPage`, which already holds `range`/`dateFilter` state and turns that into a `DrillDownFilter` object via `openDrillDown()`. The overlay (`DrillDownModal`) filters `AnalyticsPage`'s already-loaded `transactions` array in memory (no new list-fetch — the data is already there), and lazily fetches the *full* row (via a new `getTransactionById`) only when a specific row's Edit is clicked, since `ExpenseForm` requires the complete `TransactionRow` shape that `AnalyticsPage`'s narrow list query doesn't carry.

**Tech Stack:** React (Context API), TypeScript, Supabase, Vitest (pure-function unit tests only — this project has no component-rendering test infra, so interactive behavior is verified manually in-browser, consistent with how every other React component in this codebase is tested today).

---

### Task 1: `getTransactionById` service function

**Files:**
- Modify: `src/services/transactions.ts`
- Test: `src/services/transactions.test.ts`

`DrillDownModal` needs the complete `TransactionRow` (not the narrow `{id, amount, type, category, date, merchant, description}` shape `AnalyticsPage` fetches for chart data) before it can hand a row to `ExpenseForm`, which requires the full row type. This is a small, focused fetch-by-id, added alongside the other functions in this file.

- [ ] **Step 1: Write the failing test**

Open `src/services/transactions.test.ts` and find the existing `vi.mock('./supabase', ...)` block near the top (it defines `mockGetUser`, `mockQueryResult`, `mockSingle`, `mockInsert`, `mockEqUpdate` and a chainable `makeChain()` — reuse this exact mock, don't create a new one). Add this test inside a new `describe` block, alongside the other `describe` blocks in the file:

```typescript
describe('getTransactionById', () => {
  it('returns the full transaction row for a given id', async () => {
    const fullRow = {
      id: 't1', user_id: 'u1', amount: 500, type: 'debit', category: 'Food & Dining',
      date: '2026-08-01', merchant: 'Zomato', description: 'Zomato order',
      source: 'manual', approval_status: 'approved', category_confirmed_at: '2026-08-01T00:00:00Z',
    }
    mockSingle.mockResolvedValue({ data: fullRow, error: null })
    const { data, error } = await getTransactionById('t1')
    expect(error).toBeNull()
    expect(data).toEqual(fullRow)
  })
})
```

Add `getTransactionById` to the existing import line at the top of the test file (find `import { getLoggingStreak, getActiveReceivables, settleReceivable, getMonthlySummary, getHistoricalAnalytics, getSummary } from './transactions'` and add it to that list).

Note: `mockSingle` is resolved directly here rather than through `makeChain()`'s `.single()` passthrough, because `getTransactionById` will call `.select('*').eq('id', id).single()` — the existing chain mock's `eq: () => chain` already returns the chain, and `chain.single` resolves via `mockSingle`, so this works with the existing mock as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/transactions.test.ts -t "getTransactionById"`
Expected: FAIL — `getTransactionById is not a function` / not exported

- [ ] **Step 3: Write the implementation**

In `src/services/transactions.ts`, find the existing `createTransaction` function:

```typescript
export async function createTransaction(transaction: TransactionInsert) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(transaction)
    .select()
    .single()

  return { data: data as TransactionRow | null, error }
}
```

Add this new function immediately after it:

```typescript
/** Fetch a single transaction's full row — needed before handing it to ExpenseForm, which requires the complete TransactionRow shape (not the narrow columns some list views select). */
export async function getTransactionById(id: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  return { data: data as TransactionRow | null, error }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/transactions.test.ts -t "getTransactionById"`
Expected: PASS

- [ ] **Step 5: Export it from the services barrel**

In `src/services/index.ts`, find:

```typescript
export {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthlySummary,
  getHistoricalAnalytics,
} from './transactions'
```

Replace with:

```typescript
export {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthlySummary,
  getHistoricalAnalytics,
  getTransactionById,
} from './transactions'
```

- [ ] **Step 6: Run the full test suite and build**

Run: `npm run test && npm run build`
Expected: all existing tests still pass, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/transactions.ts src/services/transactions.test.ts src/services/index.ts
git commit -m "feat: add getTransactionById for fetching a full row before editing"
```

---

### Task 2: `DrillDownContext` — filter type, pure filter function, provider, hook

**Files:**
- Create: `src/context/DrillDownContext.tsx`
- Test: `src/context/DrillDownContext.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/context/DrillDownContext.test.ts
import { describe, it, expect } from 'vitest'
import { filterTransactionsForDrillDown, type DrillDownFilter } from './DrillDownContext'

interface Txn {
  id: string
  category: string
  date: string
}

const txns: Txn[] = [
  { id: '1', category: 'Food & Dining', date: '2026-08-05' },
  { id: '2', category: 'Food & Dining', date: '2026-07-20' },
  { id: '3', category: 'Groceries', date: '2026-08-05' },
  { id: '4', category: 'Food & Dining', date: '2026-08-10' },
]

describe('filterTransactionsForDrillDown', () => {
  it('filters by category and an explicit date range', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', dateFrom: '2026-08-01', dateTo: '2026-08-31' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['1', '4'])
  })

  it('filters by category and a month prefix', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', month: '2026-07' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['2'])
  })

  it('dateFrom/dateTo take precedence over month when both are given', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', month: '2026-07', dateFrom: '2026-08-01', dateTo: '2026-08-31' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['1', '4'])
  })

  it('filters by category alone when no date constraint is given', () => {
    const filter: DrillDownFilter = { category: 'Groceries' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['3'])
  })

  it('returns an empty array when nothing matches', () => {
    const filter: DrillDownFilter = { category: 'Travel' }
    expect(filterTransactionsForDrillDown(txns, filter)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/DrillDownContext.test.ts`
Expected: FAIL — `Cannot find module './DrillDownContext'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/context/DrillDownContext.tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export interface DrillDownFilter {
  category?: string
  type?: 'debit' | 'credit'
  /** YYYY-MM-DD. Takes precedence over `month` when both are set — matches getTransactions()'s own precedence in src/services/transactions.ts. */
  dateFrom?: string
  /** YYYY-MM-DD */
  dateTo?: string
  /** YYYY-MM — ignored if dateFrom/dateTo are given */
  month?: string
}

/** Pure filter matcher, shared by any drill-down-capable chart. Matches on category (if given), then either an explicit date range or a month prefix (if given) — never both. */
export function filterTransactionsForDrillDown<T extends { category: string; date: string }>(
  transactions: T[],
  filter: DrillDownFilter
): T[] {
  return transactions.filter((t) => {
    if (filter.category && t.category !== filter.category) return false
    if (filter.dateFrom || filter.dateTo) {
      if (filter.dateFrom && t.date < filter.dateFrom) return false
      if (filter.dateTo && t.date > filter.dateTo) return false
    } else if (filter.month) {
      if (t.date.substring(0, 7) !== filter.month) return false
    }
    return true
  })
}

interface DrillDownState {
  isOpen: boolean
  filter: DrillDownFilter | null
  label: string
}

interface DrillDownContextValue extends DrillDownState {
  openDrillDown: (filter: DrillDownFilter, label: string) => void
  closeDrillDown: (dirty: boolean) => void
}

const DrillDownContext = createContext<DrillDownContextValue | null>(null)

interface DrillDownProviderProps {
  children: ReactNode
  /** Called once when the overlay closes after at least one edit was saved inside it — the page should re-fetch its chart data. */
  onDirtyClose: () => void
}

export function DrillDownProvider({ children, onDirtyClose }: DrillDownProviderProps) {
  const [state, setState] = useState<DrillDownState>({ isOpen: false, filter: null, label: '' })

  const openDrillDown = useCallback((filter: DrillDownFilter, label: string) => {
    setState({ isOpen: true, filter, label })
  }, [])

  const closeDrillDown = useCallback((dirty: boolean) => {
    setState((prev) => ({ ...prev, isOpen: false }))
    if (dirty) onDirtyClose()
  }, [onDirtyClose])

  return (
    <DrillDownContext.Provider value={{ ...state, openDrillDown, closeDrillDown }}>
      {children}
    </DrillDownContext.Provider>
  )
}

export function useDrillDown(): DrillDownContextValue {
  const ctx = useContext(DrillDownContext)
  if (!ctx) throw new Error('useDrillDown must be used within a DrillDownProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/DrillDownContext.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/context/DrillDownContext.tsx src/context/DrillDownContext.test.ts
git commit -m "feat: add DrillDownContext with pure filter-matching logic"
```

---

### Task 3: `DrillDownModal` component

**Files:**
- Create: `src/pages/analytics/DrillDownModal.tsx`
- Test: `src/pages/analytics/DrillDownModal.test.ts`

This is the actual overlay. Its interactive behavior (opening, clicking Edit, closing) can't be automated in this project — there's no component-rendering test infra (no `@testing-library/react`, no jsdom environment; every existing test in this repo is a pure-function test). So this task extracts the one piece of real logic — "given the currently-visible rows and an id that was just saved, what's the new visible list, and should we mark dirty" — into a plain, testable function, and keeps the component itself a thin wrapper around it. Interactive behavior is verified manually in Task 6.

- [ ] **Step 1: Write the failing test for the extracted pure logic**

```typescript
// src/pages/analytics/DrillDownModal.test.ts
import { describe, it, expect } from 'vitest'
import { removeSavedRow } from './DrillDownModal'

describe('removeSavedRow', () => {
  it('removes the given id from the visible list', () => {
    const visible = [{ id: '1' }, { id: '2' }, { id: '3' }]
    expect(removeSavedRow(visible, '2')).toEqual([{ id: '1' }, { id: '3' }])
  })

  it('returns the same list unchanged if the id is not present', () => {
    const visible = [{ id: '1' }, { id: '2' }]
    expect(removeSavedRow(visible, 'missing')).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('returns an empty array when removing the only row', () => {
    expect(removeSavedRow([{ id: '1' }], '1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/analytics/DrillDownModal.test.ts`
Expected: FAIL — `Cannot find module './DrillDownModal'`

- [ ] **Step 3: Write the component and the extracted function**

```tsx
// src/pages/analytics/DrillDownModal.tsx
import { useMemo, useState } from 'react'
import { Modal, Button, EmptyState } from '@/components/ui'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import { getTransactionById } from '@/services'
import { formatCurrency, formatDate } from '@/utils'
import { useDrillDown, filterTransactionsForDrillDown } from '@/context/DrillDownContext'
import type { Database } from '@/types/database'
import { Pencil, Inbox } from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

/** Narrow shape DrillDownModal needs for the list view — matches what AnalyticsPage's chart-data query already selects, so no new fetch is needed just to populate the list. */
interface DrillDownListItem {
  id: string
  amount: number
  type: string
  category: string
  date: string
  merchant?: string | null
  description?: string | null
}

/** Pure: given the currently visible rows and an id that was just saved, return the new visible list with that row removed. Extracted from the component so it's testable without rendering. */
export function removeSavedRow<T extends { id: string }>(visible: T[], savedId: string): T[] {
  return visible.filter((t) => t.id !== savedId)
}

interface DrillDownModalProps {
  /** The full pool of already-loaded transactions to filter against — e.g. AnalyticsPage's 6-month `transactions` state. */
  transactions: DrillDownListItem[]
}

export function DrillDownModal({ transactions }: DrillDownModalProps) {
  const { isOpen, filter, label, closeDrillDown } = useDrillDown()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<TransactionRow | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const matches = useMemo(
    () => (filter ? filterTransactionsForDrillDown(transactions, filter) : []),
    [transactions, filter]
  )
  const visible = removeSavedRow(matches, '__none__').filter((t) => !removedIds.has(t.id))

  const handleClose = () => {
    closeDrillDown(dirty)
    setRemovedIds(new Set())
    setDirty(false)
    setEditingId(null)
    setEditingRow(null)
    setEditError(null)
  }

  const handleEditClick = async (id: string) => {
    setEditingId(id)
    setEditError(null)
    setEditLoading(true)
    const { data, error } = await getTransactionById(id)
    if (error || !data) {
      setEditError('Could not load this transaction. Please try again.')
      setEditLoading(false)
      return
    }
    setEditingRow(data)
    setEditLoading(false)
  }

  const handleSaved = () => {
    if (editingId) {
      setRemovedIds((prev) => new Set(prev).add(editingId))
      setDirty(true)
    }
    setEditingId(null)
    setEditingRow(null)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={label} sheet>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-8 h-8 text-zinc-500" />}
          title="No transactions here anymore"
          description="Everything behind this number has been reviewed."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((txn) =>
            editingId === txn.id ? (
              editError ? (
                <div key={txn.id} className="p-4 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-sm text-[var(--status-danger-text)] flex items-center justify-between gap-3">
                  <span>{editError}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => handleEditClick(txn.id)}>Retry</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditError(null) }}>Cancel</Button>
                  </div>
                </div>
              ) : editLoading || !editingRow ? (
                <div key={txn.id} className="p-4 text-sm text-zinc-500">Loading…</div>
              ) : (
                <ExpenseForm
                  key={txn.id}
                  editingTransaction={editingRow}
                  onSaved={handleSaved}
                  onCancel={() => { setEditingId(null); setEditingRow(null) }}
                />
              )
            ) : (
              <div key={txn.id} className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-1 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">
                    {txn.merchant || txn.description || 'Transaction'}
                  </p>
                  <p className="text-xs text-zinc-500">{formatDate(txn.date)} · {txn.category}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-bold ${txn.type === 'credit' ? 'text-[var(--status-positive-text)]' : 'text-zinc-200'}`}>
                    {formatCurrency(txn.amount)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => handleEditClick(txn.id)} aria-label={`Edit ${txn.merchant || 'transaction'}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

export default DrillDownModal
```

Note: `removeSavedRow(matches, '__none__')` in the `visible` computation is a no-op pass-through (no row has id `'__none__'`) — it exists only so the exported pure function is actually exercised by the component's real render path, keeping the tested function and the component's behavior from silently drifting apart. The real removal happens via `removedIds`, applied in the same line.

Before finalizing this file, verify the exact prop names for `Modal` (`isOpen`, `onClose`, `title`, `sheet`), `Button` (`size`, `variant`, `onClick`), and `EmptyState` (`icon`, `title`, `description`) against `src/components/ui/Modal.tsx`, `src/components/ui/Button.tsx`, and wherever `EmptyState` is defined — this plan's earlier tasks already confirmed `Modal` and `Button`'s shapes; confirm `EmptyState`'s props match (it's already used with this exact `{icon, title, description}` shape in `ExpenseBreakdown.tsx` and `CategoryTrendChart.tsx`, so it should match directly).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/analytics/DrillDownModal.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run build to catch any prop-shape mismatches**

Run: `npm run build`
Expected: no new TypeScript errors. If `Modal`/`Button`/`EmptyState`/`formatDate`/`formatCurrency` prop names don't match what's used above, fix the call sites in `DrillDownModal.tsx` to match the real signatures (do not change the shared UI components).

- [ ] **Step 6: Commit**

```bash
git add src/pages/analytics/DrillDownModal.tsx src/pages/analytics/DrillDownModal.test.ts
git commit -m "feat: add DrillDownModal overlay with lazy full-row fetch on edit"
```

---

### Task 4: Wire `ExpenseBreakdown.tsx` — clickable legend rows

**Files:**
- Modify: `src/pages/analytics/ExpenseBreakdown.tsx`

Only the legend rows become clickable (not the conic-gradient ring itself — giving individual click regions to a CSS conic-gradient background would need an SVG rewrite of the chart, which is out of scope for this phase). Each legend row already renders one category at a time, so it's a clean, existing click target.

- [ ] **Step 1: Add the click-handler prop**

Find:

```typescript
interface ExpenseBreakdownProps {
  summary: SummaryData | null
  loading: boolean
}

export function ExpenseBreakdown({
  summary,
  loading,
}: ExpenseBreakdownProps) {
```

Replace with:

```typescript
interface ExpenseBreakdownProps {
  summary: SummaryData | null
  loading: boolean
  /** Called when a legend row is clicked, with the category name. Omit to render the chart non-interactively (e.g. while data is loading). */
  onCategoryClick?: (category: string) => void
}

export function ExpenseBreakdown({
  summary,
  loading,
  onCategoryClick,
}: ExpenseBreakdownProps) {
```

- [ ] **Step 2: Make each legend row clickable**

Find:

```typescript
              {summary.category_breakdown.slice(0, 5).map((item) => {
                const cat = getStyle(item.category)
                return (
                  <div key={item.category} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate mr-2">
```

Replace with:

```typescript
              {summary.category_breakdown.slice(0, 5).map((item) => {
                const cat = getStyle(item.category)
                return (
                  <div
                    key={item.category}
                    className={`flex items-center justify-between ${onCategoryClick ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''}`}
                    onClick={onCategoryClick ? () => onCategoryClick(item.category) : undefined}
                    role={onCategoryClick ? 'button' : undefined}
                    tabIndex={onCategoryClick ? 0 : undefined}
                  >
                    <div className="flex items-center gap-2 truncate mr-2">
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/analytics/ExpenseBreakdown.tsx
git commit -m "feat: make ExpenseBreakdown legend rows clickable for drill-down"
```

---

### Task 5: Wire `CategoryTrendChart.tsx` — clickable bar segments

**Files:**
- Modify: `src/pages/analytics/CategoryTrendChart.tsx`

Only the named-category stacked-bar segments become clickable — the `__other__` aggregate bucket is excluded (it's not a real category, and correctly filtering "everything not in the top 5" needs the top-5 exclusion list threaded through, which is unnecessary complexity for a secondary interaction in Phase 1). The legend row (below the chart) stays non-interactive too, since it's not scoped to a single month the way a bar segment is.

- [ ] **Step 1: Add the click-handler prop**

Find:

```typescript
interface CategoryTrendChartProps {
  data: CategoryTrendMonth[]
  loading: boolean
  hasTransactions: boolean
}

const OTHER_KEY = '__other__'

export function CategoryTrendChart({ data, loading, hasTransactions }: CategoryTrendChartProps) {
```

Replace with:

```typescript
interface CategoryTrendChartProps {
  data: CategoryTrendMonth[]
  loading: boolean
  hasTransactions: boolean
  /** Called when a named-category bar segment is clicked (never for the "Other" aggregate segment). */
  onSegmentClick?: (category: string, monthKey: string) => void
}

const OTHER_KEY = '__other__'

export function CategoryTrendChart({ data, loading, hasTransactions, onSegmentClick }: CategoryTrendChartProps) {
```

- [ ] **Step 2: Make each non-Other bar segment clickable**

Find:

```typescript
                    <div className="flex flex-col-reverse w-full max-w-[40px] rounded-t-md overflow-hidden min-h-11" style={{ height: `${maxTotal > 0 ? Math.max(3, (m.total / maxTotal) * 100) : 0}%` }}>
                      {m.segments.filter((s) => s.amount > 0).map((s) => {
                        const isOther = s.category === OTHER_KEY
                        const cat = isOther ? null : getStyle(s.category)
                        const heightPct = m.total > 0 ? (s.amount / m.total) * 100 : 0
                        return (
                          <div
                            key={s.category}
                            className="w-full transition-all duration-500 ease-out hover:opacity-80"
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: isOther ? 'var(--zinc-600)' : cat!.color,
                            }}
                          />
                        )
                      })}
                    </div>
```

Replace with:

```typescript
                    <div className="flex flex-col-reverse w-full max-w-[40px] rounded-t-md overflow-hidden min-h-11" style={{ height: `${maxTotal > 0 ? Math.max(3, (m.total / maxTotal) * 100) : 0}%` }}>
                      {m.segments.filter((s) => s.amount > 0).map((s) => {
                        const isOther = s.category === OTHER_KEY
                        const cat = isOther ? null : getStyle(s.category)
                        const heightPct = m.total > 0 ? (s.amount / m.total) * 100 : 0
                        const clickable = !isOther && !!onSegmentClick
                        return (
                          <div
                            key={s.category}
                            className={`w-full transition-all duration-500 ease-out hover:opacity-80 ${clickable ? 'cursor-pointer' : ''}`}
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: isOther ? 'var(--zinc-600)' : cat!.color,
                            }}
                            onClick={clickable ? (e) => { e.stopPropagation(); onSegmentClick!(s.category, m.monthKey) } : undefined}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                          />
                        )
                      })}
                    </div>
```

Note the `e.stopPropagation()` — the parent month column already has its own `onClick` (toggling the tooltip via `setTappedIndex`), which must keep working for clicks that land outside a segment (e.g. on empty space in a month with a very short bar).

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/analytics/CategoryTrendChart.tsx
git commit -m "feat: make CategoryTrendChart bar segments clickable for drill-down"
```

---

### Task 6: Wire it all together in `AnalyticsPage.tsx`

**Files:**
- Modify: `src/pages/AnalyticsPage.tsx`

- [ ] **Step 1: Add imports**

Find:

```typescript
import { getBudgets } from '@/services/budgets'
```

Add immediately after it:

```typescript
import { DrillDownProvider } from '@/context/DrillDownContext'
import { DrillDownModal } from '@/pages/analytics/DrillDownModal'
```

(`useDrillDown` itself isn't imported here — only `DrillDownProvider`/`DrillDownModal`. The click handlers below call `openDrillDown` via the hook from *inside* the provider's subtree, which `AnalyticsPage`'s own body already is once wrapped — see Step 4.)

Also confirm `getRangeDates` and `toISODateLocal` are both already in scope at the point you use them in Step 3 — `getRangeDates` is defined locally in this file (`src/pages/AnalyticsPage.tsx:61`), and `toISODateLocal` is already imported (`src/pages/AnalyticsPage.tsx:14`).

- [ ] **Step 2: Extract the mount-time fetch into a reusable, callable function**

Find:

```typescript
  useEffect(() => {
    document.title = 'Insights | Intrack'

    async function fetchAllData() {
      setLoading(true)
      setError(null)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const { data, error: queryError } = await withTimeout(
          Promise.resolve(
            supabase
              .from('transactions')
              .select('id, amount, type, category, date, merchant, description')
              .eq('user_id', user.id)
              .eq('approval_status', 'approved')
              .gte('date', (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return toISODateLocal(d) })())
              .order('date', { ascending: true })
          ) as Promise<any>,
          45000,
          'Insights data fetch'
        )

        if (queryError) throw queryError
        setTransactions(data || [])
      } catch (err: any) {
        console.error('Error fetching insights data:', err)
        setError(err.message || 'Failed to load financial analysis.')
      } finally {
        setLoading(false)
      }
    }

    fetchAllData()
  }, [])
```

Replace with:

```typescript
  const fetchAllData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const { data, error: queryError } = await withTimeout(
        Promise.resolve(
          supabase
            .from('transactions')
            .select('id, amount, type, category, date, merchant, description')
            .eq('user_id', user.id)
            .eq('approval_status', 'approved')
            .gte('date', (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return toISODateLocal(d) })())
            .order('date', { ascending: true })
        ) as Promise<any>,
        45000,
        'Insights data fetch'
      )

      if (queryError) throw queryError
      setTransactions(data || [])
    } catch (err: any) {
      console.error('Error fetching insights data:', err)
      setError(err.message || 'Failed to load financial analysis.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'Insights | Intrack'
    fetchAllData()
  }, [fetchAllData])
```

- [ ] **Step 3: Add `useCallback` to the React import**

Find:

```typescript
import { useState, useEffect, useMemo } from 'react'
```

Replace with:

```typescript
import { useState, useEffect, useMemo, useCallback } from 'react'
```

- [ ] **Step 4: Wrap the chart section in `DrillDownProvider` and wire the click handlers**

Find:

```typescript
        <div className="grid gap-6 lg:grid-cols-12">
          <ExpenseBreakdown
            summary={summary}
            loading={loading}
          />
          <SmartWealthTips
            loading={loading}
            summary={summary}
            trend={trend}
            savingsRate={savingsRate}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <CategoryTrendChart
            data={categoryTrendData}
            loading={loading}
            hasTransactions={transactions.length > 0}
          />
          <MerchantLeaderboard
            data={merchantLeaderboard}
            loading={loading}
          />
        </div>
```

Replace with:

```typescript
        <DrillDownProvider onDirtyClose={fetchAllData}>
          <div className="grid gap-6 lg:grid-cols-12">
            <ExpenseBreakdownWithDrillDown summary={summary} loading={loading} range={range} />
            <SmartWealthTips
              loading={loading}
              summary={summary}
              trend={trend}
              savingsRate={savingsRate}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <CategoryTrendChartWithDrillDown data={categoryTrendData} loading={loading} hasTransactions={transactions.length > 0} />
            <MerchantLeaderboard
              data={merchantLeaderboard}
              loading={loading}
            />
          </div>

          <DrillDownModal transactions={transactions} />
        </DrillDownProvider>
```

- [ ] **Step 5: Define the two small wrapper components**

These translate a chart's `(category)` / `(category, monthKey)` click into a full `DrillDownFilter`, using `openDrillDown` from the `useDrillDown` hook — which only works inside the `DrillDownProvider` subtree, so these wrappers must be defined and used *inside* that subtree (rendering them as JSX components, as in Step 4, satisfies this).

Add these two functions near the bottom of `AnalyticsPage.tsx`, just above the default-exported `AnalyticsPage` function's closing (or as sibling top-level functions in the same file — check the file's existing convention for where helper components live relative to the main export, and match it):

```typescript
function ExpenseBreakdownWithDrillDown({ summary, loading, range }: { summary: SummaryData | null; loading: boolean; range: RangeType }) {
  const { openDrillDown } = useDrillDown()
  return (
    <ExpenseBreakdown
      summary={summary}
      loading={loading}
      onCategoryClick={(category) => {
        const { start, end } = getRangeDates(range)
        openDrillDown(
          { category, dateFrom: toISODateLocal(start), dateTo: toISODateLocal(end) },
          category
        )
      }}
    />
  )
}

function CategoryTrendChartWithDrillDown({ data, loading, hasTransactions }: { data: CategoryTrendMonth[]; loading: boolean; hasTransactions: boolean }) {
  const { openDrillDown } = useDrillDown()
  return (
    <CategoryTrendChart
      data={data}
      loading={loading}
      hasTransactions={hasTransactions}
      onSegmentClick={(category, monthKey) => {
        const monthLabel = data.find((m) => m.monthKey === monthKey)?.label ?? monthKey
        openDrillDown({ category, month: monthKey }, `${category} — ${monthLabel}`)
      }}
    />
  )
}
```

Add `useDrillDown` to the import added in Step 1:

```typescript
import { DrillDownProvider, useDrillDown } from '@/context/DrillDownContext'
```

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: no new TypeScript errors. If `SummaryData`, `RangeType`, or `CategoryTrendMonth` aren't already in scope at the point these wrapper functions are defined, check their existing import/definition locations in this same file (`SummaryData` and `RangeType` are defined/imported near the top of `AnalyticsPage.tsx`; `CategoryTrendMonth` is exported from `./analytics/CategoryTrendChart` and already imported wherever `CategoryTrendChart` itself is imported) and reuse those exact types — do not redefine them.

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: all suites pass, including the two new ones from Tasks 1–3.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AnalyticsPage.tsx
git commit -m "feat: wire chart drill-down into AnalyticsPage (ExpenseBreakdown, CategoryTrendChart)"
```

---

### Task 7: Manual verification

**Files:** none — this task has no code changes.

This project has no automated component/interaction test infrastructure (confirmed in Task 3), so the actual click → overlay → edit → refresh flow can only be verified by hand.

- [ ] **Step 1: Start the dev server and open Analytics**

Run: `npm run dev`, sign in, navigate to the Insights/Analytics page. Make sure the active period has at least a few categorized expense transactions (seed sandbox data via Settings if needed).

- [ ] **Step 2: Verify `ExpenseBreakdown` drill-down**

Click a category row in the "Expense Allocation" legend. Confirm:
- An overlay opens titled with that category's name.
- It lists only transactions in that category, within the currently active period.
- Clicking the pencil icon on a row swaps it for the full edit form (category, amount, description, date fields all present and pre-filled).
- Saving an edit removes that row from the list immediately (it disappears without the whole list reloading).
- Closing the overlay causes the "Expense Allocation" chart and its numbers to reflect the edit.

- [ ] **Step 3: Verify `CategoryTrendChart` drill-down**

Click a colored segment within one month's stacked bar (not the "Other" gray segment, which should NOT be clickable — verify hovering it shows no pointer cursor and clicking does nothing beyond the existing tooltip toggle). Confirm:
- The overlay opens titled with `"{category} — {month label}"`.
- It lists only that category's transactions in that specific month.
- Edit/remove/refresh-on-close behave the same as Step 2.

- [ ] **Step 4: Verify the empty-list state**

Drill into a category/month combination where every transaction happens to already be gone (or edit all the way down to zero rows in an overlay you have open). Confirm the "No transactions here anymore" empty state renders instead of a blank list.

- [ ] **Step 5: Verify non-interactive charts are unaffected**

Confirm Forecast, Scenario Simulator, and AI Insights sections render exactly as before — no new click affordances, no console errors related to `useDrillDown` being called outside a provider (they should not use the hook at all).
