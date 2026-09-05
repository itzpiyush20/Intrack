// ============================================
// BudgetsPage — per-category monthly limits
//
// Restyle and recompose only. The merge across months, the carry-forward
// tombstone on delete, the pace projection and every service call behave
// exactly as before.
//
// What changed is legibility. The page used to speak in emoji and bold
// sentences ("Budget Exceeded: Your expenses in 🍔 Food have exceeded your
// established limit!") and set money in proportional figures that never lined
// up. Now every amount is `.tnum` and right-aligned in a column of its own,
// every status carries an icon and a word as well as a colour, and the alert
// copy says the number rather than shouting about it.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
import {
  Card, Button, Input, Select, Badge, EmptyState, ConfirmDialog, DateFilterPicker,
  Skeleton, SECTION_LABEL, ACTION_BUTTON_DANGER, transition, rowVariants, staggerParent, staggerChild,
} from '@/components/ui'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { getBudgets, upsertBudget, deleteBudget } from '@/services/budgets'
import { getSummary } from '@/services/transactions'
import { cn, formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, getMonthsInRange, formatDateFilterLabel, creditCardBillCategoryNames, type DateFilter } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import type { Database } from '@/types/database'
import { useToast, useAuth } from '@/context'
import {
  AlertTriangle, AlertCircle, CheckCircle2, Bell, Trash2, TrendingDown,
  ArrowRight, Target, Wallet, PiggyBank,
} from 'lucide-react'

type BudgetRow = Database['public']['Tables']['budgets']['Row']

