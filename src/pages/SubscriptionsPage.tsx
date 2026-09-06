// ============================================
// SubscriptionsPage — Planned Payments & Subscriptions
// Detects, aggregates, and manages recurring payments
// across subscriptions, utilities, rent, insurance, EMIs, and SIPs.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Card, Button, Badge, Input, EmptyState, Skeleton,
  ACTION_BUTTON_DANGER, rowVariants, transition,
} from '@/components/ui'
import {
  RefreshCw, Plus, Search, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Lightbulb, EyeOff,
  CreditCard, Building2, Zap, Layers,
} from 'lucide-react'
import Select from '@/components/ui/Select'
import { createTransaction } from '@/services'
import { fetchAllTransactions } from '@/services/transactions'
import {
  detectPlannedPayments,
  merchantKey,
  ignoredSubscriptionsStorageKey,
  loadIgnoredSubscriptionKeys,
  SUBSCRIPTION_LOOKBACK_MONTHS,
  isSubscriptionTabItem,
  isBillRentOrEmiTabItem,
  type PlannedPayment,
} from '@/services/plannedPayments'
import PlannedPaymentCalendar from '@/components/subscriptions/PlannedPaymentCalendar'
import { formatCurrency, formatDate } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import type { Database } from '@/types/database'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

export default function SubscriptionsPage() {
  const { user, currencySymbol } = useAuth()
  const { getStyle } = useCategories()
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Merchants the user has marked as "not a recurring charge".
  const ignoredStorageKey = user ? ignoredSubscriptionsStorageKey(user.id) : null
  const [ignoredKeys, setIgnoredKeys] = useState<string[]>([])

  useEffect(() => {
    setIgnoredKeys(loadIgnoredSubscriptionKeys(user?.id))
  }, [user?.id])

  const persistIgnored = (keys: string[]) => {
    setIgnoredKeys(keys)
    if (ignoredStorageKey) {
      try {
        localStorage.setItem(ignoredStorageKey, JSON.stringify(keys))
      } catch (e) {
        console.warn('Failed to persist ignored subscriptions:', e)
      }
    }
  }

  const hideSubscription = (title: string) => {
    const key = merchantKey(title)
    if (ignoredKeys.includes(key)) return
    persistIgnored([...ignoredKeys, key])
  }

  const restoreAllSubscriptions = () => persistIgnored([])

  // Tab & Display filters
  const [activeTab, setActiveTab] = useState<'all' | 'subscriptions' | 'bills_rent_emis'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [renewalWindow, setRenewalWindow] = useState<'7' | '30' | '90' | 'all'>('all')

  // Manual Subscription/Payment Form States
  const [subName, setSubName] = useState('')
  const [subAmount, setSubAmount] = useState('')
  const [subCategory, setSubCategory] = useState('Subscriptions')
  const [subRenewalDay, setSubRenewalDay] = useState(1)
  const [subPaymentMode, setSubPaymentMode] = useState('upi')
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const since = new Date()
      since.setMonth(since.getMonth() - SUBSCRIPTION_LOOKBACK_MONTHS)
      const { data } = await fetchAllTransactions({ dateFrom: toISODateLocal(since) })
      if (data) {
        setTransactions(data)
      }
    } catch (e) {
      console.error('Failed to fetch transactions for planned payments:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.title = `Planned Payments & Subscriptions | ${APP_CONFIG.APP_NAME}`
    fetchData()
  }, [])

  // Auto-detect planned payments across subscriptions, utilities, rent, EMIs, SIPs
  const detectedPayments: PlannedPayment[] = useMemo(
    () => detectPlannedPayments(transactions, { ignoredKeys }),
    [transactions, ignoredKeys]
  )

  const subscriptionsCount = useMemo(
    () => detectedPayments.filter(isSubscriptionTabItem).length,
    [detectedPayments]
  )

  const billsRentEmisCount = useMemo(
    () => detectedPayments.filter(isBillRentOrEmiTabItem).length,
    [detectedPayments]
  )

  // Total monthly outflow calculation across all cadences
  const totalMonthlyOutflow = useMemo(() => {
    return detectedPayments.reduce((sum, s) => {
      const monthlyEquivalent =
        s.cadence === 'annual' ? s.amount / 12 :
        s.cadence === 'quarterly' ? s.amount / 3 :
        s.cadence === 'weekly' ? s.amount * 4.33 :
        s.amount
      return sum + monthlyEquivalent
    }, 0)
  }, [detectedPayments])

  const uniqueCategories = useMemo(
    () => [...new Set(detectedPayments.map((s) => s.category))],
    [detectedPayments]
  )

  // Partitioned and filtered list
  const visiblePayments = useMemo(() => {
    return detectedPayments.filter((s) => {
      // Tab filter
      if (activeTab === 'subscriptions' && !isSubscriptionTabItem(s)) return false
      if (activeTab === 'bills_rent_emis' && !isBillRentOrEmiTabItem(s)) return false

      const q = searchQuery.trim().toLowerCase()
      const matchesSearch = !q || s.title.toLowerCase().includes(q)
      const matchesCategory = filterCategory === 'all' || s.category === filterCategory
      const matchesWindow = renewalWindow === 'all' || s.days_until_due <= Number(renewalWindow)
      return matchesSearch && matchesCategory && matchesWindow
    })
  }, [detectedPayments, activeTab, searchQuery, filterCategory, renewalWindow])

  // Duplicate streaming service warnings
  const musicKeywords = ['spotify', 'apple music', 'yt music', 'youtube music', 'wynk', 'jiosaavn']
  const videoKeywords = ['netflix', 'prime', 'hotstar', 'disney', 'jio cinema', 'jiocinema', 'youtube premium']

  const activeMusic = detectedPayments.filter((s) =>
    musicKeywords.some((kw) => s.title.toLowerCase().includes(kw))
  )
  const activeVideo = detectedPayments.filter((s) =>
    videoKeywords.some((kw) => s.title.toLowerCase().includes(kw))
  )

  const handleAddManualPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setFormSuccess(false)

    const amountNum = Number(subAmount)
    if (!subName.trim()) {
      setFormError('Please enter a payment or service name.')
      return
    }
    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Please enter a valid amount.')
      return
    }

    try {
      const now = new Date()
      const maxDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const validDay = Math.min(subRenewalDay, maxDaysInMonth)
      const targetDate = new Date(now.getFullYear(), now.getMonth(), validDay)
      const dateStr = toISODateLocal(targetDate)

      if (!user) throw new Error('User not logged in')

      const { error } = await createTransaction({
        user_id: user.id,
        amount: amountNum,
        type: 'debit',
        category: subCategory,
        merchant: subName.trim(),
        description: `${subName.trim()} Recurring Commitment`,
        date: dateStr,
        source: 'manual',
        approval_status: 'approved',
        payment_mode: subPaymentMode as any,
      })

      if (error) throw error

      setFormSuccess(true)
      setSubName('')
      setSubAmount('')
      setSubCategory('Subscriptions')
      setSubRenewalDay(1)
      setSubPaymentMode('upi')

      // Reload list
      fetchData()
    } catch (err: any) {
      setFormError(err.message || 'Failed to add manual payment record.')
    }
  }

  const renderAccountIcon = (accountStr: string | null) => {
    if (!accountStr) return <CreditCard className="h-3.5 w-3.5 text-sb-ink-muted" />
    const lower = accountStr.toLowerCase()
    if (lower.includes('upi')) return <Zap className="h-3.5 w-3.5 text-amber-500" />
    if (lower.includes('nach') || lower.includes('net banking') || lower.includes('bank')) {
      return <Building2 className="h-3.5 w-3.5 text-blue-500" />
    }
    return <CreditCard className="h-3.5 w-3.5 text-brand-500" />
  }

  const reduce = useReducedMotion()
  const filtersActive =
    searchQuery.trim() !== '' || filterCategory !== 'all' || renewalWindow !== 'all'

  return (
    <AppLayout>
      <div className="relative">
        {/* Ambient emerald background glow */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-80 w-[42rem] max-w-[95vw] rounded-full bg-radial from-brand-500/12 via-brand-500/4 to-transparent blur-3xl" />
        </div>

        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-brand-50 border border-brand-200/70 text-brand-700 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              Planned Payments Active
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-sb-ink md:text-3xl">
            Planned Payments & Subscriptions
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-sb-ink-muted">
            Charges and recurring commitments that keep coming back — utilities, rent, insurance,
            EMIs, SIPs, and digital subscriptions — tracked with due dates and linked accounts.
          </p>
        </div>

        {loading ? (
          <div className="mt-6 flex flex-col gap-6 md:mt-8">
            <Card className="p-6">
              <Skeleton className="h-6 w-64" />
              <Skeleton shape="block" className="mt-4 h-24 w-full" />
            </Card>
            <div className="grid gap-6 md:grid-cols-3">
              <div role="status" aria-label="Loading payments" className="flex flex-col gap-6 md:col-span-1">
                <Card className="border-sb-hairline bg-surface-1 shadow-card rounded-2xl">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-4 h-8 w-40" />
                  <Skeleton className="mt-2 h-4 w-48" />
                </Card>
                <Card>
                  <Skeleton className="h-4 w-44" />
                  <Skeleton shape="block" className="mt-5 h-11 w-full" />
                  <Skeleton shape="block" className="mt-4 h-11 w-full" />
                </Card>
              </div>
              <div className="md:col-span-2">
                <Card>
                  <Skeleton className="h-4 w-52" />
                  <Skeleton shape="block" className="mt-5 h-11 w-full" />
                  <div className="mt-4 flex flex-col gap-3">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} shape="block" className="h-20 w-full" />)}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6 md:mt-8">
            {/* Mounted 30-Day Planned Payment Calendar */}
            <PlannedPaymentCalendar payments={detectedPayments} />

            <div className="grid gap-6 md:grid-cols-3">
              {/* Left Column: Summary Card and Manual Creator */}
              <div className="order-2 flex flex-col gap-6 md:order-1 md:col-span-1">
                {/* Summary */}
                <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
                    Total recurring commitment
                  </h2>
                  <p className="mt-3 text-3xl font-extrabold tracking-tight text-sb-ink tnum">
                    {formatCurrency(totalMonthlyOutflow)}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-sb-ink-muted">
                    monthly across {detectedPayments.length} planned {detectedPayments.length === 1 ? 'charge' : 'charges'}.
                    Quarterly and annual commitments are normalized across the months they cover.
                  </p>
                  <div className="mt-4 pt-4 border-t border-sb-hairline flex items-center justify-between text-xs text-sb-ink-muted">
                    <span>Annualized commitment</span>
                    <span className="font-semibold text-sb-ink tnum">{formatCurrency(totalMonthlyOutflow * 12)}/yr</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-sb-hairline flex items-center justify-between text-xs text-sb-ink-muted">
                    <span>Subscriptions ({subscriptionsCount})</span>
                    <span>Bills & EMIs ({billsRentEmisCount})</span>
                  </div>
                </Card>

                {/* Duplicate Streaming Alerts */}
                {(activeMusic.length > 1 || activeVideo.length > 2) && (
                  <Card className="relative overflow-hidden border border-amber-200/80 bg-amber-50/60 p-5 shadow-xs rounded-2xl">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
                      <Lightbulb className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                      <span>Worth a look</span>
                    </h2>
                    <ul className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-amber-900/90">
                      {activeMusic.length > 1 && (
                        <li>
                          You are paying for multiple music services —{' '}
                          <strong className="font-semibold text-sb-ink">{activeMusic.map(m => m.title).join(', ')}</strong>.
                          Keeping one could save about{' '}
                          <span className="font-bold text-sb-ink tnum">
                            {formatCurrency(activeMusic.reduce((sum, s) => sum + s.amount, 0) - activeMusic[0].amount)}
                          </span>{' '}
                          a month.
                        </li>
                      )}
                      {activeVideo.length > 2 && (
                        <li>
                          {activeVideo.length} video streaming services are active simultaneously. Rotating
                          subscriptions between services can optimize your recurring entertainment budget.
                        </li>
                      )}
                    </ul>
                  </Card>
                )}

                {/* Manual Planned Payment Creator Form */}
                <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl">
                  <h2 className="flex items-center gap-2 text-base font-bold text-sb-ink">
                    <Plus className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                    <span>Add planned commitment</span>
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-sb-ink-muted">
                    Add upcoming bills, rent, SIPs, or subscriptions that Intrack has not observed yet.
                  </p>

                  <form onSubmit={handleAddManualPayment} className="mt-5 flex flex-col gap-4">
                    {formError && (
                      <div
                        role="alert"
                        className="flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-danger-text)]"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{formError}</span>
                      </div>
                    )}
                    {formSuccess && (
                      <div
                        role="status"
                        className="flex items-start gap-2.5 rounded-xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-positive-text)]"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Added successfully. It will now appear in your planned payments timeline.</span>
                      </div>
                    )}

                    <Input
                      id="sub-name"
                      label="Service or Commitment"
                      placeholder="e.g. HDFC Home Loan, Electricity, Netflix"
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      required
                    />

                    <Input
                      id="sub-amount"
                      label={`Amount per cycle (${currencySymbol})`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="1500"
                      value={subAmount}
                      onChange={(e) => setSubAmount(e.target.value)}
                      className="tnum"
                      required
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-1">
                      <Select
                        id="sub-category"
                        label="Category"
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                      >
                        <option value="Subscriptions">🔄 Subscriptions</option>
                        <option value="Utilities & Bills">💡 Utilities & Bills</option>
                        <option value="Rent">🏠 Rent & Maintenance</option>
                        <option value="Insurance">🛡️ Insurance</option>
                        <option value="Loan">🤝 Loans & EMIs</option>
                        <option value="Investments">📈 Investments & SIP</option>
                        <option value="Credit Card Bill Payment">💳 Credit Card Bill</option>
                      </Select>

                      <Select
                        id="sub-renewal-day"
                        label="Due day of the month"
                        value={subRenewalDay}
                        onChange={(e) => setSubRenewalDay(Number(e.target.value))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>Day {d} of the month</option>
                        ))}
                      </Select>

                      <Select
                        id="sub-payment-mode"
                        label="Payment method"
                        value={subPaymentMode}
                        onChange={(e) => setSubPaymentMode(e.target.value)}
                      >
                        <option value="upi">⚡ UPI AutoPay</option>
                        <option value="credit_card">💳 Credit Card</option>
                        <option value="nach">🏦 NACH Mandate / ECS</option>
                        <option value="net_banking">🌐 Net Banking</option>
                        <option value="debit_card">💳 Debit Card</option>
                      </Select>
                    </div>

                    <Button type="submit" block className="!h-11 justify-center shadow-xs">
                      Add planned payment
                    </Button>
                  </form>
                </Card>
              </div>

              {/* Right Column: Active Payments List & Tabs */}
              <div className="order-1 md:order-2 md:col-span-2">
                <Card className="relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
                  {/* Tabs: Subscriptions vs Bills, Rent & EMIs */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sb-hairline pb-4">
                    <div className="inline-flex rounded-xl bg-surface-2 p-1 border border-sb-hairline">
                      <button
                        type="button"
                        onClick={() => setActiveTab('all')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                          activeTab === 'all'
                            ? 'bg-surface-1 text-sb-ink shadow-xs'
                            : 'text-sb-ink-muted hover:text-sb-ink'
                        }`}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>All</span>
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                          {detectedPayments.length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('subscriptions')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                          activeTab === 'subscriptions'
                            ? 'bg-surface-1 text-sb-ink shadow-xs'
                            : 'text-sb-ink-muted hover:text-sb-ink'
                        }`}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Subscriptions</span>
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                          {subscriptionsCount}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('bills_rent_emis')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                          activeTab === 'bills_rent_emis'
                            ? 'bg-surface-1 text-sb-ink shadow-xs'
                            : 'text-sb-ink-muted hover:text-sb-ink'
                        }`}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        <span>Bills, Rent & EMIs</span>
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.2 text-[10px] text-sb-ink">
                          {billsRentEmisCount}
                        </span>
                      </button>
                    </div>

                    {detectedPayments.length > 0 && (
                      <p className="text-xs font-medium text-sb-ink-muted">
                        {visiblePayments.length === detectedPayments.length
                          ? `${detectedPayments.length} found`
                          : `${visiblePayments.length} of ${detectedPayments.length} shown`}
                      </p>
                    )}
                  </div>

                  {/* Search and Filters */}
                  {detectedPayments.length > 0 && (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <div className="min-w-0 flex-1">
                        <Input
                          id="sub-search"
                          type="search"
                          aria-label="Search planned payments"
                          placeholder="Search by name or service"
                          icon={<Search className="h-4 w-4 text-sb-ink-muted" aria-hidden="true" />}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>
                      <div className="min-w-0 sm:w-44">
                        <Select
                          id="sub-filter-category"
                          aria-label="Filter by category"
                          value={filterCategory}
                          onChange={(e) => setFilterCategory(e.target.value)}
                        >
                          <option value="all">All categories</option>
                          {uniqueCategories.map((code) => {
                            const meta = getStyle(code)
                            return (
                              <option key={code} value={code}>
                                {`${meta.emoji} ${meta.label}`}
                              </option>
                            )
                          })}
                        </Select>
                      </div>
                      <div className="min-w-0 sm:w-40">
                        <Select
                          id="sub-filter-window"
                          aria-label="Filter by due window"
                          value={renewalWindow}
                          onChange={(e) => setRenewalWindow(e.target.value as typeof renewalWindow)}
                        >
                          <option value="all">Any time</option>
                          <option value="7">Next 7 days</option>
                          <option value="30">Next 30 days</option>
                          <option value="90">Next 90 days</option>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Empty States & Payment List */}
                  {detectedPayments.length === 0 ? (
                    <EmptyState
                      icon={<RefreshCw className="h-7 w-7 text-sb-ink-muted" aria-hidden="true" />}
                      title="No planned payments detected yet"
                      description="Intrack spots repeating charges like subscriptions, broadband, rent, or EMIs automatically once they bill regularly. Log an expense or bank alert and they will appear here."
                      action={
                        <Link to="/expenses" state={{ openForm: true }}>
                          <Button className="!h-11">Add an expense</Button>
                        </Link>
                      }
                    />
                  ) : visiblePayments.length === 0 ? (
                    <EmptyState
                      icon={<Search className="h-7 w-7 text-sb-ink-muted" aria-hidden="true" />}
                      title="Nothing matches those filters"
                      description="Widen the due window, clear the category, or switch between Subscriptions and Bills & EMIs tabs."
                      action={
                        filtersActive || activeTab !== 'all' ? (
                          <Button
                            variant="secondary"
                            className="!h-11"
                            onClick={() => {
                              setActiveTab('all')
                              setSearchQuery('')
                              setFilterCategory('all')
                              setRenewalWindow('all')
                            }}
                          >
                            Reset all filters
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <ul className="mt-5 flex flex-col gap-3">
                      <AnimatePresence initial={false}>
                        {visiblePayments.map((payment, idx) => {
                          const categoryMeta = getStyle(payment.category)

                          let badgeVariant: 'success' | 'warning' | 'danger' = 'success'
                          if (payment.days_until_due <= 2) badgeVariant = 'danger'
                          else if (payment.days_until_due <= 7) badgeVariant = 'warning'

                          const freqLabel =
                            payment.cadence === 'monthly' ? 'Monthly' :
                            payment.cadence === 'quarterly' ? 'Quarterly' :
                            payment.cadence === 'annual' ? 'Annual' :
                            payment.cadence === 'weekly' ? 'Weekly' : 'Recurring'

                          const dueLabel =
                            payment.days_until_due < 0
                              ? `${Math.abs(payment.days_until_due)}d overdue`
                              : payment.days_until_due === 0
                              ? 'Due today'
                              : payment.days_until_due === 1
                              ? 'Due tomorrow'
                              : `Due in ${payment.days_until_due} days`

                          return (
                            <motion.li
                              key={`${payment.title}-${idx}`}
                              layout={!reduce}
                              variants={rowVariants(reduce)}
                              initial="initial"
                              animate="animate"
                              exit="exit"
                              transition={transition(reduce)}
                              className="flex flex-col gap-3 rounded-xl border border-sb-hairline bg-surface-1 p-4 shadow-xs transition-all hover:border-brand-500/30 hover:shadow-card sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <span
                                  aria-hidden="true"
                                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sb-hairline bg-surface-2 text-lg shadow-xs"
                                >
                                  {categoryMeta.emoji}
                                </span>
                                <div className="flex min-w-0 flex-col">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="truncate text-sm font-semibold capitalize text-sb-ink">
                                      {payment.title}
                                    </span>

                                    {/* Linked Account / Card Pill */}
                                    {payment.card_or_account && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 border border-sb-hairline px-2 py-0.5 text-[11px] font-medium text-sb-ink-muted">
                                        {renderAccountIcon(payment.card_or_account)}
                                        <span className="truncate max-w-[8rem]">
                                          {payment.card_or_account}
                                        </span>
                                      </span>
                                    )}

                                    {payment.price_change !== null && payment.price_change !== undefined && (
                                      <span
                                        className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs font-medium ${
                                          payment.price_change > 0
                                            ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)]'
                                            : 'border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                                        }`}
                                      >
                                        {payment.price_change > 0 ? (
                                          <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        ) : (
                                          <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        )}
                                        Price {payment.price_change > 0 ? 'went up' : 'came down'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-xs text-sb-ink-muted">
                                    {freqLabel} · charged {payment.times_charged}×
                                    {payment.last_billed && (
                                      <>
                                        {' '}· last on{' '}
                                        <span className="tnum font-medium">{formatDate(payment.last_billed)}</span>
                                      </>
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                                <div className="flex flex-col sm:items-end">
                                  <span className="text-sm font-bold text-sb-ink tnum">
                                    {formatCurrency(payment.amount)}
                                  </span>
                                  <span className="text-xs text-sb-ink-muted">{freqLabel.toLowerCase()}</span>
                                </div>
                                <div className="flex flex-col gap-1 sm:items-end">
                                  <Badge variant={badgeVariant}>{dueLabel}</Badge>
                                  <span className="text-xs text-sb-ink-muted tnum">
                                    {formatDate(payment.next_due_date)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => hideSubscription(payment.title)}
                                  title="Hide from planned payments. The transaction stays."
                                  aria-label={`Hide ${payment.title} from planned payments`}
                                  className={`${ACTION_BUTTON_DANGER} shrink-0`}
                                >
                                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                  )}

                  {ignoredKeys.length > 0 && (
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-sb-hairline bg-surface-2/60 px-4 py-3">
                      <p className="text-sm text-sb-ink-muted">
                        {ignoredKeys.length} hidden as non-recurring. Those expenses are still
                        counted in your accounts and analytics.
                      </p>
                      <button
                        type="button"
                        onClick={restoreAllSubscriptions}
                        className="shrink-0 cursor-pointer rounded text-sm font-medium text-brand-600 underline underline-offset-2 transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        Show them again
                      </button>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
