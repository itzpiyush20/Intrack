# Custom Date Range Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every month-only picker (Dashboard, Expenses, Budgets, Analytics) with a shared control that supports both the existing calendar-month view and a new arbitrary From/To custom range.

**Architecture:** One new shared component (`DateFilterPicker`) backed by a `DateFilter` union type and a `resolveDateFilter()` helper that turns either mode into a concrete `{dateFrom, dateTo}` pair. The data layer (`getTransactions`, new `getSummary`) accepts that pair directly. Each page swaps its `selectedMonth: string` state for `dateFilter: DateFilter` state and resolves it before calling the data layer — no page reimplements date-range logic itself.

**Tech Stack:** React + TypeScript, Supabase (`.gte()`/`.lte()` range queries), Vitest for the pure-function/service-layer tests (this codebase has no component-level test harness — page wiring is verified via `tsc`, `eslint`, and manual browser check, matching the existing convention where only services/utils are unit-tested).

---

## Reference: current state (as of this plan)

- Only `DashboardPage.tsx` and `ExpensesPage.tsx` use the actual shared `<MonthPicker>` component (`src/components/ui/MonthPicker.tsx`).
- `BudgetsPage.tsx` has its own hand-rolled prev/next month navigator (`handlePrevMonth`/`handleNextMonth`/`formatMonthName`, lines ~125-147 and ~185-209).
- `AnalyticsPage.tsx` has its own bare `<input type="month">` for the "Advisory month" control (lines ~513-521), separate from the unrelated `PeriodSelector` range dropdown (which stays untouched — out of scope).
- All four are being replaced with the new `DateFilterPicker`, so `MonthPicker.tsx` becomes dead code and is deleted at the end.

---

### Task 1: `DateFilter` type and pure date-range helpers

**Files:**
- Create: `src/utils/dateFilter.ts`
- Modify: `src/utils/index.ts` (re-export)
- Test: `src/utils/dateFilter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/utils/dateFilter.test.ts
import { describe, it, expect } from 'vitest'
import { resolveDateFilter, getMonthsInRange, formatDateFilterLabel } from './dateFilter'

describe('resolveDateFilter', () => {
  it('resolves a month filter to that month\'s first and last day', () => {
    expect(resolveDateFilter({ mode: 'month', month: '2026-07' }))
      .toEqual({ dateFrom: '2026-07-01', dateTo: '2026-07-31' })
  })

  it('handles a 30-day month', () => {
    expect(resolveDateFilter({ mode: 'month', month: '2026-04' }))
      .toEqual({ dateFrom: '2026-04-01', dateTo: '2026-04-30' })
  })

  it('handles a non-leap February', () => {
    expect(resolveDateFilter({ mode: 'month', month: '2026-02' }))
      .toEqual({ dateFrom: '2026-02-01', dateTo: '2026-02-28' })
  })

  it('handles a leap-year February', () => {
    expect(resolveDateFilter({ mode: 'month', month: '2028-02' }))
      .toEqual({ dateFrom: '2028-02-01', dateTo: '2028-02-29' })
  })

  it('handles December without rolling into next year', () => {
    expect(resolveDateFilter({ mode: 'month', month: '2025-12' }))
      .toEqual({ dateFrom: '2025-12-01', dateTo: '2025-12-31' })
  })

  it('passes a custom range straight through', () => {
    expect(resolveDateFilter({ mode: 'custom', from: '2026-06-15', to: '2026-07-02' }))
      .toEqual({ dateFrom: '2026-06-15', dateTo: '2026-07-02' })
  })
})

describe('getMonthsInRange', () => {
  it('returns a single month when the range stays within it', () => {
    expect(getMonthsInRange('2026-07-05', '2026-07-20')).toEqual(['2026-07'])
  })

  it('returns every month touched, including both endpoints', () => {
    expect(getMonthsInRange('2026-06-20', '2026-08-05')).toEqual(['2026-06', '2026-07', '2026-08'])
  })

  it('handles a range spanning a year boundary', () => {
    expect(getMonthsInRange('2025-11-20', '2026-02-05')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

describe('formatDateFilterLabel', () => {
  it('formats a month filter as a full month name and year', () => {
    expect(formatDateFilterLabel({ mode: 'month', month: '2026-07' })).toBe('July 2026')
  })

  it('formats a custom range as short from/to dates', () => {
    expect(formatDateFilterLabel({ mode: 'custom', from: '2026-07-01', to: '2026-07-20' }))
      .toBe('1 Jul 2026 – 20 Jul 2026')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/dateFilter.test.ts`
