// ============================================
// BudgetsPage — Category Budget Management
// Set monthly limits and monitor spending limits
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
import { Card, Button, Input, Select, Badge, EmptyState, ConfirmDialog, DateFilterPicker } from '@/components/ui'
import { getBudgets, upsertBudget, deleteBudget } from '@/services/budgets'
import { getSummary } from '@/services/transactions'
import { formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, getMonthsInRange, formatDateFilterLabel, creditCardBillCategoryNames, type DateFilter } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import type { Database } from '@/types/database'
import { useToast, useAuth } from '@/context'

type BudgetRow = Database['public']['Tables']['budgets']['Row']

export default function BudgetsPage() {
  const { currencySymbol } = useAuth()
  const { categories, getStyle, loading: categoriesLoading } = useCategories()
  // See DashboardPage for why this is undefined rather than [] while loading.
  const ccBillCategories = useMemo(
    () => (categoriesLoading ? undefined : creditCardBillCategoryNames(categories)),
    [categories, categoriesLoading]
  )
  const budgetEligible = categories.filter((c) => c.type === 'expense' && c.budget_eligible)
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
  const targetMonth = dateFilter.mode === 'month' ? dateFilter.month : resolveDateFilter(dateFilter).dateTo.slice(0, 7)
  // Each merged entry keeps the source rows (id + month), not just ids: deleting
  // needs the month so the service can tombstone a current-month budget rather
  // than remove it, which is what stops carry-forward resurrecting it.
  type BudgetSource = { id: string; month: string }
  const [budgets, setBudgets] = useState<(BudgetRow & { monthCount: number; rows: BudgetSource[] })[]>([])
  const [spentMap, setSpentMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ rows: BudgetSource[]; categoryLabel: string; monthCount: number } | null>(null)
  const { showToast } = useToast()

  // Form states
  const [category, setCategory] = useState(budgetEligible[0]?.name ?? '')
  const [amount, setAmount] = useState('')

  // Categories load asynchronously — once the eligible list arrives, default
  // the picker to its first entry if nothing has been selected yet.
  useEffect(() => {
    if (!category && budgetEligible.length > 0) {
      setCategory(budgetEligible[0].name)
    }
  }, [budgetEligible, category])

  const fetchBudgetData = useCallback(async (filter: DateFilter) => {
    setLoading(true)
    setError(null)
    try {
      const { dateFrom, dateTo } = resolveDateFilter(filter)
      const months = filter.mode === 'month' ? [filter.month] : getMonthsInRange(dateFrom, dateTo)

      const [budgetsResults, summaryRes] = await withTimeout(
        Promise.all([
          Promise.all(months.map((m) => getBudgets(m))),
          getSummary({ dateFrom, dateTo }, { creditCardBillCategories: ccBillCategories }),
        ]),
        45000,
        'Budget data fetch'
      )

      for (const r of budgetsResults) {
        if (r.error) throw r.error
      }
      if (summaryRes.error) throw summaryRes.error

      // Merge same-category budgets across months (Custom mode can touch several).
      const merged = new Map<string, BudgetRow & { monthCount: number; rows: BudgetSource[] }>()
      budgetsResults.forEach((r) => {
        (r.data || []).forEach((b) => {
          const existing = merged.get(b.category)
          if (existing) {
            existing.amount += Number(b.amount)
            existing.monthCount += 1
            existing.rows.push({ id: b.id, month: b.month })
          } else {
            merged.set(b.category, { ...b, amount: Number(b.amount), monthCount: 1, rows: [{ id: b.id, month: b.month }] })
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
  }, [ccBillCategories])

  useEffect(() => {
    document.title = `Budgets | ${APP_CONFIG.APP_NAME}`
    fetchBudgetData(dateFilter)
  }, [dateFilter, fetchBudgetData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!category || !amount || Number(amount) <= 0) return

    setActionLoading(true)
    setError(null)
    try {
      const { error } = await upsertBudget(category, Number(amount), targetMonth)
      if (error) throw error

      setAmount('')
      showToast('Limit set successfully')
      await fetchBudgetData(dateFilter)
    } catch (err: any) {
      console.error('Error saving budget:', err)
      setError(err.message || 'Failed to save budget.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async (targetRows: BudgetSource[]) => {
    setActionLoading(true)
    setError(null)
    try {
      for (const row of targetRows) {
        // The month goes with the id: a current-month removal is recorded as a
        // deliberate deletion so month-to-month carry-forward leaves it alone.
        const { error } = await deleteBudget(row.id, { month: row.month })
        if (error) throw error
      }
      showToast('Limit removed successfully')
      await fetchBudgetData(dateFilter)
    } catch (err: any) {
      console.error('Error deleting budget:', err)
      setError(err.message || 'Failed to delete budget.')
    } finally {
      setActionLoading(false)
    }
  }

  // Calculate totals
  const totalBudgeted = budgets.reduce((sum, b) => sum + Number(b.amount), 0)
  const totalSpent = budgets.reduce((sum, b) => sum + (spentMap[b.category] || 0), 0)
  const remainingBudget = totalBudgeted - totalSpent

  const warningBudgets = budgets.filter((b) => {
    const spent = spentMap[b.category] || 0
    return spent >= b.amount * 0.7
  })

  // Under-budget deserves the same visual weight as a warning — an app that
  // only speaks up when you overspend trains people to avoid opening it.
  const isCurrentMonth = dateFilter.mode === 'month' && dateFilter.month === getCurrentMonth()
  const allOnTrack = budgets.length > 0 && warningBudgets.length === 0

  // Loss-framed pace projection: "at this rate, you'll end the month over
  // budget" lands harder mid-month than a static percentage-used bar.
  const today = new Date()
  const [selYear, selMon] = targetMonth.split('-').map(Number)
  const daysInSelectedMonth = new Date(selYear, selMon, 0).getDate()
  const daysElapsed = isCurrentMonth ? today.getDate() : daysInSelectedMonth
  const projectPace = (spent: number) =>
    daysElapsed > 0 ? (spent / daysElapsed) * daysInSelectedMonth : spent

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Budgets</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Set per-category monthly limits and get overspend warnings before they happen.
              Limits you set carry over to the next month on their own — set them once.
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

        {error && (
          <div className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        {/* Positive reinforcement — same visual weight as the warning banner
            below, shown only when every budget is genuinely on track. */}
        {allOnTrack && (
          <div className="rounded-2xl border p-4 text-xs font-semibold leading-relaxed flex items-center gap-3 animate-fade-in bg-[var(--status-positive-subtle)] border-[var(--status-positive-border)] text-[var(--status-positive-text)]">
            <span className="text-base select-none">✅</span>
            <span>
              Nice — all {budgets.length} budget{budgets.length === 1 ? '' : 's'} on track this month, {formatCurrency(remainingBudget)} left overall.
            </span>
          </div>
        )}

        {/* Dynamic Budget Warnings / Exceeded Banners */}
        {warningBudgets.length > 0 && (
          <div className="space-y-2">
            {warningBudgets.map((b) => {
              const spent = spentMap[b.category] || 0
              const isExceeded = spent >= b.amount
              const cat = getStyle(b.category)
              return (
                <div
                  key={b.id}
                  className={`rounded-2xl border p-4 text-xs font-semibold leading-relaxed flex items-center gap-3 animate-fade-in ${
                    isExceeded
                      ? 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]'
                      : 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]'
                  }`}
                >
                  <span className="text-base select-none">{isExceeded ? '⚠️' : '🔔'}</span>
                  <span>
                    {isExceeded
                      ? `Budget Exceeded: Your expenses in ${cat.emoji} ${cat.label} (${formatCurrency(spent)}) have exceeded your established limit of ${formatCurrency(b.amount)}!`
                      : `Budget Limit Reached: Your expenses in ${cat.emoji} ${cat.label} (${formatCurrency(spent)}) have reached ${Math.round((spent / b.amount) * 100)}% of your established limit of ${formatCurrency(b.amount)}.`}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Budget summary metrics */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Total Budgeted
            </p>
            <p className="mt-1.5 text-2xl font-bold text-white">
              {formatCurrency(totalBudgeted)}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Sum of active limit caps</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-medium">
              Spent in Budgeted
            </p>
            <p className="mt-1.5 text-2xl font-bold text-[var(--status-warning-text)]">
              {formatCurrency(totalSpent)}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Expenses in budgeted categories</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Remaining Balance
            </p>
            <p
              className={`mt-1.5 text-2xl font-bold ${
                remainingBudget >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'
              }`}
            >
              {formatCurrency(remainingBudget)}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {remainingBudget >= 0 ? 'Within budget limit' : 'Limit exceeded!'}
            </p>
          </Card>
        </div>

        {/* Layout details split */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left column: budgets list */}
          <Card className="lg:col-span-8 flex flex-col h-auto">
            <h2 className="text-lg font-bold text-white mb-6">Limits Overview</h2>

            <div className="flex-1 flex flex-col justify-center">
              {loading ? (
                // Skeletons
                <div className="space-y-6">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between">
                        <div className="skeleton h-4 w-1/3" />
                        <div className="skeleton h-4 w-20" />
                      </div>
                      <div className="skeleton h-2 w-full" />
                    </div>
                  ))}
                </div>
              ) : budgets.length === 0 ? (
                <EmptyState
                  icon="🛡️"
                  title="No limits set"
                  description="Establish spending targets to keep your personal wealth secure."
                />
              ) : (
                <div className="space-y-6">
                  {budgets.map((budget, idx) => {
                    const cat = getStyle(budget.category)
                    const spent = spentMap[budget.category] || 0
                    const remaining = budget.amount - spent
                    const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0

                    // Dynamic colors for safety status
                    let progressColor = cat.color
                    if (pct >= 90) {
                      progressColor = '#ef4444' // Red alert
                    } else if (pct >= 70) {
                      progressColor = '#f59e0b' // Amber caution
                    }

                    return (
                      <div
                        key={budget.id}
                        className="space-y-2 border-b border-border-subtle/50 pb-5 last:border-0 last:pb-0 animate-slide-up"
                        style={{ animationDelay: `${idx * 0.05}s` }}
                      >
                        {/* Upper row: Emoji + Category details */}
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
                              style={{ backgroundColor: `${cat.color}15` }}
                            >
                              {cat.emoji}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-zinc-200">
                                  {cat.label}
                                </h3>
                                {pct >= 100 ? (
                                  <Badge variant="danger">Exceeded</Badge>
                                ) : pct >= 70 ? (
                                  <Badge variant="warning">Warning</Badge>
                                ) : (
                                  <Badge variant="success">Safe</Badge>
                                )}
                              </div>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                Limit: <span className="text-zinc-400 font-medium">{formatCurrency(budget.amount)}</span>
                              </p>
                            </div>
                          </div>

                          {/* Spent & delete action */}
                          <div className="flex items-center gap-4 w-full sm:w-auto sm:justify-end">
                            <div className="text-right">
                              <p className="text-sm font-bold text-zinc-200">
                                {formatCurrency(spent)} <span className="text-xs font-normal text-zinc-500">spent</span>
                              </p>
                              <p
                                className={`text-xs mt-0.5 font-medium ${
                                  remaining >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'
                                }`}
                              >
                                {remaining >= 0
                                  ? `${formatCurrency(remaining)} remaining`
                                  : `${formatCurrency(Math.abs(remaining))} overspent!`}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] h-11 w-11 p-0 shrink-0"
                              onClick={() => setDeleteTarget({ rows: budget.rows ?? [{ id: budget.id, month: budget.month }], categoryLabel: cat.label, monthCount: budget.monthCount })}
                              disabled={actionLoading}
                              title={budget.monthCount > 1 ? `Delete limit across ${budget.monthCount} months` : 'Delete budget limit'}
                            >
                              🗑️
                            </Button>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="relative space-y-1">
                          <div className="h-2 w-full bg-surface-3 rounded-full overflow-hidden flex">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ease-out ${pct < 70 ? 'aurora-progress-fill' : ''}`}
                              style={{
                                width: `${Math.min(100, pct)}%`,
                                ...(pct >= 70 ? { backgroundColor: progressColor } : {}),
                              }}
                            />
                          </div>
                          {pct > 100 && (
                            <p className="text-[10px] text-[var(--status-danger-text)] font-bold text-right">
                              ⚠️ {Math.round(pct - 100)}% over established cap
                            </p>
                          )}
                        </div>

                        {/* Pace projection — requires at least 4 days elapsed mid-month to avoid Day 1-3 false alarms */}
                        {isCurrentMonth && daysElapsed >= 4 && pct < 100 && (() => {
                          const projected = projectPace(spent)
                          const projectedOver = projected - budget.amount
                          if (projectedOver <= 0) return null
                          return (
                            <p className="text-[11px] text-[var(--status-warning-text)] font-medium flex items-center gap-1">
                              <span aria-hidden="true">📉</span>
                              At this pace, ends the month {formatCurrency(projectedOver)} over budget.
                            </p>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Right column: Form to add/update */}
          <Card className="lg:col-span-4 self-start">
            <h2 className="text-lg font-bold text-white mb-6">Set Limit Target</h2>
            {dateFilter.mode === 'custom' && (
              <p className="text-xs text-zinc-500 -mt-4 mb-5">
                Setting a limit for <span className="text-zinc-300 font-semibold">{formatDateFilterLabel({ mode: 'month', month: targetMonth })}</span>
              </p>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Category Target
                </label>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={actionLoading}
                  required
                >
                  {budgetEligible.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Limit Amount ({currencySymbol})
                </label>
                <Input
                  type="number"
                  placeholder="5000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={actionLoading}
                  min="1"
                  required
                />
              </div>

              <Button type="submit" block loading={actionLoading} disabled={actionLoading}>
                Set Limit
              </Button>
            </form>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await handleDelete(deleteTarget.rows)
          setDeleteTarget(null)
        }}
        title="Remove budget limit"
        message={
          deleteTarget && deleteTarget.monthCount > 1
            ? `Remove the budget limit for ${deleteTarget.categoryLabel} across all ${deleteTarget.monthCount} months in this view?`
            : `Remove the budget limit for ${deleteTarget?.categoryLabel || 'this category'}? It won't carry into next month. You can set a new one anytime.`
        }
        confirmLabel="Remove"
      />
    </AppLayout>
  )
}
