// ============================================
// SubscriptionsPage — recurring charges detected from transactions
// Detects, aggregates, and manages recurring payments
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Card, Button, Badge, Input, EmptyState, Skeleton,
  ACTION_BUTTON_DANGER, SECTION_LABEL, rowVariants, transition,
} from '@/components/ui'
import {
  RefreshCw, Plus, Search, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Lightbulb, EyeOff,
} from 'lucide-react'
import Select from '@/components/ui/Select'
import { createTransaction } from '@/services'
import { fetchAllTransactions } from '@/services/transactions'
import {
  detectSubscriptions as runDetectSubscriptions,
  merchantKey,
  ignoredSubscriptionsStorageKey,
  loadIgnoredSubscriptionKeys,
  SUBSCRIPTION_LOOKBACK_MONTHS,
} from '@/services/subscriptionDetection'
import { formatCurrency, formatDate } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import type { Database } from '@/types/database'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

// Detection lives in services/subscriptionDetection.ts — the Dashboard's
// Active Subscriptions widget renders the same list and must reach the same
// verdict, which it cannot do from a second copy of these rules.

export default function SubscriptionsPage() {
  const { user, currencySymbol } = useAuth()
  const { getStyle } = useCategories()
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Merchants the user has marked as "not a subscription". These are filtered out
  // of auto-detection without touching the underlying expense transactions, so the
  // spend still counts everywhere else (Expenses, Dashboard, analytics). Reversible.
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

  const hideSubscription = (merchant: string) => {
    const key = merchantKey(merchant)
    if (ignoredKeys.includes(key)) return
    persistIgnored([...ignoredKeys, key])
  }

  const restoreAllSubscriptions = () => persistIgnored([])

  // Display filters — narrow what's shown, never what detectSubscriptions() analyzes
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [renewalWindow, setRenewalWindow] = useState<'7' | '30' | '90' | 'all'>('all')

  // Manual Subscription Form States
  const [subName, setSubName] = useState('')
  const [subAmount, setSubAmount] = useState('')
  const [subCategory, setSubCategory] = useState('Subscriptions')
  const [subRenewalDay, setSubRenewalDay] = useState(1)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      // detectSubscriptions() needs two or more charges from the same merchant
      // to infer a frequency. PostgREST's 1000-row ceiling cuts off the OLDEST
      // transactions first — exactly where the earlier charge of a long-running
      // annual subscription lives — so a capped fetch silently stopped
      // detecting them.
      //
      // Bounded to 24 months rather than fetching everything: that is already
      // twice the span needed to see two annual charges, and an unbounded fetch
      // would pull a heavy user's entire history into the browser on every
      // visit to this page. A charge older than two years is not evidence of a
      // subscription that is still running.
      const since = new Date()
      since.setMonth(since.getMonth() - SUBSCRIPTION_LOOKBACK_MONTHS)
      const { data } = await fetchAllTransactions({ dateFrom: toISODateLocal(since) })
      if (data) {
        setTransactions(data)
      }
    } catch (e) {
      console.error('Failed to fetch transactions for subscriptions:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    document.title = `Subscriptions | ${APP_CONFIG.APP_NAME}`
    fetchData()
  }, [])

  // Auto-detect subscriptions from history — supports monthly, quarterly,
  // annual. Memoised because it walks the full 24-month window: it used to run
  // on every render, and the `uniqueSubCategories` memo below depended on its
  // result, so that memo never hit either.
  const detectedSubs = useMemo(
    () => runDetectSubscriptions(transactions, { ignoredKeys }),
    [transactions, ignoredKeys]
  )
  const totalMonthlyOutflow = detectedSubs.reduce((sum, s) => {
    const monthlyEquivalent =
      s.frequency === 'annual' ? s.amount / 12 :
      s.frequency === 'quarterly' ? s.amount / 3 :
      s.amount
    return sum + monthlyEquivalent
  }, 0)

  const uniqueSubCategories = useMemo(
    () => [...new Set(detectedSubs.map((s) => s.category))],
    [detectedSubs]
  )

  const visibleSubs = useMemo(() => {
    return detectedSubs.filter((s) => {
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch = !q || s.merchant.toLowerCase().includes(q)
      const matchesCategory = filterCategory === 'all' || s.category === filterCategory
      const matchesWindow = renewalWindow === 'all' || s.daysToRenewal <= Number(renewalWindow)
      return matchesSearch && matchesCategory && matchesWindow
    })
  }, [detectedSubs, searchQuery, filterCategory, renewalWindow])

  // Verify duplicates (e.g. streaming duplicate warnings)
  const musicKeywords = ['spotify', 'apple music', 'yt music', 'youtube music', 'wynk', 'jiosaavn']
  const videoKeywords = ['netflix', 'prime', 'hotstar', 'disney', 'jio cinema', 'jiocinema', 'youtube premium']

  const activeMusic = detectedSubs.filter(s => musicKeywords.some(kw => s.merchant.toLowerCase().includes(kw)))
  const activeVideo = detectedSubs.filter(s => videoKeywords.some(kw => s.merchant.toLowerCase().includes(kw)))

  const handleAddManualSub = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setFormSuccess(false)

    const amountNum = Number(subAmount)
    if (!subName.trim()) {
      setFormError('Please enter a subscription name.')
      return
    }
    if (isNaN(amountNum) || amountNum <= 0) {
      setFormError('Please enter a valid monthly price.')
      return
    }

    try {
      const now = new Date()
      // Create a date in this month with the selected renewal day (capped to max days in current month)
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
        description: `${subName.trim()} Subscription`,
        date: dateStr,
        source: 'manual',
        approval_status: 'approved',
      })

      if (error) throw error

      setFormSuccess(true)
      setSubName('')
      setSubAmount('')
      setSubCategory('Subscriptions')
      setSubRenewalDay(1)
      
      // Reload list
      fetchData()
    } catch (err: any) {
      setFormError(err.message || 'Failed to add manual subscription record.')
    }
  }

  const reduce = useReducedMotion()
  const filtersActive =
    searchQuery.trim() !== '' || filterCategory !== 'all' || renewalWindow !== 'all'

  return (
    <AppLayout>
      <div>
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">Subscriptions</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Charges that keep coming back — streaming, broadband, apps — spotted in your own
            transactions, with the next date each one is due.
          </p>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-6 md:mt-8 md:grid-cols-3">
            <div role="status" aria-label="Loading subscriptions" className="flex flex-col gap-6 md:col-span-1">
              <Card>
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
        ) : (
          <div className="mt-6 grid gap-6 md:mt-8 md:grid-cols-3">
            {/* Left Column: Summary Card and Manual Creator — ordered after the
                calendar on mobile since the calendar is why someone opens this page */}
            <div className="order-2 flex flex-col gap-6 md:order-1 md:col-span-1">
              {/* Summary */}
              <Card>
                <h2 className={SECTION_LABEL}>Recurring spend</h2>
                <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-50 tnum">
                  {formatCurrency(totalMonthlyOutflow)}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  a month across {detectedSubs.length} {detectedSubs.length === 1 ? 'charge' : 'charges'}.
                  Quarterly and annual ones are spread over the months they cover.
                </p>
              </Card>

              {/* Duplicate Alerts */}
              {(activeMusic.length > 1 || activeVideo.length > 2) && (
                <Card className="border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)]">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--status-warning-text)]">
                    <Lightbulb className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Worth a look</span>
                  </h2>
                  <ul className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-zinc-300">
                    {activeMusic.length > 1 && (
                      <li>
                        You are paying for more than one music service —{' '}
                        <strong className="font-semibold text-zinc-100">{activeMusic.map(m => m.merchant).join(', ')}</strong>.
                        Keeping just one would save about{' '}
                        <span className="font-semibold text-zinc-100 tnum">
                          {formatCurrency(activeMusic.reduce((sum, s) => sum + s.amount, 0) - activeMusic[0].amount)}
                        </span>{' '}
                        a month.
                      </li>
                    )}
                    {activeVideo.length > 2 && (
                      <li>
                        {activeVideo.length} video streaming services are active at once. Subscribing
                        only in the months you are actually watching is the usual way to cut that.
                      </li>
                    )}
                  </ul>
                </Card>
              )}

              {/* Creator Form */}
              <Card>
                <h2 className="flex items-center gap-2 text-base font-bold text-zinc-100">
                  <Plus className="h-5 w-5 shrink-0 text-brand-400" aria-hidden="true" />
                  <span>Add one yourself</span>
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  For a charge Intrack has not seen yet. It is logged as an expense this month on
                  the day you pick.
                </p>

                <form onSubmit={handleAddManualSub} className="mt-5 flex flex-col gap-4">
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
                      <span>Added. It will show up in the list once it has charged twice.</span>
                    </div>
                  )}

                  <Input
                    id="sub-name"
                    label="Service"
                    placeholder="e.g. Netflix Premium"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    required
                  />

                  <Input
                    id="sub-amount"
                    label={`Amount per month (${currencySymbol})`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="649"
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
                      <option value="Utilities & Bills">💡 Utilities</option>
                    </Select>
                    <Select
                      id="sub-renewal-day"
                      label="Charges on"
                      value={subRenewalDay}
                      onChange={(e) => setSubRenewalDay(Number(e.target.value))}
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>Day {d} of the month</option>
                      ))}
                    </Select>
                  </div>

                  <Button type="submit" block className="!h-11 justify-center">
                    Add subscription
                  </Button>
                </form>
              </Card>
            </div>

            {/* Right Column: Active Subscriptions List */}
            <div className="order-1 md:order-2 md:col-span-2">
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="flex items-center gap-2 text-base font-bold text-zinc-100">
                    <RefreshCw className="h-5 w-5 shrink-0 text-brand-400" aria-hidden="true" />
                    <span>What renews next</span>
                  </h2>
                  {detectedSubs.length > 0 && (
                    <p className="text-xs text-zinc-400">
                      {visibleSubs.length === detectedSubs.length
                        ? `${detectedSubs.length} found`
                        : `${visibleSubs.length} of ${detectedSubs.length} shown`}
                    </p>
                  )}
                </div>

                {detectedSubs.length > 0 && (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    {/* Input and Select each render their own wrapper div and
                        pass className to the control inside, so the flex sizing
                        goes on these wrappers, not on the components. */}
                    <div className="min-w-0 flex-1">
                      <Input
                        id="sub-search"
                        type="search"
                        aria-label="Search subscriptions"
                        placeholder="Search by name"
                        icon={<Search className="h-4 w-4" aria-hidden="true" />}
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
                        {uniqueSubCategories.map((code) => {
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
                        aria-label="Filter by renewal window"
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

                {detectedSubs.length === 0 ? (
                  <EmptyState
                    icon={<RefreshCw className="h-7 w-7 text-zinc-400" aria-hidden="true" />}
                    title="Nothing recurring yet"
                    description="Intrack calls a charge a subscription once it has seen the same merchant bill you at least twice. Log an expense, or scan your bank alerts, and they will appear here on their own."
                    action={
                      <Link to="/expenses" state={{ openForm: true }}>
                        <Button className="!h-11">Add an expense</Button>
                      </Link>
                    }
                  />
                ) : visibleSubs.length === 0 ? (
                  <EmptyState
                    icon={<Search className="h-7 w-7 text-zinc-400" aria-hidden="true" />}
                    title="Nothing matches those filters"
                    description="Widen the renewal window, clear the category, or search for a different name."
                    action={
                      filtersActive ? (
                        <Button
                          variant="secondary"
                          className="!h-11"
                          onClick={() => {
                            setSearchQuery('')
                            setFilterCategory('all')
                            setRenewalWindow('all')
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="mt-5 flex flex-col gap-3">
                    <AnimatePresence initial={false}>
                      {visibleSubs.map((sub, idx) => {
                        const categoryMeta = getStyle(sub.category)

                        let badgeVariant: 'success' | 'warning' | 'danger' = 'success'
                        if (sub.daysToRenewal <= 2) badgeVariant = 'danger'
                        else if (sub.daysToRenewal <= 7) badgeVariant = 'warning'

                        const freqLabel = sub.frequency === 'monthly' ? 'Monthly'
                          : sub.frequency === 'quarterly' ? 'Quarterly'
                          : sub.frequency === 'annual' ? 'Annual'
                          : 'Recurring'

                        const renewsLabel = sub.daysToRenewal <= 0
                          ? 'Renews today'
                          : sub.daysToRenewal === 1
                            ? 'Renews tomorrow'
                            : `Renews in ${sub.daysToRenewal} days`

                        return (
                          <motion.li
                            key={`${sub.merchant}-${idx}`}
                            layout={!reduce}
                            variants={rowVariants(reduce)}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            transition={transition(reduce)}
                            className="flex flex-col gap-3 rounded-xl border border-border-subtle/40 bg-surface-2/50 p-4 transition-colors hover:border-border-hover sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-surface-1 text-lg"
                              >
                                {categoryMeta.emoji}
                              </span>
                              <div className="flex min-w-0 flex-col">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="truncate text-sm font-semibold capitalize text-zinc-100">
                                    {sub.merchant}
                                  </span>
                                  {sub.priceChange !== null && (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs font-medium ${
                                        sub.priceChange > 0
                                          ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)]'
                                          : 'border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                                      }`}
                                    >
                                      {sub.priceChange > 0
                                        ? <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        : <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                      Price {sub.priceChange > 0 ? 'went up' : 'came down'}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-zinc-400">
                                  {freqLabel} · charged {sub.timesCharged}× · last on{' '}
                                  <span className="tnum">{formatDate(sub.lastBilled)}</span>
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                              <div className="flex flex-col sm:items-end">
                                <span className="text-sm font-semibold text-zinc-100 tnum">
                                  {formatCurrency(sub.amount)}
                                </span>
                                <span className="text-xs text-zinc-400">{freqLabel.toLowerCase()}</span>
                              </div>
                              <div className="flex flex-col gap-1 sm:items-end">
                                <Badge variant={badgeVariant}>{renewsLabel}</Badge>
                                <span className="text-xs text-zinc-400 tnum">
                                  {formatDate(sub.nextRenewal)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => hideSubscription(sub.merchant)}
                                title="Not a subscription — hide it from this list. The expense stays."
                                aria-label={`Hide ${sub.merchant} from subscriptions`}
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
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-default bg-surface-2/40 px-4 py-3">
                    <p className="text-sm text-zinc-400">
                      {ignoredKeys.length} hidden as “not a subscription”. Those expenses are still
                      counted everywhere else.
                    </p>
                    <button
                      type="button"
                      onClick={restoreAllSubscriptions}
                      className="shrink-0 cursor-pointer rounded text-sm font-medium text-brand-400 underline underline-offset-2 transition-colors hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      Show them again
                    </button>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
