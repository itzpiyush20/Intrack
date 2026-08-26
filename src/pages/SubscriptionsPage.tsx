// ============================================
// SubscriptionsPage — Smart Subscriptions Tracker
// Detects, aggregates, and manages recurring payments
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { Card, Button, Badge, Input, EmptyState } from '@/components/ui'
import { RefreshCw, FileText } from 'lucide-react'
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

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Smart Subscriptions</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Auto-detect active streaming, broadband, and billing cycles, and track upcoming renewals.
          </p>
        </div>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="h-40 skeleton"><div /></Card>
            <Card className="h-60 skeleton md:col-span-2"><div /></Card>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {/* Left Column: Summary Card and Manual Creator — ordered after the
                calendar on mobile since the calendar is why someone opens this page */}
            <div className="md:col-span-1 space-y-6 order-2 md:order-1">
              {/* Summary */}
              <Card className="border-border-subtle bg-surface-1 shadow-md p-6">
                <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">Total Subscriptions</h2>
                <div className="flex flex-col gap-1">
                  <span className="text-3xl font-extrabold tracking-tight text-white">
                    {formatCurrency(totalMonthlyOutflow)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    accumulated monthly across {detectedSubs.length} active plans.
                  </span>
                </div>
              </Card>

              {/* Duplicate Alerts */}
              {(activeMusic.length > 1 || activeVideo.length > 2) && (
                <Card className="border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    ⚠️ Optimization Suggestions
                  </h3>
                  <div className="space-y-2 text-xs text-zinc-300 leading-relaxed">
                    {activeMusic.length > 1 && (
                      <p>
                        You hold multiple active music subscriptions: <strong>{activeMusic.map(m => m.merchant).join(', ')}</strong>. You could save up to {formatCurrency(activeMusic.reduce((sum, s) => sum + s.amount, 0) - activeMusic[0].amount)}/mo by consolidating into one provider.
                      </p>
                    )}
                    {activeVideo.length > 2 && (
                      <p>
                        You have {activeVideo.length} streaming video services active. Consider cycling subscriptions (subscribing only when watching specific releases) to reduce passive cash drainage.
                      </p>
                    )}
                  </div>
                </Card>
              )}

              {/* Creator Form */}
              <Card className="border border-border-subtle bg-surface-1 shadow-md">
                <h2 className="text-sm font-bold text-zinc-200 mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-400 shrink-0" />
                  Add Manual Subscription
                </h2>
                
                <form onSubmit={handleAddManualSub} className="space-y-4">
                  {formError && (
                    <div className="text-xs p-2.5 bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] text-[var(--status-danger-text)] rounded-xl">
                      {formError}
                    </div>
                  )}
                  {formSuccess && (
                    <div className="text-xs p-2.5 bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] text-[var(--status-positive-text)] rounded-xl">
                      Subscription registered successfully!
                    </div>
                  )}

                  <Input
                    label="Subscription / Service"
                    placeholder="e.g. Netflix Premium"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    required
                  />

                  <Input
                    label={`Monthly Price (${currencySymbol})`}
                    type="number"
                    placeholder="649"
                    value={subAmount}
                    onChange={(e) => setSubAmount(e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Category
                      </label>
                      <Select
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                      >
                        <option value="Subscriptions">🔄 Subscriptions</option>
                        <option value="Utilities & Bills">💡 Utilities</option>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Renewal Day (of month)
                      </label>
                      <select
                        value={subRenewalDay}
                        onChange={(e) => setSubRenewalDay(Number(e.target.value))}
                        className="w-full bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>Day {d}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <Button type="submit" block size="sm">
                    Register Subscription
                  </Button>
                </form>
              </Card>
            </div>

            {/* Right Column: Active Subscriptions List */}
            <div className="md:col-span-2 order-1 md:order-2">
              <Card className="border-border-subtle bg-surface-1 shadow-md">
                <h2 className="text-base font-bold text-zinc-200 mb-4 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-brand-400 shrink-0" />
                  Subscription Renewal Calendar
                </h2>

                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                  <input
                    type="search"
                    placeholder="Search subscriptions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-surface-2 border border-border-subtle/50 text-zinc-200 text-xs rounded-xl px-3 h-11 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    aria-label="Search subscriptions"
                  />
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="bg-surface-2 border border-border-subtle/50 text-zinc-300 text-xs rounded-xl px-3 h-11 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                    aria-label="Filter by category"
                  >
                    <option value="all">All Categories</option>
                    {uniqueSubCategories.map((code) => {
                      const meta = getStyle(code)
                      return (
                        <option key={code} value={code}>
                          {`${meta.emoji} ${meta.label}`}
                        </option>
                      )
                    })}
                  </select>
                  <select
                    value={renewalWindow}
                    onChange={(e) => setRenewalWindow(e.target.value as typeof renewalWindow)}
                    className="bg-surface-2 border border-border-subtle/50 text-zinc-300 text-xs rounded-xl px-3 h-11 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                    aria-label="Filter by renewal window"
                  >
                    <option value="all">Any time</option>
                    <option value="7">Next 7 days</option>
                    <option value="30">Next 30 days</option>
                    <option value="90">Next 90 days</option>
                  </select>
                </div>

                {detectedSubs.length === 0 ? (
                  <EmptyState
                    icon={<RefreshCw className="h-8 w-8 text-zinc-500" />}
                    title="No subscriptions detected"
                    description="Add a recurring expense manually, or scan your bank alerts to detect them automatically."
                    action={
                      <Link to="/expenses" state={{ openForm: true }}>
                        <Button size="sm">Add an expense</Button>
                      </Link>
                    }
                  />
                ) : visibleSubs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">
                    No subscriptions match your filters.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleSubs.map((sub, idx) => {
                      const categoryMeta = getStyle(sub.category)

                      let badgeVariant: 'success' | 'warning' | 'danger' = 'success'
                      if (sub.daysToRenewal <= 2) badgeVariant = 'danger'
                      else if (sub.daysToRenewal <= 7) badgeVariant = 'warning'

                      const freqLabel = sub.frequency === 'monthly' ? 'Monthly'
                        : sub.frequency === 'quarterly' ? 'Quarterly'
                        : sub.frequency === 'annual' ? 'Annual'
                        : 'Recurring'

                      return (
                        <div
                          key={`${sub.merchant}-${idx}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-surface-2/40 border border-border-subtle/30 text-xs hover:bg-surface-2 transition-colors gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-surface-1 flex items-center justify-center text-lg border border-border-subtle/60 shrink-0">
                              {categoryMeta.emoji}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-zinc-200 truncate capitalize">{sub.merchant}</span>
                                {sub.priceChange !== null && (
                                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                                    sub.priceChange > 0
                                      ? 'bg-red-500/15 text-red-400'
                                      : 'bg-emerald-500/15 text-emerald-400'
                                  }`}>
                                    {sub.priceChange > 0 ? '↑' : '↓'} Price {sub.priceChange > 0 ? 'Increased' : 'Decreased'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-zinc-500">
                                  Last billed: {formatDate(sub.lastBilled)}
                                </span>
                                <span className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded-full">
                                  {freqLabel} · {sub.timesCharged}× charged
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center flex-wrap gap-2 sm:gap-4 justify-between sm:justify-end">
                            <div className="flex flex-col items-end">
                              <span className="font-extrabold text-zinc-100">{formatCurrency(sub.amount)}</span>
                              <span className="text-xs text-zinc-500">{freqLabel.toLowerCase()}</span>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant={badgeVariant}>
                                {sub.daysToRenewal <= 0 ? 'Renews today' : sub.daysToRenewal === 1 ? 'Renews tomorrow' : `Renews in ${sub.daysToRenewal}d`}
                              </Badge>
                              <span className="text-xs text-zinc-500">
                                Date: {formatDate(sub.nextRenewal)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => hideSubscription(sub.merchant)}
                              title="Not a subscription — hide from this list (keeps the expense)"
                              aria-label={`Remove ${sub.merchant} from subscriptions`}
                              className="shrink-0 ml-auto sm:ml-0 h-10 w-10 flex items-center justify-center rounded-lg border border-border-subtle/50 bg-surface-1 text-zinc-500 hover:text-[var(--status-danger-text)] hover:border-[var(--status-danger-border)] hover:bg-[var(--status-danger-subtle)] transition-colors cursor-pointer text-sm leading-none"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {ignoredKeys.length > 0 && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border-subtle/50 bg-surface-2/30 px-4 py-2.5">
                    <span className="text-[11px] text-zinc-500">
                      {ignoredKeys.length} item{ignoredKeys.length > 1 ? 's' : ''} hidden as “not a subscription”. Their expenses are still tracked.
                    </span>
                    <button
                      type="button"
                      onClick={restoreAllSubscriptions}
                      className="shrink-0 text-[11px] font-semibold text-brand-400 hover:text-brand-300 transition-colors cursor-pointer"
                    >
                      Restore all
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
