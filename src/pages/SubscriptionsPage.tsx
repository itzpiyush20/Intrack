// ============================================
// SubscriptionsPage — Planned Payments Command Center
// Tracks recurring commitments (Rent, Utilities, EMIs, Subscriptions)
// based on user-designated categories. Zero algorithmic guessing.
// ============================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import AppLayout from '@/layouts/AppLayout'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Card,
  Button,
  Badge,
  Input,
  Skeleton,
  rowVariants,
  transition,
} from '@/components/ui'
import {
  Calendar,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Pencil,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CreditCard,
  Building2,
  Zap,
  Sparkles,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react'
import { APP_CONFIG } from '@/constants'
import { formatCurrency, formatDate, cn } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import { fetchAllTransactions } from '@/services/transactions'
import {
  evaluateMonthlyPlannedPayments,
  isPlannedCategory,
  savePlannedCategorySchedule,
  type EvaluatedPlannedPayment,
} from '@/services/plannedPayments'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import RecordPlannedPaymentModal from '@/components/subscriptions/RecordPlannedPaymentModal'
import EditPlannedScheduleModal from '@/components/subscriptions/EditPlannedScheduleModal'
import CategoryFormModal from '@/components/settings/CategoryFormModal'
import type { Database } from '@/types/database'
import type { Category } from '@/types'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

type HorizonFilter = 'all' | '7_days' | '15_days' | 'cleared'

export default function SubscriptionsPage() {
  const { user, currencySymbol } = useAuth()
  const { categories, getStyle, refresh: refreshCategories } = useCategories()
  const reduce = useReducedMotion()

  // Selected Month State (defaults to current month)
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const year = currentDate.getFullYear()
  const monthIndex = currentDate.getMonth()

  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Filter states
  const [horizon, setHorizon] = useState<HorizonFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modals state
  const [recordingItem, setRecordingItem] = useState<EvaluatedPlannedPayment | null>(null)
  const [editingScheduleItem, setEditingScheduleItem] = useState<EvaluatedPlannedPayment | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [initialPlannedPaymentForModal, setInitialPlannedPaymentForModal] = useState(true)

  // Fetch transactions for the current month
  const fetchMonthData = useCallback(async () => {
    setLoading(true)
    try {
      const dateFrom = toISODateLocal(new Date(year, monthIndex, 1))
      const dateTo = toISODateLocal(new Date(year, monthIndex + 1, 0))

      const { data, error } = await fetchAllTransactions({
        dateFrom,
        dateTo,
        type: 'debit',
      })

      if (error) {
        console.error('Failed to fetch month transactions:', error)
      } else {
        setTransactions(data || [])
      }
    } catch (e) {
      console.error('Error loading month transactions:', e)
    } finally {
      setLoading(false)
    }
  }, [year, monthIndex])

  useEffect(() => {
    document.title = `Planned Payments | ${APP_CONFIG.APP_NAME}`
    fetchMonthData()
  }, [fetchMonthData])

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const handleResetToCurrentMonth = () => {
    setCurrentDate(new Date())
  }

  const isCurrentCalendarMonth = useMemo(() => {
    const now = new Date()
    return now.getFullYear() === year && now.getMonth() === monthIndex
  }, [year, monthIndex])

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
      new Date(year, monthIndex, 1)
    )
  }, [year, monthIndex])

  // Filter planned categories
  const plannedCategories = useMemo(() => {
    return categories.filter(isPlannedCategory)
  }, [categories])

  // Evaluate planned payments for this month
  const evaluation = useMemo(() => {
    return evaluateMonthlyPlannedPayments({
      categories,
      monthTransactions: transactions,
      year,
      monthIndex,
      userId: user?.id,
    })
  }, [categories, transactions, year, monthIndex, user?.id])

  // Horizon & search filtered items
  const filteredItems = useMemo(() => {
    return evaluation.items.filter((item) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = item.categoryName.toLowerCase().includes(q)
        const matchesMerchant = (item.lastChargedMerchant || '').toLowerCase().includes(q)
        if (!matchesName && !matchesMerchant) return false
      }

      // Horizon filter
      if (horizon === 'cleared') {
        return item.status === 'paid'
      }
      if (horizon === '7_days') {
        return item.status === 'due' && item.daysUntilDue <= 7
      }
      if (horizon === '15_days') {
        return item.status === 'due' && item.daysUntilDue <= 15
      }

      return true
    })
  }, [evaluation.items, horizon, searchQuery])

  // Counts for pills
  const due7DaysCount = useMemo(
    () => evaluation.items.filter((i) => i.status === 'due' && i.daysUntilDue <= 7).length,
    [evaluation.items]
  )
  const due15DaysCount = useMemo(
    () => evaluation.items.filter((i) => i.status === 'due' && i.daysUntilDue <= 15).length,
    [evaluation.items]
  )

  // Percentage cleared calculation
  const percentageCleared = useMemo(() => {
    if (evaluation.totalCommitment <= 0) return 0
    return Math.min(100, Math.round((evaluation.clearedAmount / evaluation.totalCommitment) * 100))
  }, [evaluation.clearedAmount, evaluation.totalCommitment])

  const renderPaymentModeIcon = (mode?: string | null) => {
    if (!mode) return <CreditCard className="h-3.5 w-3.5 text-sb-ink-muted" />
    const lower = mode.toLowerCase()
    if (lower.includes('upi')) return <Zap className="h-3.5 w-3.5 text-amber-500" />
    if (lower.includes('nach') || lower.includes('net_banking') || lower.includes('bank')) {
      return <Building2 className="h-3.5 w-3.5 text-blue-500" />
    }
    return <CreditCard className="h-3.5 w-3.5 text-brand-500" />
  }

  // Quick 1-click onboard helper for existing default categories
  const handleQuickMarkCategory = async (cat: Category) => {
    if (user?.id) {
      savePlannedCategorySchedule(cat.name, { dueDay: 1 }, user.id)
    }
    setEditingCategory(cat)
    setInitialPlannedPaymentForModal(true)
    setIsCategoryModalOpen(true)
  }

  return (
    <AppLayout>
      <div className="relative">
        {/* Subtle background glow */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 overflow-hidden">
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-72 w-[38rem] max-w-[95vw] rounded-full bg-radial from-brand-500/10 via-brand-500/3 to-transparent blur-3xl" />
        </div>

        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-brand-50 border border-brand-200/80 text-brand-700 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                Command Center
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-sb-ink sm:text-3xl">
              Planned Payments
            </h1>
            <p className="mt-1 text-sm text-sb-ink-muted max-w-2xl">
              Fixed and recurring commitments like Rent, Utilities, EMIs, and Subscriptions.
              Payments clear automatically when logged in your transactions.
            </p>
          </div>

          {/* Month Navigation and New Category Button */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl bg-surface-1 border border-sb-hairline p-1 shadow-xs">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="p-1.5 rounded-lg text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-xs font-semibold text-sb-ink min-w-[7.5rem] text-center">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Next month"
                className="p-1.5 rounded-lg text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {!isCurrentCalendarMonth && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleResetToCurrentMonth}
                className="!h-9 text-xs"
              >
                This month
              </Button>
            )}

            <Button
              onClick={() => {
                setEditingCategory(null)
                setInitialPlannedPaymentForModal(true)
                setIsCategoryModalOpen(true)
              }}
              className="!h-9 text-xs shadow-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Planned Category
            </Button>
          </div>
        </div>

        {loading && plannedCategories.length === 0 ? (
          <div className="mt-6 flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="mt-3 h-7 w-36" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </Card>
              ))}
            </div>
            <Card className="p-6">
              <Skeleton className="h-5 w-48" />
              <div className="mt-4 flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} shape="block" className="h-20 w-full" />
                ))}
              </div>
            </Card>
          </div>
        ) : plannedCategories.length === 0 ? (
          /* Empty Onboarding State */
          <Card className="mt-6 p-8 border-dashed border-sb-hairline bg-surface-1 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 border border-brand-200/80 text-brand-600 shadow-xs">
              <Calendar className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-bold text-sb-ink">
              No planned payments set up yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-sb-ink-muted leading-relaxed">
              Mark your recurring categories (such as Rent, Utilities, Subscriptions, EMI, or Insurance)
              to track due dates and clearance status every month.
            </p>

            {/* Quick 1-tap suggestions from user's existing expense categories */}
            {categories.filter((c) => c.type === 'expense').length > 0 && (
              <div className="mt-6 mx-auto max-w-lg">
                <p className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-3">
                  Quick add from your existing categories:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {categories
                    .filter((c) => c.type === 'expense')
                    .slice(0, 6)
                    .map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleQuickMarkCategory(cat)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sb-hairline bg-surface-2 text-xs font-semibold text-sb-ink hover:border-brand-500/40 hover:bg-brand-50 hover:text-brand-700 transition-all cursor-pointer shadow-xs"
                      >
                        <span>{cat.emoji}</span>
                        <span>{cat.name}</span>
                        <Plus className="h-3 w-3 text-sb-ink-muted" />
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-center">
              <Button
                onClick={() => {
                  setEditingCategory(null)
                  setInitialPlannedPaymentForModal(true)
                  setIsCategoryModalOpen(true)
                }}
                className="!h-10 text-xs shadow-xs"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Planned Category
              </Button>
            </div>
          </Card>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {/* Top 3 Summary Cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Card 1: Total Commitment */}
              <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent">
                <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
                  Total Monthly Commitment
                </span>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-sb-ink tnum">
                  {formatCurrency(evaluation.totalCommitment)}
                </p>
                <p className="mt-1 text-xs text-sb-ink-muted">
                  across {evaluation.totalCount} planned {evaluation.totalCount === 1 ? 'payment' : 'payments'}
                </p>
              </Card>

              {/* Card 2: Cleared This Month */}
              <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/60 before:to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
                    Cleared This Month
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-brand-700 tnum">
                  {formatCurrency(evaluation.clearedAmount)}
                </p>
                <p className="mt-1 text-xs text-sb-ink-muted">
                  {evaluation.clearedCount} of {evaluation.totalCount} commitments cleared
                </p>
              </Card>

              {/* Card 3: Remaining Still Due */}
              <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-amber-500/40 before:to-transparent">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
                    Remaining Still Due
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    <Clock className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-sb-ink tnum">
                  {formatCurrency(evaluation.remainingDueAmount)}
                </p>
                <p className="mt-1 text-xs text-sb-ink-muted">
                  {evaluation.dueCount} {evaluation.dueCount === 1 ? 'payment' : 'payments'} pending this month
                </p>
              </Card>
            </div>

            {/* Clearance Progress Bar */}
            <div className="rounded-xl border border-sb-hairline bg-surface-1 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 sm:w-48 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all duration-500"
                    style={{ width: `${percentageCleared}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-sb-ink tnum">
                  {percentageCleared}% cleared
                </span>
              </div>
              <span className="text-xs text-sb-ink-muted">
                {evaluation.clearedCount} cleared · {evaluation.dueCount} remaining
              </span>
            </div>

            {/* List & Filters Section */}
            <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl">
              {/* Filter Horizon Pills & Search */}
              <div className="flex flex-col gap-3 pb-4 border-b border-sb-hairline sm:flex-row sm:items-center sm:justify-between">
                {/* Horizon Pills */}
                <div className="inline-flex flex-wrap rounded-xl bg-surface-2 p-1 border border-sb-hairline gap-1">
                  <button
                    type="button"
                    onClick={() => setHorizon('all')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                      horizon === 'all'
                        ? 'bg-surface-1 text-sb-ink shadow-xs'
                        : 'text-sb-ink-muted hover:text-sb-ink'
                    )}
                  >
                    <span>Full Month</span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                      {evaluation.totalCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setHorizon('7_days')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                      horizon === '7_days'
                        ? 'bg-surface-1 text-sb-ink shadow-xs'
                        : 'text-sb-ink-muted hover:text-sb-ink'
                    )}
                  >
                    <span>Next 7 Days</span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                      {due7DaysCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setHorizon('15_days')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                      horizon === '15_days'
                        ? 'bg-surface-1 text-sb-ink shadow-xs'
                        : 'text-sb-ink-muted hover:text-sb-ink'
                    )}
                  >
                    <span>Next 15 Days</span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                      {due15DaysCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setHorizon('cleared')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                      horizon === 'cleared'
                        ? 'bg-surface-1 text-sb-ink shadow-xs'
                        : 'text-sb-ink-muted hover:text-sb-ink'
                    )}
                  >
                    <span>Cleared</span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                      {evaluation.clearedCount}
                    </span>
                  </button>
                </div>

                {/* Search box */}
                <div className="sm:w-64">
                  <Input
                    id="search-payments"
                    type="search"
                    aria-label="Search planned payments"
                    placeholder="Search category or merchant..."
                    icon={<Search className="h-4 w-4 text-sb-ink-muted" />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Items List */}
              {filteredItems.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-semibold text-sb-ink">No payments match this filter</p>
                  <p className="mt-1 text-xs text-sb-ink-muted">
                    Try switching back to &ldquo;Full Month&rdquo; or clearing your search.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4 !h-9 text-xs"
                    onClick={() => {
                      setHorizon('all')
                      setSearchQuery('')
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  <AnimatePresence initial={false}>
                    {filteredItems.map((item) => {
                      const isPaid = item.status === 'paid'

                      let badgeVariant: 'success' | 'warning' | 'danger' | 'info' = 'info'
                      let statusText = `Due in ${item.daysUntilDue} days`

                      if (isPaid) {
                        badgeVariant = 'success'
                        statusText = item.paidDate
                          ? `✅ Paid on ${formatDate(item.paidDate)}`
                          : '✅ Paid'
                      } else if (item.daysUntilDue < 0) {
                        badgeVariant = 'danger'
                        statusText = `${Math.abs(item.daysUntilDue)}d overdue`
                      } else if (item.daysUntilDue === 0) {
                        badgeVariant = 'warning'
                        statusText = 'Due today'
                      } else if (item.daysUntilDue === 1) {
                        badgeVariant = 'warning'
                        statusText = 'Due tomorrow'
                      }

                      return (
                        <motion.li
                          key={item.id}
                          layout={!reduce}
                          variants={rowVariants(reduce)}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          transition={transition(reduce)}
                          className={cn(
                            'flex flex-col gap-3.5 rounded-xl border p-4 shadow-xs transition-all hover:shadow-card sm:flex-row sm:items-center sm:justify-between',
                            isPaid
                              ? 'border-brand-200/60 bg-surface-1 hover:border-brand-500/30'
                              : item.daysUntilDue < 0
                              ? 'border-rose-200/70 bg-rose-50/20 hover:border-rose-300'
                              : 'border-sb-hairline bg-surface-1 hover:border-brand-500/30'
                          )}
                        >
                          {/* Left: Category info & details */}
                          <div className="flex min-w-0 items-start sm:items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sb-hairline bg-surface-2 text-xl shadow-xs"
                            >
                              {item.categoryEmoji || '📅'}
                            </span>
                            <div className="flex min-w-0 flex-col">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-sb-ink truncate">
                                  {item.categoryName}
                                </span>
                                <Badge variant={badgeVariant}>{statusText}</Badge>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sb-ink-muted">
                                {isPaid ? (
                                  <>
                                    <span>
                                      {item.matchedTxns.length} debit {item.matchedTxns.length === 1 ? 'transaction' : 'transactions'}
                                    </span>
                                    {item.lastChargedMerchant && (
                                      <span className="truncate max-w-[12rem] text-sb-ink font-medium">
                                        · {item.lastChargedMerchant}
                                      </span>
                                    )}
                                    {item.matchedTxns[0]?.payment_mode && (
                                      <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-sb-ink-muted">
                                        {renderPaymentModeIcon(item.matchedTxns[0].payment_mode)}
                                        <span className="uppercase">{item.matchedTxns[0].payment_mode}</span>
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span>
                                    Scheduled for Day {item.dueDay} of the month ({formatDate(item.dueDate)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right: Amount and Action buttons */}
                          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-sb-hairline">
                            <div className="flex flex-col sm:items-end">
                              <span
                                className={cn(
                                  'text-base font-extrabold tnum',
                                  isPaid ? 'text-brand-700' : 'text-sb-ink'
                                )}
                              >
                                {formatCurrency(item.amount)}
                              </span>
                              <span className="text-[11px] text-sb-ink-muted">
                                {isPaid ? 'cleared' : 'expected commitment'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {!isPaid && (
                                <Button
                                  size="sm"
                                  onClick={() => setRecordingItem(item)}
                                  className="!h-9 text-xs shadow-xs"
                                >
                                  <Plus className="h-3.5 w-3.5 mr-1" />
                                  Record Payment
                                </Button>
                              )}

                              <button
                                type="button"
                                onClick={() => setEditingScheduleItem(item)}
                                title="Edit schedule or expected amount"
                                aria-label={`Edit schedule for ${item.categoryName}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sb-hairline bg-surface-1 text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          </div>
        )}

        {/* Modal 1: Record or Match Payment */}
        {recordingItem && (
          <RecordPlannedPaymentModal
            isOpen={!!recordingItem}
            onClose={() => setRecordingItem(null)}
            onSuccess={() => {
              fetchMonthData()
              refreshCategories()
            }}
            categoryName={recordingItem.categoryName}
            categoryEmoji={recordingItem.categoryEmoji}
            expectedAmount={recordingItem.expectedAmount}
            monthTransactions={transactions}
          />
        )}

        {/* Modal 2: Edit Plan Schedule */}
        {editingScheduleItem && (
          <EditPlannedScheduleModal
            isOpen={!!editingScheduleItem}
            onClose={() => setEditingScheduleItem(null)}
            onSaved={() => {
              fetchMonthData()
            }}
            categoryName={editingScheduleItem.categoryName}
            categoryEmoji={editingScheduleItem.categoryEmoji}
            initialDueDay={editingScheduleItem.dueDay}
            initialExpectedAmount={editingScheduleItem.expectedAmount}
          />
        )}

        {/* Modal 3: Category Form Modal (create / edit category) */}
        {isCategoryModalOpen && (
          <CategoryFormModal
            editing={editingCategory}
            onClose={() => {
              setIsCategoryModalOpen(false)
              setEditingCategory(null)
            }}
            onSaved={() => {
              setIsCategoryModalOpen(false)
              setEditingCategory(null)
              refreshCategories()
              fetchMonthData()
            }}
            initialPlannedPayment={initialPlannedPaymentForModal}
          />
        )}
      </div>
    </AppLayout>
  )
}