export default function BudgetsPage() {
  const { currencySymbol } = useAuth()
  const reduceMotion = useReducedMotion()
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

  const summaryCards = [
    {
      key: 'budgeted',
      label: 'Budgeted',
      value: totalBudgeted,
      icon: Target,
      tone: 'text-zinc-50',
      note: 'Every limit you have set, added up',
    },
    {
      key: 'spent',
      label: 'Spent against it',
      value: totalSpent,
      icon: Wallet,
      tone: 'text-zinc-50',
      note: 'Only spending in categories you budgeted',
    },
    {
      key: 'remaining',
      label: remainingBudget >= 0 ? 'Still available' : 'Over by',
      value: Math.abs(remainingBudget),
      icon: PiggyBank,
      tone: remainingBudget >= 0
        ? 'text-[var(--status-positive-text)]'
        : 'text-[var(--status-danger-text)]',
      note: remainingBudget >= 0 ? 'Left before you hit your limits' : 'Spent past your limits',
    },
  ] as const

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">Budgets</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Set a monthly limit per category and Intrack warns you before you pass it. A limit
              carries into next month on its own — set it once.
            </p>
          </div>

          <div className="md:shrink-0">
            <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-4 text-sm text-[var(--status-danger-text)]"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Where each budget stands. Under budget is reported as loudly as over
            budget — an app that only ever speaks up to scold you is an app
            people stop opening. */}
        {allOnTrack && (
          <p className="flex items-start gap-2.5 rounded-2xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-4 text-sm leading-relaxed text-[var(--status-positive-text)]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              All {budgets.length} budget{budgets.length === 1 ? '' : 's'} on track, with{' '}
              <strong className="tnum font-semibold">{formatCurrency(remainingBudget)}</strong> left
              across them.
            </span>
          </p>
        )}

        {warningBudgets.length > 0 && (
          <ul className="space-y-2">
            {warningBudgets.map((b) => {
              const spent = spentMap[b.category] || 0
              const isExceeded = spent >= b.amount
              const cat = getStyle(b.category)
              const Icon = isExceeded ? AlertTriangle : Bell
              return (
                <li
                  key={b.id}
                  className={cn(
                    'flex items-start gap-2.5 rounded-2xl border p-4 text-sm leading-relaxed',
                    isExceeded
                      ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)]'
                      : 'border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)]'
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {isExceeded ? (
                      <>
                        <strong className="font-semibold">{cat.label}</strong> is over its limit —{' '}
                        <strong className="tnum font-semibold">{formatCurrency(spent)}</strong> spent
                        against <span className="tnum">{formatCurrency(b.amount)}</span>.
                      </>
                    ) : (
                      <>
                        <strong className="font-semibold">{cat.label}</strong> is at{' '}
                        <strong className="tnum font-semibold">
                          {Math.round((spent / b.amount) * 100)}%
                        </strong>{' '}
                        of its limit — <span className="tnum">{formatCurrency(spent)}</span> of{' '}
                        <span className="tnum">{formatCurrency(b.amount)}</span>.
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {/* The three figures for the whole range */}
        <motion.div
          className="grid gap-3 sm:grid-cols-3"
          variants={staggerParent(reduceMotion, 3)}
          initial="initial"
          animate="animate"
        >
          {summaryCards.map(({ key, label, value, icon: Icon, tone, note }) => (
            <motion.div key={key} variants={staggerChild(reduceMotion)}>
              <Card className="h-full p-4 sm:p-5">
                <p className={SECTION_LABEL}>{label}</p>
                <p className={cn('mt-2 flex items-center gap-1.5 text-2xl font-semibold tracking-tight tnum', tone)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {formatCurrency(value)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{note}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left column: the limits themselves */}
          <Card className="lg:col-span-8">
            <h2 className="text-base font-semibold tracking-tight text-zinc-50">Your limits</h2>
            <p className="mt-1 text-xs text-zinc-400">
              {formatDateFilterLabel(dateFilter)}
            </p>

            <div className="mt-5">
              {loading ? (
                <ul role="status" aria-label="Loading your budgets" className="space-y-5">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="space-y-2.5">
                      <div className="flex items-center gap-3">
                        <Skeleton shape="block" className="h-10 w-10 shrink-0 rounded-xl" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-32 max-w-full" />
                          <Skeleton className="h-3 w-24 max-w-full" />
                        </div>
                        <div className="hidden w-32 space-y-1.5 sm:block">
                          <Skeleton className="ml-auto h-4 w-24" />
                          <Skeleton className="ml-auto h-3 w-20" />
                        </div>
                      </div>
                      <Skeleton className="h-2 w-full rounded-full" />
                    </li>
                  ))}
                </ul>
              ) : budgets.length === 0 ? (
                <EmptyState
                  icon="🎯"
                  title="No limits set yet"
                  description="Pick a category and a monthly cap to start. Intrack tells you where you stand as the month goes on, and warns you before you pass it."
                />
              ) : (
                <motion.ul
                  className="divide-y divide-border-subtle"
                  variants={staggerParent(reduceMotion, budgets.length)}
                  initial="initial"
                  animate="animate"
                >
                  <AnimatePresence initial={false}>
                    {budgets.map((budget) => {
                      const cat = getStyle(budget.category)
                      const spent = spentMap[budget.category] || 0
                      const remaining = budget.amount - spent
                      const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0

                      // The bar agrees with the badge beside it. It used to turn
                      // red at 90% while the badge still read "Warning", which
                      // asked the user to reconcile two different verdicts on
                      // the same number.
                      const barColor =
                        pct >= 100 ? 'var(--status-danger-text)'
                        : pct >= 70 ? 'var(--status-warning-text)'
                        : 'var(--brand-500)'

                      const projected = projectPace(spent)
                      const projectedOver = projected - budget.amount
                      const showPace = isCurrentMonth && daysElapsed >= 4 && pct < 100 && projectedOver > 0

                      return (
                        <motion.li
                          key={budget.id}
                          layout={!reduceMotion}
                          variants={rowVariants(reduceMotion)}
                          exit="exit"
                          transition={transition(reduceMotion)}
                          className="space-y-3 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <span
                                aria-hidden="true"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
                                style={{ backgroundColor: `${cat.color}15` }}
                              >
                                {cat.emoji}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <h3 className="truncate text-sm font-semibold text-zinc-100">
                                    {cat.label}
                                  </h3>
                                  {/* Icon and word, so the verdict never rests
                                      on the badge's colour alone. */}
                                  {pct >= 100 ? (
                                    <Badge variant="danger">
                                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      Over limit
                                    </Badge>
                                  ) : pct >= 70 ? (
                                    <Badge variant="warning">
                                      <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      Close
                                    </Badge>
                                  ) : (
                                    <Badge variant="success">
                                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      On track
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-zinc-400">
                                  Limit <span className="tnum font-medium text-zinc-300">{formatCurrency(budget.amount)}</span>
                                  {budget.monthCount > 1 && (
                                    <span> · across {budget.monthCount} months</span>
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Fixed-width figures column so the amounts read
                                straight down the list instead of drifting with
                                the length of each category name. */}
                            <div className="flex items-start justify-between gap-3 sm:justify-end">
                              <div className="min-w-0 sm:w-40 sm:text-right">
                                <p className="tnum text-sm font-semibold text-zinc-100">
                                  {formatCurrency(spent)}{' '}
                                  <span className="text-xs font-normal text-zinc-400">spent</span>
                                </p>
                                <p
                                  className={cn(
                                    'tnum mt-0.5 text-xs font-medium',
                                    remaining >= 0
                                      ? 'text-[var(--status-positive-text)]'
                                      : 'text-[var(--status-danger-text)]'
                                  )}
                                >
                                  {remaining >= 0
                                    ? `${formatCurrency(remaining)} left`
                                    : `${formatCurrency(Math.abs(remaining))} over`}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({
                                  rows: budget.rows ?? [{ id: budget.id, month: budget.month }],
                                  categoryLabel: cat.label,
                                  monthCount: budget.monthCount,
                                })}
                                disabled={actionLoading}
                                aria-label={`Remove the ${cat.label} limit`}
                                title={budget.monthCount > 1
                                  ? `Remove this limit across ${budget.monthCount} months`
                                  : 'Remove this limit'}
                                className={cn(ACTION_BUTTON_DANGER, 'h-11 w-11 shrink-0 sm:h-9 sm:w-9 disabled:opacity-50')}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(Math.min(100, pct))}
                            aria-label={`${cat.label}: ${Math.round(pct)}% of the limit spent`}
                            className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
                          >
                            <div
                              className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                              style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
                            />
                          </div>

                          {pct > 100 && (
                            <p className="tnum text-right text-xs font-medium text-[var(--status-danger-text)]">
                              {Math.round(pct - 100)}% past the limit
                            </p>
                          )}

                          {/* Pace projection — needs at least 4 days elapsed so
                              a single big buy on the 2nd does not raise an alarm. */}
                          {showPace && (
                            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--status-warning-text)]">
                              <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>
                                At this pace it ends the month{' '}
                                <span className="tnum">{formatCurrency(projectedOver)}</span> over.
                              </span>
                            </p>
                          )}
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          </Card>

          {/* Right column: set or update a limit. Sticky from lg so it stays
              reachable beside a long list, the way the Settings rail does. */}
          <Card className="self-start lg:col-span-4 lg:sticky lg:top-20">
            <h2 className="text-base font-semibold tracking-tight text-zinc-50">Set a limit</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Setting a limit for a category that already has one replaces it.
              {dateFilter.mode === 'custom' && (
                <>
                  {' '}Applies to{' '}
                  <span className="font-medium text-zinc-300">
                    {formatDateFilterLabel({ mode: 'month', month: targetMonth })}
                  </span>.
                </>
              )}
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <Select
                label="Category"
                id="budget-category"
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

              <Input
                label={`Monthly limit (${currencySymbol})`}
                id="budget-amount"
                type="number"
                inputMode="decimal"
                placeholder="5000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={actionLoading}
                min="1"
                className="tnum"
                required
              />

              <Button type="submit" block loading={actionLoading} disabled={actionLoading} className="h-11">
                Save limit
              </Button>
            </form>

            <Link
              to="/insights"
              className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-2/50 px-3.5 py-3 text-sm text-zinc-400 transition-colors hover:border-border-hover hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <span>See where the money actually went</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
            </Link>
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
        title="Remove this limit?"
        message={
          deleteTarget && deleteTarget.monthCount > 1
            ? `The ${deleteTarget.categoryLabel} limit will be removed from all ${deleteTarget.monthCount} months in this view. Your transactions are untouched, and you can set a new limit any time.`
            : `The ${deleteTarget?.categoryLabel || 'category'} limit will be removed and will not carry into next month. Your transactions are untouched, and you can set a new limit any time.`
        }
        confirmLabel="Remove limit"
      />
    </AppLayout>
  )
}
