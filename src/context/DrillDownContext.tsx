// src/context/DrillDownContext.tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { resolveTransactionIdentity } from '@/utils'

export interface DrillDownFilter {
  category?: string
  /** Match any category in this list instead of a single one — e.g. Budget Visualizer's "Needs" bucket spans several categories via the analytics_tags system. Takes precedence over `category` if both happen to be set. */
  categories?: string[]
  /** Match on merchant instead of/in addition to category — e.g. Merchant Leaderboard drills by merchant. Compared against `resolveTransactionIdentity(t).title`, NOT the raw `merchant` column, because that is how every producer of this filter groups its rows. */
  merchant?: string
  /** Rows in any of these categories are dropped. Used by the date-only drill-downs, whose numbers were built from a pool that already excluded credit-card bill payments. */
  excludeCategories?: string[]
  /** When set, a CREDIT row is kept only if its category is in this list. Debit rows are untouched. Mirrors the page's one definition of income, so a list opened from an income bar cannot show credits the bar never counted. */
  incomeCategories?: string[]
  type?: 'debit' | 'credit'
  /** YYYY-MM-DD. Takes precedence over `month` when both are set — matches getTransactions()'s own precedence in src/services/transactions.ts. */
  dateFrom?: string
  /** YYYY-MM-DD */
  dateTo?: string
  /** YYYY-MM — ignored if dateFrom/dateTo are given */
  month?: string
}

/** Pure filter matcher, shared by any drill-down-capable chart. */
export function filterTransactionsForDrillDown<T extends { category: string; date: string; merchant?: string | null; description?: string | null }>(
  transactions: T[],
  filter: DrillDownFilter
): T[] {
  return transactions.filter((t) => {
    if (filter.excludeCategories?.includes(t.category)) return false
    if (
      filter.incomeCategories &&
      (t as { type?: string }).type === 'credit' &&
      !filter.incomeCategories.includes(t.category)
    ) {
      return false
    }
    if (filter.categories) {
      if (!filter.categories.includes(t.category)) return false
    } else if (filter.category && t.category !== filter.category) {
      return false
    }
    // Resolved identity, not the raw column. The Merchant Leaderboard groups by
    // `resolveTransactionIdentity(t).title` — which reads the merchant column,
    // falls back to a brand recognised inside the narration, and otherwise
    // collapses to 'Unclassified'. Comparing the raw column here meant a bar
    // reading 500 opened a list totalling 200, and the 'Unclassified' bar
    // opened an empty list every single time.
    if (filter.merchant && resolveTransactionIdentity(t).title !== filter.merchant) return false
    if (filter.type && (t as { type?: string }).type !== filter.type) return false
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