Expected: FAIL — `Cannot find module './dateFilter'` (file doesn't exist yet)

- [ ] **Step 3: Implement the helpers**

```typescript
// src/utils/dateFilter.ts
// ============================================
// DateFilter — shared Month/Custom range type
// used by DateFilterPicker and the data layer
// ============================================

export type DateFilter =
  | { mode: 'month'; month: string }               // month: YYYY-MM
  | { mode: 'custom'; from: string; to: string }   // from/to: YYYY-MM-DD

/** Resolves either filter mode to a concrete inclusive date range. */
export function resolveDateFilter(filter: DateFilter): { dateFrom: string; dateTo: string } {
  if (filter.mode === 'custom') {
    return { dateFrom: filter.from, dateTo: filter.to }
  }
  const [year, mon] = filter.month.split('-').map(Number)
  const dateFrom = `${filter.month}-01`
  // Day 0 of the *next* month is the last day of this one — and passing
  // month index `mon` (1-indexed) as Date's 0-indexed month argument
  // already means "next month", so this rolls across year boundaries
  // (e.g. December -> January) correctly with no special-casing.
  const dateTo = new Date(year, mon, 0).toISOString().split('T')[0]
  return { dateFrom, dateTo }
}

/** Every YYYY-MM month touched by [dateFrom, dateTo], inclusive, in chronological order. */
export function getMonthsInRange(dateFrom: string, dateTo: string): string[] {
  const [fromYear, fromMon] = dateFrom.split('-').map(Number)
  const [toYear, toMon] = dateTo.split('-').map(Number)

  const months: string[] = []
  let year = fromYear
  let mon = fromMon
  while (year < toYear || (year === toYear && mon <= toMon)) {
    months.push(`${year}-${String(mon).padStart(2, '0')}`)
    mon++
    if (mon > 12) {
      mon = 1
      year++
    }
  }
  return months
}

/** Human-readable label for a filter — "July 2026" or "1 Jul 2026 – 20 Jul 2026". */
export function formatDateFilterLabel(filter: DateFilter): string {
  if (filter.mode === 'month') {
    const [year, mon] = filter.month.split('-').map(Number)
    return new Date(year, mon - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }
  const formatOne = (d: string) => {
    const [year, mon, day] = d.split('-').map(Number)
    return new Date(year, mon - 1, day).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  return `${formatOne(filter.from)} – ${formatOne(filter.to)}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/dateFilter.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Re-export from the main utils barrel**

```typescript
// src/utils/index.ts
// Add near the bottom, next to the existing crypto.js re-export:
export { encryptText, decryptText } from './crypto.js'
export { resolveDateFilter, getMonthsInRange, formatDateFilterLabel, type DateFilter } from './dateFilter'
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/dateFilter.ts src/utils/dateFilter.test.ts src/utils/index.ts
git commit -m "feat: add DateFilter type and date-range resolution helpers"
```

---

### Task 2: Extend `getTransactions()` with an explicit date range

**Files:**
- Modify: `src/services/transactions.ts:14-62`

- [ ] **Step 1: Update the function**

Replace the whole `getTransactions` function (lines 14-62) with:

```typescript
/** Fetch transactions for current user with filters */
export async function getTransactions(options?: {
  month?: string        // YYYY-MM — ignored if dateFrom/dateTo are given
  dateFrom?: string      // YYYY-MM-DD
  dateTo?: string        // YYYY-MM-DD
  type?: 'debit' | 'credit'
  category?: string
  status?: string
  limit?: number
  offset?: number
}) {
  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })

  if (options?.status) {
    query = query.eq('approval_status', options.status)
  } else {
    query = query.eq('approval_status', 'approved')
  }

  query = query
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.dateFrom || options?.dateTo) {
    if (options.dateFrom) query = query.gte('date', options.dateFrom)
    if (options.dateTo) query = query.lte('date', options.dateTo)
  } else if (options?.month) {
    const startDate = `${options.month}-01`
    const [year, mon] = options.month.split('-').map(Number)
    const endDate = new Date(year, mon, 0).toISOString().split('T')[0]
    query = query.gte('date', startDate).lte('date', endDate)
  }

  if (options?.type) {
    query = query.eq('type', options.type)
  }

  if (options?.category) {
    query = query.eq('category', options.category)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  return { data: data as TransactionRow[] | null, error, count }
}
```

This is additive — `month`-only callers (e.g. the category-drilldown fetch, which passes `month` + `category` + `type` together) keep working exactly as before; `dateFrom`/`dateTo` simply take precedence when present.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/transactions.ts
git commit -m "feat: support explicit dateFrom/dateTo range in getTransactions"
```

---

### Task 3: `getSummary()` range-based summary, with `getMonthlySummary` as a thin wrapper

**Files:**
- Modify: `src/services/transactions.ts:97-151`
- Test: `src/services/transactions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/transactions.test.ts`, inside the existing `describe('getMonthlySummary', ...)` block area — add a new sibling `describe` block right after it (after line 216, before `describe('getHistoricalAnalytics', ...)`):

```typescript
describe('getSummary', () => {
  it('aggregates income, expenses and category breakdown for an explicit range', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 500, type: 'debit', category: 'food' },
        { amount: 300, type: 'debit', category: 'transport' },
        { amount: 2000, type: 'credit', category: 'salary' },
      ],
      error: null,
    })
    const { data } = await getSummary({ dateFrom: '2026-06-20', dateTo: '2026-07-05' })
    expect(data!.total_income).toBe(2000)
    expect(data!.total_expenses).toBe(800)
    expect(data!.category_breakdown).toHaveLength(2)
  })

  it('excludes credit_card_bill_payment from totals, same as getMonthlySummary', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 500, type: 'debit', category: 'food' },
        { amount: 15000, type: 'debit', category: 'credit_card_bill_payment' },
      ],
      error: null,
    })
    const { data } = await getSummary({ dateFrom: '2026-07-01', dateTo: '2026-07-31' })
    expect(data!.total_expenses).toBe(500)
  })
})
```

And add `getSummary` to the existing import line at the top of the file:

```typescript
import { getLoggingStreak, getActiveReceivables, settleReceivable, getMonthlySummary, getHistoricalAnalytics, getSummary } from './transactions'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/transactions.test.ts`
Expected: FAIL — `getSummary is not a function` / `does not provide an export named 'getSummary'`

- [ ] **Step 3: Implement `getSummary` and refactor `getMonthlySummary`**

Replace `getMonthlySummary` (lines 97-151) with:

```typescript
/** Get summary (income, expenses, savings, category breakdown) for an explicit date range */
export async function getSummary(range: { dateFrom: string; dateTo: string }) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type, category')
    .eq('approval_status', 'approved')
    .gte('date', range.dateFrom)
    .lte('date', range.dateTo)

  if (error || !data) return { data: null, error }

  const total_income = data
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  // Credit card bill payments are excluded from all expense totals — the
  // purchases they cover were already counted as expenses when they happened,
  // so counting the bill payment too would double-book that spend.
  const expenseTxns = data.filter((t) => t.type === 'debit' && t.category !== 'credit_card_bill_payment')

  const total_expenses = expenseTxns.reduce((sum, t) => sum + Number(t.amount), 0)

  // Category breakdown for debits
  const categoryMap = new Map<string, { amount: number; count: number }>()
  expenseTxns.forEach((t) => {
    const existing = categoryMap.get(t.category) || { amount: 0, count: 0 }
    categoryMap.set(t.category, {
      amount: existing.amount + Number(t.amount),
      count: existing.count + 1,
    })
  })

  const category_breakdown = Array.from(categoryMap.entries())
    .map(([category, { amount, count }]) => ({
      category,
      amount,
      count,
      percentage: total_expenses > 0 ? (amount / total_expenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    data: {
      total_income,
      total_expenses,
      savings: total_income - total_expenses,
      category_breakdown,
    },
    error: null,
  }
}

/** Get monthly summary (income, expenses, savings) — thin wrapper around getSummary */
export async function getMonthlySummary(month: string) {
  const startDate = `${month}-01`
  const [year, mon] = month.split('-').map(Number)
  const endDate = new Date(year, mon, 0).toISOString().split('T')[0]
  return getSummary({ dateFrom: startDate, dateTo: endDate })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/transactions.test.ts`
Expected: PASS — all tests including the pre-existing `getMonthlySummary` ones (their behavior is unchanged, just now routed through `getSummary`)

- [ ] **Step 5: Commit**

```bash
git add src/services/transactions.ts src/services/transactions.test.ts
git commit -m "feat: add getSummary for explicit date ranges, refactor getMonthlySummary onto it"
```

---

### Task 4: `DateFilterPicker` component

**Files:**
- Create: `src/components/ui/DateFilterPicker.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/DateFilterPicker.tsx
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from './Button'
import { cn, getCurrentMonth, resolveDateFilter, type DateFilter } from '@/utils'

interface DateFilterPickerProps {
  value: DateFilter
  onChange: (next: DateFilter) => void
  /** Furthest month the user can navigate forward to in Month mode. Defaults to the current month. */
  maxMonth?: string
  className?: string
}

function shiftMonth(monthStr: string, delta: number): string {
  const [year, mon] = monthStr.split('-').map(Number)
  const date = new Date(year, mon - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthName(monthStr: string): string {
  const [year, mon] = monthStr.split('-').map(Number)
  return new Date(year, mon - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

export default function DateFilterPicker({ value, onChange, maxMonth, className }: DateFilterPickerProps) {
  const max = maxMonth ?? getCurrentMonth()

  // Remembers the last month viewed in Month mode, so switching Custom -> Month
  // restores where the user left off instead of jumping back to the current month.
  const [lastMonth, setLastMonth] = useState(value.mode === 'month' ? value.month : getCurrentMonth())

  const switchToMonth = () => onChange({ mode: 'month', month: lastMonth })

  const switchToCustom = () => {
    if (value.mode !== 'month') return
    const { dateFrom, dateTo } = resolveDateFilter(value)
    const today = todayStr()
    onChange({ mode: 'custom', from: dateFrom, to: dateTo > today ? today : dateTo })
  }

  const handleMonthChange = (month: string) => {
    setLastMonth(month)
    onChange({ mode: 'month', month })
  }

  const handleFromChange = (from: string) => {
    if (value.mode !== 'custom') return
    onChange({ mode: 'custom', from, to: value.to < from ? from : value.to })
  }

  const handleToChange = (to: string) => {
    if (value.mode !== 'custom') return
    onChange({ mode: 'custom', from: value.from, to })
  }

  return (
    <div className={cn('flex items-center gap-1 bg-surface-1 border border-border-subtle rounded-xl p-1 shrink-0 flex-wrap', className)}>
      <div className="flex items-center gap-0.5 bg-surface-2 rounded-lg p-0.5 mr-0.5" role="tablist" aria-label="Date filter mode">
        <button
          type="button"
          role="tab"
          aria-selected={value.mode === 'month'}
          onClick={switchToMonth}
          className={cn(
            'px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
            value.mode === 'month' ? 'bg-surface-1 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          Month
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value.mode === 'custom'}
          onClick={switchToCustom}
          className={cn(
            'px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
            value.mode === 'custom' ? 'bg-surface-1 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          )}
        >
          Custom
        </button>
      </div>

      {value.mode === 'month' ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleMonthChange(shiftMonth(value.month, -1))}
            className="h-11 w-11 p-0"
            aria-label="Previous month"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-3 text-sm font-semibold text-zinc-200 min-w-[120px] text-center">
            {formatMonthName(value.month)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleMonthChange(shiftMonth(value.month, 1))}
            className="h-11 w-11 p-0"
            aria-label="Next month"
            title="Next month"
            disabled={value.month >= max}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-1.5 px-1">
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => handleFromChange(e.target.value)}
            className="bg-surface-2 border border-border-subtle/50 text-zinc-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
            aria-label="From date"
          />
          <span className="text-zinc-600 text-xs" aria-hidden="true">–</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={todayStr()}
            onChange={(e) => handleToChange(e.target.value)}
            className="bg-surface-2 border border-border-subtle/50 text-zinc-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
            aria-label="To date"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Export it, remove the old export**

```typescript
// src/components/ui/index.ts
export { default as Card } from './Card'
export { default as Button } from './Button'
export { default as Input } from './Input'
export { default as Select } from './Select'
export { default as Badge } from './Badge'
export { default as EmptyState } from './EmptyState'
export { default as Modal } from './Modal'
export { default as ConfirmDialog } from './ConfirmDialog'
export { default as DateFilterPicker } from './DateFilterPicker'
export { default as UserMenu } from './UserMenu'
```

(The `MonthPicker` export line is removed here — the file itself is deleted in Task 9 once every consumer has migrated.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: errors in `DashboardPage.tsx`, `ExpensesPage.tsx` (still importing `MonthPicker`, which no longer exports) — **expected at this point**, resolved in Tasks 5-8.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DateFilterPicker.tsx src/components/ui/index.ts
git commit -m "feat: add DateFilterPicker component with Month/Custom toggle"
```

---

### Task 5: Wire into Expenses page

**Files:**
- Modify: `src/pages/ExpensesPage.tsx`

- [ ] **Step 1: Update imports and state**

```typescript
// Replace this import:
import { Button, Modal, MonthPicker } from '@/components/ui'
// With:
import { Button, Modal, DateFilterPicker } from '@/components/ui'
```

Add `DateFilter`/`resolveDateFilter` to the existing utils import:

```typescript
// Replace:
import { formatCurrency, getCurrentMonth, withTimeout } from '@/utils'
// With:
import { formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, type DateFilter } from '@/utils'
```

Replace the `selectedMonth` state declaration:

```typescript
// Replace:
const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
// With:
const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
```

- [ ] **Step 2: Update the fetch**

```typescript
// Replace fetchTransactions (currently uses getTransactions({ month: selectedMonth })):
const fetchTransactions = useCallback(async () => {
  setLoading(true)
  setError(null)
  try {
    const { data } = await withTimeout(
      getTransactions(resolveDateFilter(dateFilter)),
      45000,
      'Transactions fetch'
    )
    setTransactions(data || [])
  } catch (err: any) {
    console.error('Error fetching transactions:', err)
    setError(err.message || 'Failed to load transactions.')
  } finally {
    setLoading(false)
  }
}, [dateFilter])
```

- [ ] **Step 3: Update the JSX**

```typescript
// Replace:
<MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
// With:
<DateFilterPicker value={dateFilter} onChange={setDateFilter} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `ExpensesPage.tsx` (Dashboard/Budgets/Analytics errors remain until their tasks land)

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/expenses`.
- Confirm the page loads showing the current month's transactions, same as before.
- Click "Custom", pick a From/To date spanning two months, confirm the list updates to show only transactions in that range.
- Click "Month" again, confirm it returns to the month you were last viewing.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ExpensesPage.tsx
git commit -m "feat: wire DateFilterPicker into Expenses page"
```

---

### Task 6: Wire into Dashboard page

**Files:**
- Modify: `src/pages/DashboardPage.tsx`

- [ ] **Step 1: Update imports and state**

```typescript
// Replace:
import { Card, Button, EmptyState, Modal, MonthPicker } from '@/components/ui'
// With:
import { Card, Button, EmptyState, Modal, DateFilterPicker } from '@/components/ui'
```

```typescript
// Replace:
import { formatCurrency, formatCurrencyCompact, getCurrentMonth, formatDate, withTimeout } from '@/utils'
// With:
import { formatCurrency, formatCurrencyCompact, getCurrentMonth, formatDate, withTimeout, resolveDateFilter, formatDateFilterLabel, type DateFilter } from '@/utils'
```

```typescript
// Replace (line 90):
const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
// With:
const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
```

- [ ] **Step 2: Update `fetchDashboardData` and its callers**

`fetchDashboardData` currently takes a `month: string` param and calls `getMonthlySummary(month)` / `getBudgets(month)`. Change it to take the resolved range plus (for budgets) the filter itself, since budgets need the month list, not just the date bounds:

```typescript
// Replace the fetchDashboardData definition:
const fetchDashboardData = useCallback(async (filter: DateFilter, silent = false) => {
  if (!silent) {
    setLoading(true)
    setError(null)
  }
  try {
    const { dateFrom, dateTo } = resolveDateFilter(filter)
    const [summaryRes, transactionsRes, budgetsRes] = await withTimeout(
      Promise.all([
        getSummary({ dateFrom, dateTo }),
        getTransactions({ limit: 5 }), // Show global recent transactions
        filter.mode === 'month'
          ? getBudgets(filter.month)
          : Promise.all(getMonthsInRange(dateFrom, dateTo).map((m) => getBudgets(m))).then((results) => ({
              data: results.flatMap((r) => r.data || []),
              error: results.find((r) => r.error)?.error || null,
            })),
      ]),
      45000, // 45-second timeout to handle Supabase cold starts
      'Dashboard data fetch'
    )

    if (summaryRes.error) throw summaryRes.error
    if (transactionsRes.error) throw transactionsRes.error

    setSummary(summaryRes.data)
    setRecentTransactions(transactionsRes.data || [])
    setMonthBudgetTotal((budgetsRes.data || []).reduce((sum, b) => sum + Number(b.amount), 0))
    if (silent) setError(null) // Clear any previous timeout error on silent success
  } catch (err: any) {
    console.error('Error fetching dashboard data:', err)
    setError(err.message || 'Failed to load dashboard data.')
  } finally {
    setLoading(false)
  }
}, [])
```

Add `getSummary` to the existing transactions import:

```typescript
// Replace:
import { getTransactions, getMonthlySummary, getLoggingStreak } from '@/services/transactions'
// With:
import { getTransactions, getMonthlySummary, getSummary, getLoggingStreak } from '@/services/transactions'
```

Add `getMonthsInRange` to the utils import from Step 1 (append to the list already added there):

```typescript
import { formatCurrency, formatCurrencyCompact, getCurrentMonth, formatDate, withTimeout, resolveDateFilter, formatDateFilterLabel, getMonthsInRange, type DateFilter } from '@/utils'
```

Update every call site that passed `selectedMonth` to `fetchDashboardData` to pass `dateFilter` instead — there are 5 call sites (background-sync success at what was line 291, the two `useEffect`s at ~316/325, the demo-seed success at ~398, and the ReceivablesCard/InsurancePremiumCard `onSettled`/`onPaid` callbacks at ~743/754/755). Do a literal find-and-replace of `fetchDashboardData(selectedMonth` → `fetchDashboardData(dateFilter` across the file (every occurrence takes the same argument shape change).

Also update the `useEffect` dependency arrays and the `checkScheduledTasks` dependency array from `selectedMonth` to `dateFilter` (they currently list `selectedMonth` as a dependency alongside `fetchDashboardData`).

- [ ] **Step 3: Update `handleCategoryClick`**

```typescript
// Replace:
const handleCategoryClick = async (categoryCode: string) => {
  setSelectedCategoryCode(categoryCode)
  setShowCategoryModal(true)
  setLoadingCategoryTxns(true)
  try {
    const { data } = await getTransactions({
      month: selectedMonth,
      category: categoryCode,
      type: 'debit',
      limit: 100,
    })
    setCategoryTransactions(data || [])
  } catch (e) {
    console.error('Error loading category transactions:', e)
  } finally {
    setLoadingCategoryTxns(false)
  }
}
// With:
const handleCategoryClick = async (categoryCode: string) => {
  setSelectedCategoryCode(categoryCode)
  setShowCategoryModal(true)
  setLoadingCategoryTxns(true)
  try {
    const { data } = await getTransactions({
      ...resolveDateFilter(dateFilter),
      category: categoryCode,
      type: 'debit',
      limit: 100,
    })
    setCategoryTransactions(data || [])
  } catch (e) {
    console.error('Error loading category transactions:', e)
  } finally {
    setLoadingCategoryTxns(false)
  }
}
```

- [ ] **Step 4: Update `isCurrentMonth` and the JSX**

```typescript
// Replace:
const isCurrentMonth = selectedMonth === getCurrentMonth()
// With:
const isCurrentMonth = dateFilter.mode === 'month' && dateFilter.month === getCurrentMonth()
```

```typescript
// Replace:
<MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
// With:
<DateFilterPicker value={dateFilter} onChange={setDateFilter} />
```

```typescript
// Replace the subtitle:
<p className="text-sm text-zinc-400">
  Here is your wealth overview for this month.
</p>
// With:
<p className="text-sm text-zinc-400">
  Here is your wealth overview{dateFilter.mode === 'month' ? ' for this month' : ''}.
</p>
```

- [ ] **Step 5: Update the breakdown card copy and empty state**

```typescript
// Replace:
<p className="text-xs text-zinc-500 mt-0.5">Where your money went this month</p>
// With:
<p className="text-xs text-zinc-500 mt-0.5">
  Where your money went{dateFilter.mode === 'month' ? ' this month' : ' in this period'}
</p>
```

```typescript
// Replace:
<EmptyState
  icon={<BarChart2 className="h-8 w-8 text-zinc-500" />}
  title="No expenses tracked"
  description="Add an expense in the selected month to see your breakdown chart."
/>
// With:
<EmptyState
  icon={<BarChart2 className="h-8 w-8 text-zinc-500" />}
  title="No expenses tracked"
  description={dateFilter.mode === 'month'
    ? 'Add an expense in the selected month to see your breakdown chart.'
    : 'No expenses fall in this date range yet.'}
/>
```

- [ ] **Step 6: Update the category modal's month label**

```typescript
// Replace:
const [yearStr, monStr] = selectedMonth.split('-')
const monthDate = new Date(parseInt(yearStr, 10), parseInt(monStr, 10) - 1, 1)
const monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
// With:
const monthLabel = formatDateFilterLabel(dateFilter)
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `DashboardPage.tsx` (Budgets/Analytics errors remain until their tasks land)

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open `/dashboard`.
- Confirm it loads showing the current month's summary and breakdown, same as before.
- Click a category row, confirm the drilldown modal opens with the right label and transactions.
- Switch to Custom, pick a range spanning two months that has budgets set on both, confirm "Safe to spend" style figures still compute sensibly and the breakdown updates.
- Switch back to Month, confirm it returns to the month you were on and the "Safe to spend" hero reappears (it's hidden for non-current-month/custom views, same as today's past-month behavior).

- [ ] **Step 9: Commit**

```bash
git add src/pages/DashboardPage.tsx
git commit -m "feat: wire DateFilterPicker into Dashboard page"
```

---

### Task 7: Wire into Budgets page (multi-month sum in Custom mode)

**Files:**
- Modify: `src/pages/BudgetsPage.tsx`

This page's budgets are inherently per-calendar-month rows (`UNIQUE(user_id, category, month)` in the schema), so a Custom range spanning multiple months needs to **sum** the matching budgets across those months for the summary cards and per-category list, per the approved spec. The add/edit form and per-row delete stay tied to a single month — in Custom mode they target the month of the range's "To" date (labeled explicitly so it's not surprising), and the delete button is hidden on a row that represents a sum across more than one month (nothing unambiguous to delete).

- [ ] **Step 1: Update imports and state**

```typescript
// Replace:
import { Card, Button, Input, Select, Badge, EmptyState, ConfirmDialog } from '@/components/ui'
// With:
import { Card, Button, Input, Select, Badge, EmptyState, ConfirmDialog, DateFilterPicker } from '@/components/ui'
```

```typescript
// Replace:
import { getMonthlySummary } from '@/services/transactions'
import { formatCurrency, getCurrentMonth, withTimeout } from '@/utils'
// With:
import { getSummary } from '@/services/transactions'
import { formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, getMonthsInRange, formatDateFilterLabel, type DateFilter } from '@/utils'
```

```typescript
// Replace:
const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
// With:
const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
```

- [ ] **Step 2: Rewrite `fetchBudgetData`**

```typescript
// Replace the whole function:
const fetchBudgetData = useCallback(async (filter: DateFilter) => {
  setLoading(true)
  setError(null)
  try {
    const { dateFrom, dateTo } = resolveDateFilter(filter)
    const months = filter.mode === 'month' ? [filter.month] : getMonthsInRange(dateFrom, dateTo)

    const [budgetsResults, summaryRes] = await withTimeout(
      Promise.all([
        Promise.all(months.map((m) => getBudgets(m))),
        getSummary({ dateFrom, dateTo }),
      ]),
      45000,
      'Budget data fetch'
    )

    for (const r of budgetsResults) {
      if (r.error) throw r.error
    }
    if (summaryRes.error) throw summaryRes.error

    // Merge same-category budgets across months (Custom mode can touch several).
    // A merged row's id/month are only meaningful when it maps to a single
    // month's row — the UI uses `monthCount` to decide whether delete applies.
    const merged = new Map<string, BudgetRow & { monthCount: number }>()
    budgetsResults.flat().forEach((rows) => {
      (rows || []).forEach((b) => {
        const existing = merged.get(b.category)
        if (existing) {
          existing.amount += Number(b.amount)
          existing.monthCount += 1
        } else {
          merged.set(b.category, { ...b, amount: Number(b.amount), monthCount: 1 })
        }
      })
    })
    setBudgets(Array.from(merged.values()))

    // Map category spent from summary breakdown
    const spent: Record<string, number> = {}
    if (summaryRes.data?.category_breakdown) {
      summaryRes.data.category_breakdown.forEach((item) => {
        spent[item.category] = item.amount
      })
    }
    setSpentMap(spent)
  } catch (err: any) {
    console.error('Error loading budget data:', err)
    setError(err.message || 'Failed to load budgets.')
  } finally {
    setLoading(false)
  }
}, [])
```

Note `budgetsResults` is `Array<{data: BudgetRow[] | null, error: ...}>` — `.flat()` above is called on `budgetsResults` directly which is an array of result objects, not arrays; fix by mapping first:

```typescript
    budgetsResults.forEach((r) => {
      (r.data || []).forEach((b) => {
        const existing = merged.get(b.category)
        if (existing) {
          existing.amount += Number(b.amount)
          existing.monthCount += 1
        } else {
          merged.set(b.category, { ...b, amount: Number(b.amount), monthCount: 1 })
        }
      })
    })
```

(Use this corrected version — replace the `budgetsResults.flat().forEach((rows) => { (rows || []).forEach(...) })` block above with this `budgetsResults.forEach((r) => { (r.data || []).forEach(...) })` block.)

`BudgetRow` needs the extra `monthCount` field reflected in the `budgets` state type:

```typescript
// Replace:
const [budgets, setBudgets] = useState<BudgetRow[]>([])
// With:
const [budgets, setBudgets] = useState<(BudgetRow & { monthCount: number })[]>([])
```

- [ ] **Step 3: Update the effect and every `fetchBudgetData(selectedMonth)` call site**

```typescript
// Replace:
useEffect(() => {
  document.title = 'Budgets | Intrack'
  fetchBudgetData(selectedMonth)
}, [selectedMonth, fetchBudgetData])
```

```typescript
// With:
useEffect(() => {
  document.title = 'Budgets | Intrack'
  fetchBudgetData(dateFilter)
}, [dateFilter, fetchBudgetData])
```

Do the same literal replacement (`fetchBudgetData(selectedMonth)` → `fetchBudgetData(dateFilter)`) at the two other call sites: inside `handleSubmit` (after `upsertBudget` succeeds) and inside `handleDelete` (after `deleteBudget` succeeds).

- [ ] **Step 4: Scope the add-budget form to a single target month**

The form still needs one concrete `month` to write to. Add a derived target month and use it in `handleSubmit`:

```typescript
// Add near the top of the component body, after the dateFilter state:
const targetMonth = dateFilter.mode === 'month' ? dateFilter.month : resolveDateFilter(dateFilter).dateTo.slice(0, 7)
```

```typescript
// Replace inside handleSubmit:
const { error } = await upsertBudget(category, Number(amount), selectedMonth)
// With:
const { error } = await upsertBudget(category, Number(amount), targetMonth)
```

Show which month the form is targeting, right above the Category Target field:

```typescript
// Inside the "Set Limit Target" Card, right after the <h2>, add:
{dateFilter.mode === 'custom' && (
  <p className="text-xs text-zinc-500 -mt-4 mb-5">
    Setting a limit for <span className="text-zinc-300 font-semibold">{formatDateFilterLabel({ mode: 'month', month: targetMonth })}</span>
  </p>
)}
```

- [ ] **Step 5: Replace the bespoke month navigator with `DateFilterPicker`**

Remove `handlePrevMonth`, `handleNextMonth`, and `formatMonthName` (no longer used — `DateFilterPicker` and `formatDateFilterLabel` cover this) and the whole "Month Navigator" `<div>` block (the one with the two ghost `Button`s and the `{formatMonthName(selectedMonth)}` span), replacing it with:

```typescript
<DateFilterPicker value={dateFilter} onChange={setDateFilter} />
```

- [ ] **Step 6: Update remaining `selectedMonth` references**

```typescript
// Replace:
const isCurrentMonth = selectedMonth === getCurrentMonth()
// With:
const isCurrentMonth = dateFilter.mode === 'month' && dateFilter.month === getCurrentMonth()
```

```typescript
// Replace the pace-projection block's month math:
const [selYear, selMon] = selectedMonth.split('-').map(Number)
const daysInSelectedMonth = new Date(selYear, selMon, 0).getDate()
// With:
const [selYear, selMon] = targetMonth.split('-').map(Number)
const daysInSelectedMonth = new Date(selYear, selMon, 0).getDate()
```

(This keeps the "at this pace" projection meaningful — it's inherently a single-month concept, so it anchors to `targetMonth`, same one the add-budget form uses.)

- [ ] **Step 7: Hide delete for multi-month merged rows**

```typescript
// Replace the delete Button's onClick/disabled:
<Button
  variant="ghost"
  size="sm"
  className="text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] h-8 w-8 p-0"
  onClick={() => setConfirmDeleteId(budget.id)}
  disabled={actionLoading}
  title="Delete budget"
>
  🗑️
</Button>
// With:
{budget.monthCount === 1 && (
  <Button
    variant="ghost"
    size="sm"
    className="text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] h-8 w-8 p-0"
    onClick={() => setConfirmDeleteId(budget.id)}
    disabled={actionLoading}
    title="Delete budget"
  >
    🗑️
  </Button>
)}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `BudgetsPage.tsx` (Analytics errors remain until Task 8)

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, open `/budgets`.
- Confirm month mode still works exactly as before (set a limit, see progress, delete it).
- Switch to Custom with a range inside the current month only — confirm delete still works (monthCount stays 1) and the "Setting a limit for..." note does NOT show a multi-month warning.
- Switch to Custom spanning two months that both have a budget set for the same category — confirm the category row shows the *combined* limit and spend, and its delete button is hidden.

- [ ] **Step 10: Commit**

```bash
git add src/pages/BudgetsPage.tsx
git commit -m "feat: wire DateFilterPicker into Budgets page with multi-month sum in Custom mode"
```

---

### Task 8: Wire into Analytics (Insights) page — Advisory section only

**Files:**
- Modify: `src/pages/AnalyticsPage.tsx`

Only the "CA Advisory" block (`monthlyTxns`/health-score/AI-insights) is in scope. The separate `PeriodSelector`/`RangeType` dropdown driving the Trend chart and Allocation breakdown is untouched.

- [ ] **Step 1: Update imports and state**

```typescript
// Replace:
import { getCurrentMonth, withTimeout } from '@/utils'
// With:
import { getCurrentMonth, withTimeout, resolveDateFilter, formatDateFilterLabel, type DateFilter } from '@/utils'
```

```typescript
import {
  AdherenceDiagnostic,
  BudgetVisualizer,
  AnomalyAlerts,
  AIInsights,
  ScenarioSimulator,
  ForecastPanel,
  TrendChart,
  ExpenseBreakdown,
  CreditCardPaymentTrend,
  SmartWealthTips,
  PeriodSelector,
  type RangeType
} from './analytics'
```

Add the `DateFilterPicker` import alongside the existing `Card` import:

```typescript
// Replace:
import { Card } from '@/components/ui'
// With:
import { Card, DateFilterPicker } from '@/components/ui'
```

```typescript
// Replace:
const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
// With:
const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
```

- [ ] **Step 2: Update the CA Advisory filter**

```typescript
// Replace:
const monthlyTxns = expenseTransactions.filter((t) => t.date && t.date.startsWith(selectedMonth))
// With:
const { dateFrom: advisoryFrom, dateTo: advisoryTo } = resolveDateFilter(dateFilter)
const monthlyTxns = expenseTransactions.filter((t) => t.date && t.date >= advisoryFrom && t.date <= advisoryTo)
```

- [ ] **Step 3: Update the AI-insights effect context**

```typescript
// Replace:
const ctx: FinancialContext = {
  month: selectedMonth,
  ...
}
// With:
const ctx: FinancialContext = {
  month: dateFilter.mode === 'month' ? dateFilter.month : formatDateFilterLabel(dateFilter),
  ...
}
```

```typescript
// Replace the effect's dependency array:
}, [loading, transactions.length, selectedMonth, showAdvanced])
// With:
}, [loading, transactions.length, dateFilter, showAdvanced])
```

(`FinancialContext.month` is typed `string` and only used for a human-readable label inside the AI prompt/rule-based fallback — passing the formatted range label there is a drop-in replacement, no type changes needed. Verify this assumption in Step 5 below before relying on it.)

- [ ] **Step 4: Replace the raw `<input type="month">` with `DateFilterPicker`**

```typescript
// Replace:
<div className="flex items-center gap-2">
  <span className="text-xs text-zinc-500">Advisory month:</span>
  <input
    type="month"
    value={selectedMonth}
    onChange={(e) => setSelectedMonth(e.target.value)}
    className="bg-surface-1 border border-border-subtle rounded-xl px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
  />
</div>
// With:
<div className="flex items-center gap-2">
  <span className="text-xs text-zinc-500">Advisory period:</span>
  <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
</div>
```

- [ ] **Step 5: Verify `FinancialContext.month` usage**

Before committing, run:

```bash
grep -n "month" src/services/aiService.ts | grep -i "context\|ctx\."
```

Confirm `FinancialContext.month` is only interpolated into prompt text / rule-based copy (not parsed as `YYYY-MM` anywhere) — if it IS parsed elsewhere (e.g. split on `-`), pass `dateFilter.mode === 'month' ? dateFilter.month : advisoryFrom` instead so it stays a valid `YYYY-MM`-shaped value for that call site, and use `formatDateFilterLabel(dateFilter)` only for display copy.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors anywhere in the project now

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open `/insights`, expand "Show advanced analysis".
- Confirm the health score / needs-wants-savings breakdown matches the current month, same as before.
- Switch "Advisory period" to Custom with a range spanning two months, confirm the advisory numbers recompute for that range and the AI insights card doesn't error.
- Confirm the Trend chart and category breakdown above (driven by the separate Range dropdown) are unaffected by this change.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AnalyticsPage.tsx
git commit -m "feat: wire DateFilterPicker into Insights advisory section"
```

---

### Task 9: Remove the now-unused `MonthPicker` component

**Files:**
- Delete: `src/components/ui/MonthPicker.tsx`

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "MonthPicker" src/`
Expected: no matches (the `ui/index.ts` export was already removed in Task 4, Step 2)

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/ui/MonthPicker.tsx
```

- [ ] **Step 3: Type-check and lint one more time**

Run: `npx tsc --noEmit -p .`
Expected: no errors

Run: `npx eslint src/`
Expected: no new errors (pre-existing unrelated warnings/errors in the codebase are fine, don't fix them here)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove MonthPicker, superseded by DateFilterPicker"
```

---

### Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `dateFilter.test.ts` and `getSummary` tests

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: builds successfully

- [ ] **Step 4: Manual smoke test across all four pages**

Run: `npm run dev`, log in, and for each of `/dashboard`, `/expenses`, `/budgets`, `/insights`:
- Confirm Month mode loads and behaves exactly as before this plan (prev/next arrows, current month on load).
- Confirm switching to Custom and picking a range updates the page's data.
- Confirm switching back to Month restores the previously-viewed month.

- [ ] **Step 5: No commit needed** — this task is verification-only. If any step fails, fix the specific page/task above and re-run this task's steps.
