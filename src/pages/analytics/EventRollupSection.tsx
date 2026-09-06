// ============================================
// EventRollupSection — Cross-Cutting Event & Trip Expense Rollup
// ============================================

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge, Button, Select, Skeleton } from '@/components/ui'
import { useCategories } from '@/context/CategoriesContext'
import { useDrillDown } from '@/context/DrillDownContext'
import { formatCurrency, formatDate, cn } from '@/utils'
import { Tag as TagIcon, Calendar, ArrowRight, Wallet, PieChart, ExternalLink, Sparkles } from 'lucide-react'

interface EventRollupSectionProps {
  transactions: any[]
  loading: boolean
  ccBillCategories?: string[]
}

interface CategorySpend {
  category: string
  amount: number
  count: number
  percentage: number
}

export default function EventRollupSection({
  transactions,
  loading,
  ccBillCategories = [],
}: EventRollupSectionProps) {
  const { getStyle } = useCategories()
  const { openDrillDown } = useDrillDown()

  // Find all distinct tags present on debit transactions
  const tagSummary = useMemo(() => {
    const map = new Map<string, { totalSpend: number; count: number; latestDate: string }>()

    transactions.forEach((t) => {
      // Exclude credit card bill payments and non-debits
      if (t.type !== 'debit' || ccBillCategories.includes(t.category)) return
      if (!Array.isArray(t.tags) || t.tags.length === 0) return

      t.tags.forEach((rawTag: string) => {
        const tag = (rawTag || '').trim()
        if (!tag) return

        const current = map.get(tag) || { totalSpend: 0, count: 0, latestDate: t.date }
        current.totalSpend += Number(t.amount || 0)
        current.count += 1
        if (t.date > current.latestDate) {
          current.latestDate = t.date
        }
        map.set(tag, current)
      })
    })

    // Sort tags by total spend descending
    return Array.from(map.entries()).map(([tag, data]) => ({
      tag,
      ...data,
    })).sort((a, b) => b.totalSpend - a.totalSpend)
  }, [transactions, ccBillCategories])

  const availableTags = useMemo(() => tagSummary.map((item) => item.tag), [tagSummary])

  // Selected tag state (default to highest spending tag)
  const [selectedTag, setSelectedTag] = useState<string>('')

  const activeTag = useMemo(() => {
    if (selectedTag && availableTags.includes(selectedTag)) return selectedTag
    return availableTags[0] || ''
  }, [selectedTag, availableTags])

  // All debit transactions for the selected tag
  const eventDebits = useMemo(() => {
    if (!activeTag) return []
    return transactions.filter(
      (t) =>
        t.type === 'debit' &&
        !ccBillCategories.includes(t.category) &&
        Array.isArray(t.tags) &&
        t.tags.includes(activeTag)
    )
  }, [transactions, activeTag, ccBillCategories])

  // Total period spend across ALL non-card-bill debits
  const totalPeriodExpenses = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'debit' && !ccBillCategories.includes(t.category))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0)
  }, [transactions, ccBillCategories])

  // Rollup calculations for active tag
  const eventMetrics = useMemo(() => {
    if (eventDebits.length === 0) {
      return {
        total: 0,
        count: 0,
        earliestDate: null,
        latestDate: null,
        pctOfTotal: 0,
        categoryBreakdown: [] as CategorySpend[],
      }
    }

    let total = 0
    let earliest = eventDebits[0].date
    let latest = eventDebits[0].date
    const catMap = new Map<string, { amount: number; count: number }>()

    eventDebits.forEach((t) => {
      const amt = Number(t.amount || 0)
      total += amt

      if (t.date < earliest) earliest = t.date
      if (t.date > latest) latest = t.date

      const current = catMap.get(t.category) || { amount: 0, count: 0 }
      current.amount += amt
      current.count += 1
      catMap.set(t.category, current)
    })

    const categoryBreakdown: CategorySpend[] = Array.from(catMap.entries())
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count,
        percentage: total > 0 ? (data.amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    const pctOfTotal = totalPeriodExpenses > 0 ? (total / totalPeriodExpenses) * 100 : 0

    return {
      total,
      count: eventDebits.length,
      earliestDate: earliest,
      latestDate: latest,
      pctOfTotal,
      categoryBreakdown,
    }
  }, [eventDebits, totalPeriodExpenses])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <Skeleton shape="line" className="h-6 w-48" />
          <Skeleton shape="block" className="h-40 w-full" />
        </div>
      </Card>
    )
  }

  // If no tagged events exist yet
  if (availableTags.length === 0) {
    return (
      <Card className="relative overflow-hidden p-6 border-sb-hairline bg-surface-1 shadow-card">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700"
            >
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-sb-ink">
                Event & Trip Expenses
              </h3>
              <p className="mt-1 text-xs text-sb-ink-muted leading-relaxed max-w-xl">
                Group spending across multiple categories for vacations, weddings, or home renovations. Add a tag like <span className="font-semibold text-brand-700">#Goa Trip 2026</span> or <span className="font-semibold text-brand-700">#Wedding</span> when logging expenses to unlock your automatic event rollup here.
              </p>
            </div>
          </div>
          <Link
            to="/expenses"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-sb-hairline bg-surface-2 px-3.5 text-xs font-semibold text-sb-ink shadow-xs hover:bg-surface-3 transition-colors shrink-0"
          >
            Go to Transactions
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6 border-sb-hairline bg-surface-1 shadow-card space-y-6">
      {/* Top Header & Tag Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-sb-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
            >
              <TagIcon className="h-4 w-4" />
            </span>
            <h3 className="text-lg font-bold text-sb-ink">
              Event & Trip Expenses
            </h3>
          </div>
          <p className="mt-1 text-xs text-sb-ink-muted">
            Aggregated cost breakdown across categories for tagged milestones and trips.
          </p>
        </div>

        {/* Tag Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="event-tag-select" className="sr-only">
            Select event or trip tag
          </label>
          <div className="w-56">
            <Select
              id="event-tag-select"
              value={activeTag}
              onChange={(e) => setSelectedTag(e.target.value)}
            >
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </Select>
          </div>
          <Link
            to="/expenses"
            state={{ tag: activeTag }}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-xl border border-sb-hairline bg-surface-2 px-3 text-xs font-semibold text-sb-ink-muted hover:text-sb-ink hover:bg-surface-3 transition-colors shrink-0"
            title="View all event transactions in ledger"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ledger</span>
          </Link>
        </div>
      </div>

      {/* Primary Event Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
            Total Event Spend
          </p>
          <p className="tnum mt-1 text-lg sm:text-xl font-extrabold text-sb-ink">
            {formatCurrency(eventMetrics.total)}
          </p>
          <p className="mt-0.5 text-[11px] text-sb-ink-muted">
            Across {eventMetrics.count} transactions
          </p>
        </div>

        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
            Share of Total Spend
          </p>
          <p className="tnum mt-1 text-lg sm:text-xl font-extrabold text-brand-700">
            {eventMetrics.pctOfTotal.toFixed(1)}%
          </p>
          <p className="mt-0.5 text-[11px] text-sb-ink-muted">
            of period's {formatCurrency(totalPeriodExpenses)}
          </p>
        </div>

        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
            Categories Involved
          </p>
          <p className="tnum mt-1 text-lg sm:text-xl font-extrabold text-sb-ink">
            {eventMetrics.categoryBreakdown.length}
          </p>
          <p className="mt-0.5 text-[11px] text-sb-ink-muted">
            categories split
          </p>
        </div>

        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
            Event Duration
          </p>
          <p className="tnum mt-1 text-xs sm:text-sm font-bold text-sb-ink truncate">
            {eventMetrics.earliestDate && eventMetrics.latestDate
              ? eventMetrics.earliestDate === eventMetrics.latestDate
                ? formatDate(eventMetrics.earliestDate)
                : `${formatDate(eventMetrics.earliestDate)} – ${formatDate(eventMetrics.latestDate)}`
              : 'N/A'}
          </p>
          <p className="mt-0.5 text-[11px] text-sb-ink-muted">
            Date range
          </p>
        </div>
      </div>

      {/* Proportional Spend Comparison Bar */}
      <div className="rounded-xl border border-sb-hairline bg-surface-2/20 p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-sb-ink">
            Event vs Total Spending ({eventMetrics.pctOfTotal.toFixed(1)}%)
          </span>
          <span className="tnum text-sb-ink-muted">
            {formatCurrency(eventMetrics.total)} of {formatCurrency(totalPeriodExpenses)}
          </span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, eventMetrics.pctOfTotal))}%` }}
          />
        </div>
        <p className="text-[11px] text-sb-ink-muted">
          This event accounts for <span className="font-semibold text-sb-ink">{eventMetrics.pctOfTotal.toFixed(1)}%</span> of your entire expense outflow in this period.
        </p>
      </div>

      {/* Category Breakdown & Key Ledger Rows */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Category Breakdown (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
              Where this money went by category
            </h4>
            <span className="text-[11px] text-sb-ink-muted">
              Click a row to drill down
            </span>
          </div>

          <div className="space-y-2">
            {eventMetrics.categoryBreakdown.map((cat) => {
              const meta = getStyle(cat.category)
              return (
                <div
                  key={cat.category}
                  onClick={() =>
                    openDrillDown(
                      { tag: activeTag, category: cat.category, type: 'debit' },
                      `#${activeTag} — ${cat.category}`
                    )
                  }
                  className="group flex flex-col gap-1.5 rounded-xl border border-sb-hairline bg-surface-1 p-3 transition-colors hover:border-brand-500/40 hover:bg-surface-2/50 cursor-pointer shadow-2xs"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm shrink-0">{meta.emoji}</span>
                      <span className="truncate font-semibold text-sb-ink group-hover:text-brand-700">
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-sb-ink-muted">
                        ({cat.count} txn{cat.count === 1 ? '' : 's'})
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="tnum font-bold text-sb-ink">
                        {formatCurrency(cat.amount)}
                      </span>
                      <span className="tnum ml-1.5 text-[11px] font-semibold text-brand-700">
                        {cat.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full bg-brand-500/80 rounded-full transition-all duration-300 group-hover:bg-brand-500"
                      style={{ width: `${Math.min(100, Math.max(2, cat.percentage))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Transactions in this Event (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
              Recent Transactions
            </h4>
            <Link
              to="/expenses"
              state={{ tag: activeTag }}
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors inline-flex items-center gap-0.5"
            >
              All {eventDebits.length}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="space-y-2">
            {eventDebits.slice(0, 5).map((txn) => {
              const meta = getStyle(txn.category)
              return (
                <div
                  key={txn.id}
                  onClick={() =>
                    openDrillDown(
                      { tag: activeTag, type: 'debit' },
                      `#${activeTag} Transactions`
                    )
                  }
                  className="flex items-center justify-between gap-3 rounded-xl border border-sb-hairline bg-surface-1 p-3 text-xs shadow-2xs hover:border-brand-500/40 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-sb-ink">
                      {txn.merchant || txn.description || 'Expense'}
                    </p>
                    <p className="text-[11px] text-sb-ink-muted mt-0.5">
                      {formatDate(txn.date)} · {meta.emoji} {meta.label}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="tnum font-bold text-sb-ink">
                      {formatCurrency(Number(txn.amount))}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}
