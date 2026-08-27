// ============================================
// DashboardPage — Premium Financial Dashboard
// Displays stats, spending breakdown, recent txns
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
import { useNextScan } from '@/hooks'
import { Card, Button, EmptyState, Modal, DateFilterPicker, TransactionIdentity } from '@/components/ui'
import ActiveSubscriptionsWidget from '@/components/dashboard/ActiveSubscriptionsWidget'
import QuickAddWidget from '@/components/dashboard/QuickAddWidget'
import ReceivablesCard from '@/components/dashboard/ReceivablesCard'
import InsurancePremiumCard from '@/components/dashboard/InsurancePremiumCard'
import {
  AlertTriangle,
  RefreshCw,
  Crown,
  DollarSign,
  BarChart2,
  Settings,
  TrendingUp,
  TrendingDown,
  Shield,
  CreditCard,
  Wallet,
  Sparkles,
  X,
  Flame,
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { getTransactions, fetchAllTransactions, getMonthlySummary, getSummary, getLoggingStreak } from '@/services/transactions'
import { getBudgets } from '@/services/budgets'
import { detectAnomalies } from '@/services/aiService'
import {
  supabase,
  scanRealGmailInbox,
  formatScanProgress,
} from '@/services'
import { migrateLocalStorageRulesToDB } from '@/services/learningEngine'
import { formatCurrency, formatCurrencyCompact, getCurrentMonth, formatDate, withTimeout, resolveDateFilter, formatDateFilterLabel, getMonthsInRange, resolveTransactionIdentity, creditCardBillCategoryNames, makeIsCreditCardBill, CREDIT_CARD_BILL_LEGACY_NAME, HOME_CURRENCY, formatNextScanTime, type DateFilter } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import { useCategories } from '@/context/CategoriesContext'
import type { Database } from '@/types/database'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

interface SummaryData {
  total_income: number
  total_expenses: number
  savings: number
  category_breakdown: Array<{
    category: string
    amount: number
    count: number
    percentage: number
  }>
  /** Totals for currencies outside INR, kept out of the figures above. */
  other_currency_totals?: Record<string, { income: number; expenses: number }>
}

interface SyncSummary {
  total: number
  autoApproved: number
  pendingReview: number
  topCategory?: { label: string; amount: number }
}

/** Kept in step with detectAnomalies by derivation — this shape used to be
 * spelled out by hand and silently fell behind when the function gained fields. */
type DetectedAnomaly = ReturnType<typeof detectAnomalies>[number]

export default function DashboardPage() {
  const { user, profile, hasGoogleToken, notifyGoogleTokenCleared } = useAuth()
  const { getStyle, categories, loading: categoriesLoading } = useCategories()
  // `undefined` while the category list is still loading — an empty array would
  // mean "the user has tagged nothing", which would stop excluding credit card
  // bills and silently inflate expense totals for the first render. undefined
  // makes the helper fall back to the legacy name instead.
  const ccBillCategories = useMemo(
    () => (categoriesLoading ? undefined : creditCardBillCategoryNames(categories)),
    [categories, categoriesLoading]
  )
  const isCreditCardBill = useMemo(() => makeIsCreditCardBill(ccBillCategories), [ccBillCategories])
  const { showToast } = useToast()

  // Helper to extract first name of the user, ignoring standard titles
  const getFirstName = (fullName?: string) => {
    const nameToParse = profile?.full_name || fullName || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Account'
    const parts = nameToParse.trim().split(/\s+/)
    let result = parts[0]
    const cleanWord = (word: string) => word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (parts.length > 1 && ['ca', 'dr', 'mr', 'ms', 'mrs'].includes(cleanWord(parts[0]))) {
      result = parts[1]
    }
    return result
  }

  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [recentTransactions, setRecentTransactions] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [monthBudgetTotal, setMonthBudgetTotal] = useState(0)

  // Calm consistency chip — real logging activity, not app opens
  const [streakInfo, setStreakInfo] = useState<{ streak: number; loggedToday: boolean }>({
    streak: 0,
    loggedToday: false,
  })

  // First-run checklist
  const [checklistDismissed, setChecklistDismissed] = useState(false)
  const [visitedAnalytics, setVisitedAnalytics] = useState(false)

  // Insights teaser — a single top spending anomaly surfaced on the Dashboard
  // so users don't have to visit the Insights page to catch it. Deliberately
  // uses detectAnomalies() (a local, rule-based calculation) rather than
  // generateAIInsights() (the Gemini-backed one): the Dashboard loads on every
  // visit, and burning AI quota for a card most sessions won't even look at
  // isn't worth it. 'loading' while the background fetch is in flight, 'none'
  // once resolved with nothing notable, or the top anomaly itself.
  const [insightsTeaser, setInsightsTeaser] = useState<
    'loading' | 'none' | DetectedAnomaly
  >('loading')

  // Post-sync summary card (replaces plain "sync complete" toast)
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null)


  // Month-end recap — shown once on the first visit of a new month
  const [monthEndRecap, setMonthEndRecap] = useState<{
    month: string
    totalExpenses: number
    totalIncome: number
    topCategory?: { label: string; amount: number }
    priorExpenses: number | null
  } | null>(null)

  // Recent transactions modal state
  const [showAllRecentModal, setShowAllRecentModal] = useState(false)
  const [allRecentTransactions, setAllRecentTransactions] = useState<TransactionRow[]>([])
  const [loadingAllRecent, setLoadingAllRecent] = useState(false)

  const handleOpenRecentModal = async () => {
    setShowAllRecentModal(true)
    setLoadingAllRecent(true)
    try {
      const { data } = await getTransactions({ limit: 15 })
      setAllRecentTransactions(data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingAllRecent(false)
    }
  }

  // Scheduling and Inactivity popup states
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null)
  const [showInactivityBanner, setShowInactivityBanner] = useState(false)
  const [syncingBackground, setSyncingBackground] = useState(false)

  // Same source of truth as PendingPage — see useNextScan. Shown here too so a
  // user who only ever looks at the Dashboard still knows when the next scan is
  // due, now that nothing scans on their behalf.
  const { nextScanAt, quotaExhausted } = useNextScan({
    enabled: !!user,
    refreshKey: lastScanTime,
  })
  const [syncError, setSyncError] = useState<string | null>(null)
  // Shows a "still working" hint once a manual sync runs past a few seconds,
  // so a legitimately slow scan isn't indistinguishable from a frozen one.
  // Superseded by live progress once the engine reports its first phase.
  const [scanTakingLong, setScanTakingLong] = useState(false)
  const [scanProgress, setScanProgress] = useState<string | null>(null)

  // Widget customization states
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [widgets, setWidgets] = useState<Record<string, boolean>>(() => {
    const defaults = { stats: true, breakdown: true, recent: true, subscriptions: true, insights: true, ccbills: true }
    const saved = localStorage.getItem('intrack_dashboard_widgets')
    if (saved) {
      try {
        // Merge onto defaults (not a plain override) so a widget added after a
        // user already saved their config — like `insights` here — still shows
        // up for them instead of silently defaulting to hidden.
        return { ...defaults, ...JSON.parse(saved) }
      } catch (e) {}
    }
    return defaults
  })

  const toggleWidget = (key: string) => {
    const updated = { ...widgets, [key]: !widgets[key] }
    setWidgets(updated)
    localStorage.setItem('intrack_dashboard_widgets', JSON.stringify(updated))
  }

  // Credit card bill payments — tracked on their own tile because they are
  // deliberately excluded from Total Expenses (the purchases behind them were
  // already counted when they happened), which otherwise leaves them invisible
  // on the Dashboard.
  const [showCcBillModal, setShowCcBillModal] = useState(false)
  // The tagged category names to query, with the same conservative fallback
  // makeIsCreditCardBill uses while the category list is still loading.
  const ccBillQueryNames = useMemo(
    () => ccBillCategories ?? [CREDIT_CARD_BILL_LEGACY_NAME],
    [ccBillCategories]
  )
  // Result is stamped with the query it answers, so "loading" is derived from a
  // stale stamp rather than a flag flipped inside the effect. That keeps a
  // filter change from showing the previous period's payments for a frame.
  const ccBillQueryKey = useMemo(() => {
    const { dateFrom, dateTo } = resolveDateFilter(dateFilter)
    return JSON.stringify([dateFrom, dateTo, ccBillQueryNames])
  }, [dateFilter, ccBillQueryNames])
  const [ccBills, setCcBills] = useState<{ key: string; rows: TransactionRow[] } | null>(null)
  const ccBillLoading = ccBills?.key !== ccBillQueryKey
  const ccBillTxns = ccBillLoading ? [] : ccBills!.rows
  // The headline figure covers the home currency only, for the same reason
  // getSummary does it: the app holds no exchange rates, so adding a dollar
  // bill payment into a rupee total would produce a meaningless number printed
  // with a ₹ sign. Foreign payments are reported on their own below.
  const ccBillHomeTxns = ccBillTxns.filter((t) => (t.currency ?? HOME_CURRENCY) === HOME_CURRENCY)
  const ccBillTotal = ccBillHomeTxns.reduce((sum, t) => sum + Number(t.amount), 0)
  const ccBillForeignTotals = ccBillTxns.reduce<Record<string, number>>((acc, t) => {
    const code = t.currency ?? HOME_CURRENCY
    if (code !== HOME_CURRENCY) acc[code] = (acc[code] || 0) + Number(t.amount)
    return acc
  }, {})

  // Category Details modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string | null>(null)
  const [categoryTransactions, setCategoryTransactions] = useState<TransactionRow[]>([])
  const [loadingCategoryTxns, setLoadingCategoryTxns] = useState(false)
  const [showAllCategories, setShowAllCategories] = useState(false)
  const CATEGORY_BREAKDOWN_PREVIEW_COUNT = 5

  const handleCategoryClick = async (categoryCode: string) => {
    setSelectedCategoryCode(categoryCode)
    setShowCategoryModal(true)
    setLoadingCategoryTxns(true)
    try {
      // fetchAllTransactions, not a capped getTransactions: this modal's header
      // prints the category's full count from `summary`, so a hard limit of 100
      // made the header promise 120 transactions and the list show 100.
      const { data } = await fetchAllTransactions({
        ...resolveDateFilter(dateFilter),
        category: categoryCode,
        type: 'debit',
      })
      // Home currency only, for the same reason getSummary works that way — the
      // total in the header excludes foreign rows, so listing them underneath it
      // would show rows that figure never counted.
      setCategoryTransactions(
        (data || []).filter((t) => (t.currency ?? HOME_CURRENCY) === HOME_CURRENCY)
      )
    } catch (e) {
      console.error('Error loading category transactions:', e)
    } finally {
      setLoadingCategoryTxns(false)
    }
  }

  const fetchDashboardData = useCallback(async (filter: DateFilter, silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const { dateFrom, dateTo } = resolveDateFilter(filter)
      const [summaryRes, transactionsRes, budgetsRes] = await withTimeout(
        Promise.all([
          getSummary({ dateFrom, dateTo }, { creditCardBillCategories: ccBillCategories }),
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
  }, [ccBillCategories])

  /**
   * The user this mount has already run the inactivity check for.
   *
   * This used to guard a background Gmail scan as well: the callback closed
   * over `dateFilter`, so every filter change rebuilt it and re-fired the
   * effect, attempting another scan each time. Automatic scanning was removed
   * on 2026-08-27 (plans/remove-auto-sync.md), so all that remains is the
   * once-per-visit lookup that decides whether to warn the user they have not
   * scanned recently — but it is still a once-per-visit task, so the guard
   * stays.
   */
  const inactivityCheckRanForUser = useRef<string | null>(null)

  const checkScanInactivity = useCallback(async () => {
    if (!user) return
    if (inactivityCheckRanForUser.current === user.id) return
    inactivityCheckRanForUser.current = user.id
    try {
      // Check last scan log to determine inactivity and auto-refresh
      const { data: scanLogs } = await supabase
        .from('email_scan_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'success')
        .order('scanned_at', { ascending: false })
        .limit(1)

      const lastScan = scanLogs && scanLogs.length > 0 ? new Date(scanLogs[0].scanned_at) : null
      setLastScanTime(lastScan)

      const now = new Date()
      // If no scans, or last scan was > 24 hours ago
      if (!lastScan || (now.getTime() - lastScan.getTime() > 24 * 60 * 60 * 1000)) {
        setShowInactivityBanner(true)
      }

    } catch (err) {
      console.error('Error running the scan-inactivity check:', err)
    }
  }, [user])

  useEffect(() => {
    document.title = `Dashboard | ${APP_CONFIG.APP_NAME}`
    fetchDashboardData(dateFilter)
    // One-time migration of localStorage merchant rules to Supabase DB
    if (user && !sessionStorage.getItem('intrack_ls_migration_done')) {
      migrateLocalStorageRulesToDB(user.id).catch(console.warn)
    }
  }, [dateFilter, fetchDashboardData])

  useEffect(() => {
    if (user) {
      checkScanInactivity()
    }
  }, [user, checkScanInactivity])

  // ── "Still working" hint for slow-but-live manual syncs ──
  useEffect(() => {
    if (!syncingBackground) {
      setScanTakingLong(false)
      return
    }
    const timer = setTimeout(() => setScanTakingLong(true), 6000)
    return () => clearTimeout(timer)
  }, [syncingBackground])

  const refreshStreak = useCallback(async () => {
    if (!user) return
    const { data } = await getLoggingStreak()
    setStreakInfo(data)
  }, [user])

  // Calm consistency chip + first-run checklist bookkeeping
  useEffect(() => {
    if (!user) return
    refreshStreak()
    setChecklistDismissed(localStorage.getItem(`intrack_checklist_dismissed_${user.id}`) === 'true')
    setVisitedAnalytics(localStorage.getItem(`intrack_visited_analytics_${user.id}`) === 'true')
  }, [user, refreshStreak])

  // Insights teaser fetch — intentionally decoupled from fetchDashboardData
  // (which only pulls 5 recent transactions) since anomaly detection needs a
  // few months of per-category history. Runs independently in the background
  // so it never blocks or delays the main dashboard render.
  useEffect(() => {
    // Wait for the category list. detectAnomalies runs on rows this effect has
    // already filtered, so firing before `ccBillCategories` resolves would both
    // use the legacy card-bill fallback and cost a second full fetch when it
    // lands.
    if (!user || !widgets.insights || categoriesLoading) return
    let cancelled = false

    const fourMonthsAgo = new Date()
    fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)

    // fetchAllTransactions, not getTransactions: an unlimited getTransactions
    // returns at most PostgREST's db-max-rows (1000) with no way to tell a
    // complete answer from a truncated one, and the rows it drops are the
    // OLDEST — which is exactly the baseline detectAnomalies divides by. A
    // heavy user's baseline would silently shrink and every spike percentage
    // would inflate with it.
    fetchAllTransactions({
      type: 'debit',
      dateFrom: toISODateLocal(fourMonthsAgo),
      dateTo: toISODateLocal(new Date()),
    })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setInsightsTeaser('none')
          return
        }
        // detectAnomalies has no notion of either exclusion, so both are
        // applied here:
        //  - credit card bill payments are not spending (the purchases behind
        //    them were counted when they happened), so a big bill month must
        //    not surface as "Credit Card Bill spending is up 140%".
        //  - foreign-currency rows would be added into rupee totals and
        //    printed with a ₹ sign, the same reason getSummary keeps them out.
        const rows = data.filter(
          (t) =>
            (t.currency ?? HOME_CURRENCY) === HOME_CURRENCY && !isCreditCardBill(t.category)
        )
        const [topAnomaly] = detectAnomalies(
          rows.map((t) => ({ ...t, merchant: t.merchant || '' }))
        )
        setInsightsTeaser(topAnomaly || 'none')
      })
      .catch(() => {
        if (!cancelled) setInsightsTeaser('none')
      })

    return () => {
      cancelled = true
    }
  }, [user, widgets.insights, categoriesLoading, isCreditCardBill])

  // Credit card bill payments for the selected period. Fetched separately from
  // fetchDashboardData because getSummary deliberately strips these rows out —
  // asking it for them would mean undoing the exclusion that makes the expense
  // total correct. Queried per tagged category name rather than by fetching
  // everything and filtering client-side, so a busy period can't push the bills
  // past the row limit.
  useEffect(() => {
    if (!user || !widgets.ccbills) return
    let cancelled = false

    const { dateFrom, dateTo } = resolveDateFilter(dateFilter)
    const key = ccBillQueryKey

    // Paged, not capped at 100 per category: the tile's headline total and the
    // modal's list are both built from these rows, so a truncated fetch would
    // under-report the total as well as hide payments.
    Promise.all(
      ccBillQueryNames.map((category) =>
        fetchAllTransactions({ dateFrom, dateTo, category, type: 'debit' })
      )
    )
      .then((results) => {
        if (cancelled) return
        const rows = results.flatMap((r) => r.data || [])
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        setCcBills({ key, rows })
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Error loading credit card bill payments:', e)
        // Stamped as answered so the tile settles on an empty result instead of
        // spinning forever.
        setCcBills({ key, rows: [] })
      })

    return () => {
      cancelled = true
    }
  }, [user, widgets.ccbills, dateFilter, ccBillQueryNames, ccBillQueryKey])

  // Month-end recap — the peak-end rule says a session that closes on a
  // summary is remembered better, and it's a good reason to open the app
  // again next month. Fires once, the first time the app is opened in a
  // new calendar month, recapping the month that just ended.
  useEffect(() => {
    if (!user) return
    // Wait for the category list before doing anything — including stamping the
    // marker below. getMonthlySummary needs `ccBillCategories` to know which
    // rows are credit-card bill payments, and with it still undefined the
    // helper falls back to the legacy category name, quietly folding bill
    // payments into "Total spent". This effect stamps localStorage and so runs
    // exactly once a month: get it wrong and it stays wrong for the month.
    if (categoriesLoading) return
    const key = `intrack_last_seen_month_${user.id}`
    const lastSeen = localStorage.getItem(key)
    const current = getCurrentMonth()

    if (lastSeen && lastSeen !== current) {
      const priorMonth = (() => {
        const [y, m] = lastSeen.split('-').map(Number)
        const d = new Date(y, m - 2, 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      })()

      Promise.all([
        getMonthlySummary(lastSeen, { creditCardBillCategories: ccBillCategories }),
        getMonthlySummary(priorMonth, { creditCardBillCategories: ccBillCategories }),
      ])
        .then(([recapRes, priorRes]) => {
          if (!recapRes.data || recapRes.data.total_expenses === 0) return
          const top = recapRes.data.category_breakdown[0]
          setMonthEndRecap({
            month: lastSeen,
            totalExpenses: recapRes.data.total_expenses,
            totalIncome: recapRes.data.total_income,
            topCategory: top ? { label: getStyle(top.category).label, amount: top.amount } : undefined,
            priorExpenses: priorRes.data ? priorRes.data.total_expenses : null,
          })
        })
        .catch(() => {})
    }

    localStorage.setItem(key, current)
  }, [user, categoriesLoading, ccBillCategories, getStyle])

  const dismissChecklist = () => {
    if (!user) return
    setChecklistDismissed(true)
    localStorage.setItem(`intrack_checklist_dismissed_${user.id}`, 'true')
  }

  const handleManualBannerSync = async () => {
    setSyncingBackground(true)
    setScanProgress(null)
    setSyncError(null)
    try {
      // Use hasGoogleToken from AuthContext — same reactive source as PendingPage
      if (!hasGoogleToken) {
        setSyncError('Google account not connected. Go to Pending Alerts to connect your Google account.')
        return
      }

      const res = await withTimeout(
        scanRealGmailInbox({ onProgress: (p) => setScanProgress(formatScanProgress(p)) }),
        90000,
        'Gmail scan'
      )
      if (res.error) {
        // If token expired, update AuthContext state so the whole app knows
        if (res.error.message?.includes('expired') || res.error.message?.includes('TOKEN_EXPIRED')) {
          notifyGoogleTokenCleared()
          setSyncError('Your Google session expired. Go to Pending Alerts → click "Reconnect Google" to refresh your access.')
        } else {
          setSyncError(res.error.message || 'Sync failed. Please try again.')
        }
        return
      }

      setShowInactivityBanner(false)
      setSyncError(null)

      const txns = res.data?.transactions || []
      const autoApproved = res.data?.autoApprovedCount || 0
      const categoryTotals = new Map<string, number>()
      txns
        .filter((t: any) => t.type === 'debit' && !isCreditCardBill(t.category))
        .forEach((t: any) => {
          categoryTotals.set(t.category, (categoryTotals.get(t.category) || 0) + Number(t.amount))
        })
      let topCategory: SyncSummary['topCategory']
      if (categoryTotals.size > 0) {
        const [code, amount] = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]
        const label = getStyle(code).label
        topCategory = { label, amount }
      }

      setSyncSummary({
        total: txns.length,
        autoApproved,
        pendingReview: txns.length - autoApproved,
        topCategory,
      })
      fetchDashboardData(dateFilter)
    } catch (e: any) {
      const msg: string = e.message || 'Sync failed. Please try again.'
      // withTimeout's generic copy says to refresh the page; wrong here, since
      // the scan keeps running and incremental flushing preserves its results.
      setSyncError(
        msg.includes('timed out')
          ? 'Sync is taking longer than expected. Anything already found has been saved — sync again to pick up where it left off.'
          : msg
      )
    } finally {
      setSyncingBackground(false)
      setScanProgress(null)
    }
  }

  const formatMonthName = (monthStr: string) => {
    const [year, mon] = monthStr.split('-').map(Number)
    return new Date(year, mon - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    })
  }

  // Calculate savings percentage
  // Not clamped at zero: an overspent period genuinely has a negative savings
  // rate, and reporting it as "0%" beside a red negative figure reads as a bug.
  // The progress bar still clamps — a bar cannot be negative — but the number
  // tells the truth.
  const savingsRate =
    summary && summary.total_income > 0
      ? Math.min(100, (summary.savings / summary.total_income) * 100)
      : 0

  const isCurrentMonth = dateFilter.mode === 'month' && dateFilter.month === getCurrentMonth()

  // Most-used categories this month, for Quick-Add's one-tap chips
  const topCategories = (summary?.category_breakdown || [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((c) => c.category)

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        {/* Top welcome & Month selector */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
              Hello, {getFirstName()}
            </h1>
            <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-sm text-zinc-400">
                Here is your wealth overview{dateFilter.mode === 'month' ? ' for this month' : ''}.
              </p>
              {streakInfo.streak > 1 && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-surface-2 border border-border-subtle/50 text-xs font-semibold text-zinc-400">
                  <Flame className="h-3 w-3 shrink-0" /> {streakInfo.streak} day streak
                </span>
              )}
            </div>
          </div>

          {/* Month Navigator & Customize Controls */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfigModal(true)}
              className="hover:bg-surface-2 h-11 px-3.5 rounded-xl border border-border-subtle/50 text-xs font-semibold text-zinc-300 gap-1.5 flex items-center justify-center cursor-pointer"
              title="Configure Dashboard Widgets"
            >
              <Settings className="h-3.5 w-3.5" /> Customize
            </Button>

            <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        {syncSummary && (
          <div role="status" className="rounded-2xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-4 text-sm text-[var(--status-positive-text)] flex items-start justify-between gap-3 animate-fade-in shadow-md">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {syncSummary.total === 0
                    ? 'Sync complete — no new transactions found.'
                    : `${syncSummary.total} new transaction${syncSummary.total === 1 ? '' : 's'} found.`}
                </p>
                {syncSummary.total > 0 && (
                  <p className="text-xs opacity-80 mt-1">
                    {syncSummary.autoApproved} auto-approved
                    {syncSummary.pendingReview > 0 ? `, ${syncSummary.pendingReview} waiting for your review` : ''}
                    {syncSummary.topCategory
                      ? ` · biggest category: ${syncSummary.topCategory.label} (${formatCurrency(syncSummary.topCategory.amount)})`
                      : ''}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setSyncSummary(null)}
              className="shrink-0 h-10 w-10 flex items-center justify-center -m-2 rounded-lg opacity-70 hover:opacity-100 hover:bg-surface-2/60 transition-all"
              aria-label="Dismiss sync summary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Current month only: monthBudgetTotal follows the period picker, so
            browsing an older month with no budget set used to bring the whole
            first-run checklist back for an established user. */}
        {!checklistDismissed && isCurrentMonth && (recentTransactions.length === 0 || monthBudgetTotal === 0) && (
          <Card className="relative overflow-hidden shadow-md animate-fade-in">
            <button
              onClick={dismissChecklist}
              className="absolute top-2 right-2 h-10 w-10 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-surface-2/60 transition-colors"
              aria-label="Dismiss checklist"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-bold text-text-primary">Get set up in 3 steps</h2>
            <p className="text-xs text-zinc-500 mt-0.5 mb-4">A quick tour of what makes Intrack useful.</p>
            <div className="space-y-3">
              {[
                {
                  done: recentTransactions.length > 0,
                  label: 'Add your first transaction',
                  hint: 'Connect Gmail on Pending Alerts, or add one manually.',
                  to: recentTransactions.length > 0 ? null : '/expenses',
                },
                {
                  done: monthBudgetTotal > 0,
                  label: 'Set a monthly budget',
                  hint: 'Pick one category to start — you can add more later.',
                  to: monthBudgetTotal > 0 ? null : '/budgets',
                },
                {
                  done: visitedAnalytics,
                  label: 'Explore your Insights',
                  hint: 'See trends, forecasts, and where your money goes.',
                  // '/analytics' is not a route — App.tsx's catch-all redirected
                  // this straight out of the app to the marketing landing page.
                  to: visitedAnalytics ? null : '/insights',
                },
              ].map((step) => (
                <div key={step.label} className="flex items-center gap-3">
                  {step.done ? (
                    <CheckCircle2 className="h-4.5 w-4.5 text-[var(--status-positive-text)] shrink-0" />
                  ) : (
                    <Circle className="h-4.5 w-4.5 text-zinc-600 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${step.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                      {step.label}
                    </p>
                    {!step.done && <p className="text-xs text-zinc-500">{step.hint}</p>}
                  </div>
                  {step.to && (
                    <Link to={step.to}>
                      <Button size="md" variant="secondary" className="shrink-0 text-xs">
                        Go
                      </Button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Foreign spend is deliberately excluded from the INR figures above —
            the app holds no exchange rates, and summing mixed currencies would
            produce a meaningless number. Excluding it silently would be its own
            kind of wrong, so it is reported here instead. */}
        {summary?.other_currency_totals && Object.keys(summary.other_currency_totals).length > 0 && (
          <div role="note" className="rounded-2xl border border-border-subtle bg-surface-1 p-4 text-sm animate-fade-in">
            <p className="font-semibold text-zinc-200">Also spent in other currencies</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Not included in the totals above — Intrack does not convert between currencies.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(summary.other_currency_totals).map(([code, totals]) => (
                <span key={code} className="text-sm font-mono text-zinc-300">
                  {totals.expenses > 0 && <>{formatCurrency(totals.expenses, code)} spent</>}
                  {totals.expenses > 0 && totals.income > 0 && ' · '}
                  {totals.income > 0 && <>{formatCurrency(totals.income, code)} received</>}
                </span>
              ))}
            </div>
          </div>
        )}

        {showInactivityBanner && (
          <div role="alert" className="rounded-2xl bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] p-4 text-sm text-[var(--status-warning-text)] flex flex-col gap-3 animate-fade-in shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-text-primary">
                    {profile?.subscription_status === 'trial' ? 'Trial Active — Gmail Sync Unlocked' : 'Refresh Alert — Action Required'}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                    {profile?.subscription_status === 'trial'
                      ? `Your transaction tracker is active in full trial mode. Last sync: ${lastScanTime ? lastScanTime.toLocaleString('en-IN') : 'Never'}. Click Sync Now to fetch new alerts.`
                      : `Your transaction tracker has not refreshed in the last 24 hours (last sync: ${lastScanTime ? lastScanTime.toLocaleString('en-IN') : 'Never'}). Click Sync Now to import the latest bank alerts.`}
                  </p>
                  {syncingBackground && (scanProgress || scanTakingLong) && (
                    <p role="status" className="text-xs text-zinc-500 mt-1">
                      {scanProgress ?? 'Still syncing — large inboxes can take up to a minute…'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-[var(--status-warning-text)] border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] hover:bg-[var(--status-warning-border)] hover:border-[var(--status-warning-text)]/40 transition-all text-xs justify-center gap-1.5"
                  onClick={handleManualBannerSync}
                  loading={syncingBackground}
                  disabled={syncingBackground}
                >
                  <RefreshCw className="h-3.5 w-3.5 animate-spin-slow" /> Sync Now
                </Button>
                {nextScanAt && (
                  <span className="text-xs font-semibold text-brand-300 bg-surface-2 border border-border-subtle/50 px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                    Next scan {formatNextScanTime(nextScanAt)}
                    <span className="text-zinc-500 font-normal">
                      {quotaExhausted ? '· allowance used' : '· 4-hour gap'}
                    </span>
                  </span>
                )}
                {(profile?.subscription_status === 'trial' || (profile?.subscription_status === 'active' && profile?.subscription_plan_type === 'monthly')) && (
                  <Link to="/pricing" className="shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-brand-300 border-brand-500/20 bg-brand-500/5 hover:bg-brand-500/10 hover:border-brand-500/35 transition-all text-xs justify-center font-bold gap-1.5"
                    >
                      <Crown className="h-3.5 w-3.5" /> Upgrade to Yearly
                    </Button>
                  </Link>
                )}
              </div>
            </div>
            {syncError && (
              <div className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] px-3 py-2 text-xs text-[var(--status-danger-text)] flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="flex-1 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-status-danger shrink-0" />
                  {syncError}
                </span>
                {(syncError.includes('expired') || syncError.includes('connected')) && (
                  <Link
                    to="/pending"
                    className="shrink-0 text-xs font-semibold text-[var(--status-danger-text)] underline underline-offset-2 hover:opacity-80 transition-colors"
                  >
                    Go to Pending Alerts →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {isCurrentMonth && (
          <>
            <QuickAddWidget
              topCategories={topCategories}
              onAdded={() => {
                fetchDashboardData(dateFilter)
                refreshStreak()
              }}
            />

            {!loading && !streakInfo.loggedToday && (
              <p className="text-xs text-zinc-500 -mt-4">
                Log an expense today to {streakInfo.streak > 0 ? 'keep' : 'start'} your streak.
              </p>
            )}

            <ReceivablesCard onSettled={() => fetchDashboardData(dateFilter)} />
            <InsurancePremiumCard onPaid={() => fetchDashboardData(dateFilter)} />
          </>
        )}

        {/* Stats summary section */}
        {widgets.stats && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading ? (
              // Skeleton for stats
              [1, 2, 3].map((i) => (
                <Card key={i} className="relative overflow-hidden h-32">
                  <div className="skeleton absolute inset-0 opacity-70" />
                </Card>
              ))
            ) : (
              <>
                {/* Income card */}
                <Card className="relative overflow-hidden bg-surface-1 group shadow-md">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <TrendingUp className="h-10 w-10 text-status-positive" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Total Income
                  </p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-[var(--status-positive-text)] animate-slide-up stagger-1">
                    {formatCurrency(summary?.total_income || 0)}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
                    <span>Earned {dateFilter.mode === 'month' ? 'this month' : 'in this period'}</span>
                  </div>
                </Card>

                {/* Expenses card — a neutral fact, not a warning */}
                <Card className="relative overflow-hidden bg-surface-1 group shadow-md">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <TrendingDown className="h-10 w-10 text-zinc-400" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Total Expenses
                  </p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-text-primary animate-slide-up stagger-2">
                    {formatCurrency(summary?.total_expenses || 0)}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
                    <span>Spent {dateFilter.mode === 'month' ? 'this month' : 'in this period'}</span>
                  </div>
                </Card>

                {/* Savings card */}
                <Card className="relative overflow-hidden bg-surface-1 group shadow-md sm:col-span-2 lg:col-span-1">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <Shield className="h-10 w-10 text-brand-400" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Net Savings
                  </p>
                  <p
                    className={`mt-2 text-3xl font-bold tracking-tight animate-slide-up stagger-3 ${
                      (summary?.savings || 0) >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'
                    }`}
                  >
                    {formatCurrency(summary?.savings || 0)}
                  </p>
                  {/* Savings progress bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-zinc-500">Savings Rate</span>
                      <span className={`font-semibold ${(summary?.savings || 0) >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'}`}>
                        {savingsRate.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-surface-3 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${(summary?.savings || 0) >= 0 ? 'aurora-progress-fill' : 'bg-[var(--status-danger-text)]'}`}
                        style={{ width: `${Math.max(0, Math.min(100, savingsRate))}%` }}
                      />
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Credit card bills tile — opens the full list in a modal */}
        {widgets.ccbills && (
          <button
            type="button"
            onClick={() => setShowCcBillModal(true)}
            className="w-full text-left flex items-center gap-4 rounded-2xl border border-border-subtle bg-surface-1 shadow-md px-5 py-4 transition-colors hover:bg-surface-2/40 group cursor-pointer"
          >
            <div className="shrink-0 h-10 w-10 rounded-full bg-brand-500/10 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-brand-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Credit Card Bills Paid
              </p>
              {ccBillLoading ? (
                <div className="skeleton h-4 w-2/3 mt-1.5 rounded" />
              ) : (
                <>
                  <p className="text-xl font-bold tracking-tight text-text-primary mt-0.5">
                    {formatCurrency(ccBillTotal)}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {ccBillHomeTxns.length === 0
                      ? ccBillTxns.length > 0
                        // Foreign-currency payments only: ₹0 with a flat "none"
                        // would contradict the list the modal is about to show.
                        ? `Only foreign-currency payments in ${formatDateFilterLabel(dateFilter)} — open to view`
                        : `No bill payments in ${formatDateFilterLabel(dateFilter)}`
                      : `${ccBillHomeTxns.length} payment${ccBillHomeTxns.length === 1 ? '' : 's'} in ${formatDateFilterLabel(dateFilter)} · not counted in Total Expenses`}
                  </p>
                </>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1 text-xs font-semibold text-brand-400 group-hover:text-brand-300">
              <span className="hidden sm:inline">View payments</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </button>
        )}

        {/* Insights teaser — surfaces the top Insights finding here so most
            users never need to leave the Dashboard to catch it. Always
            renders something once resolved (an anomaly, or a "nothing
            unusual" reassurance) rather than disappearing when there's
            nothing to flag — a card that vanishes reads as broken. */}
        {widgets.insights && (
          <Link
            to="/insights"
            className="flex items-center gap-4 rounded-2xl border border-border-subtle bg-surface-1 shadow-md px-5 py-4 transition-colors hover:bg-surface-2/40 group"
          >
            <div className="shrink-0 h-10 w-10 rounded-full bg-brand-500/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-brand-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Insights</p>
              {insightsTeaser === 'loading' ? (
                <div className="skeleton h-4 w-2/3 mt-1.5 rounded" />
              ) : insightsTeaser === 'none' ? (
                <p className="text-sm text-zinc-200 mt-0.5 truncate">
                  No unusual spending detected this month — nice and steady.
                </p>
              ) : (
                <p className="text-sm text-zinc-200 mt-0.5 truncate">
                  {(() => {
                    const cat = getStyle(insightsTeaser.category)
                    return (
                      <>
                        <span className="font-semibold">{cat.emoji} {cat.label}</span> spending is
                        {insightsTeaser.isProjection ? ' on track to be up ' : ' up '}
                        <span className="font-semibold text-[var(--status-warning-text)]">
                          {Math.round(insightsTeaser.spike)}%
                        </span>{' '}
                        this month — {formatCurrency(insightsTeaser.projectedMonth)}
                        {insightsTeaser.isProjection ? ' projected' : ''} vs a{' '}
                        {formatCurrency(insightsTeaser.baseline)} average.
                      </>
                    )
                  })()}
                </p>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1 text-xs font-semibold text-brand-400 group-hover:text-brand-300">
              <span className="hidden sm:inline">View Insights</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        )}

        {/* Details breakdown */}
        {(widgets.breakdown || widgets.recent) && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left panel: Category breakdown */}
            {widgets.breakdown && (
              <Card className={`${widgets.recent ? 'lg:col-span-7' : 'lg:col-span-12'} flex flex-col h-auto`}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-text-primary">Spending Breakdown</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Where your money went{dateFilter.mode === 'month' ? ' this month' : ' in this period'}
                    </p>
                  </div>
                  {summary && summary.category_breakdown.length > CATEGORY_BREAKDOWN_PREVIEW_COUNT && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-brand-400 hover:text-brand-300 font-semibold h-10 px-2"
                      onClick={() => setShowAllCategories((prev) => !prev)}
                    >
                      {showAllCategories ? 'Show Less' : 'View All'}
                    </Button>
                  )}
                </div>

                <div className="flex-1 flex flex-col justify-center">
                  {loading ? (
                    // Skeleton breakdown
                    <div className="space-y-6 py-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="space-y-2">
                          <div className="flex justify-between">
                            <div className="skeleton h-4 w-1/3" />
                            <div className="skeleton h-4 w-12" />
                          </div>
                          <div className="skeleton h-2 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : !summary || summary.category_breakdown.length === 0 ? (
                    <EmptyState
                      icon={<BarChart2 className="h-8 w-8 text-zinc-500" />}
                      title="No expenses tracked"
                      description={dateFilter.mode === 'month'
                        ? 'Add an expense in the selected month to see your breakdown chart.'
                        : 'No expenses fall in this date range yet.'}
                    />
                  ) : (
                    <div className="space-y-5 py-2">
                      {(showAllCategories
                        ? summary.category_breakdown
                        : summary.category_breakdown.slice(0, CATEGORY_BREAKDOWN_PREVIEW_COUNT)
                      ).map((item, idx) => {
                        const cat = getStyle(item.category)
                        return (
                          <button
                            key={item.category}
                            onClick={() => handleCategoryClick(item.category)}
                            className="w-full text-left block space-y-1.5 p-2 -mx-2 rounded-xl transition-all duration-200 cursor-pointer hover:bg-surface-2/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700/60 animate-slide-up"
                            style={{ animationDelay: `${idx * 0.05}s` }}
                          >
                            <div className="flex items-center justify-between">
                              {/* Label & Icon */}
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{cat.emoji}</span>
                                <span className="text-sm font-medium text-zinc-200">
                                  {cat.label}
                                </span>
                                <span className="text-xs text-zinc-500 font-normal">
                                  ({item.count}txn)
                                </span>
                              </div>

                              {/* Amount & Percentage */}
                              <div className="text-right">
                                <span className="text-sm font-semibold text-zinc-200">
                                  {formatCurrency(item.amount)}
                                </span>
                                <span className="text-xs text-zinc-500 ml-2 font-normal">
                                  {item.percentage.toFixed(0)}%
                                </span>
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div className="h-2 w-full bg-surface-3 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700 ease-out"
                                style={{
                                  width: `${item.percentage}%`,
                                  backgroundColor: cat.color,
                                }}
                              />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Right panel: Recent Transactions */}
            {widgets.recent && (
              <Card className={`${widgets.breakdown ? 'lg:col-span-5' : 'lg:col-span-12'} flex flex-col h-auto`} noPadding>
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-text-primary">Recent Activity</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Your globally recent transactions</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-brand-400 hover:text-brand-300 font-semibold h-10 px-2"
                    onClick={handleOpenRecentModal}
                  >
                    View All
                  </Button>
                </div>

                <div className="flex-1 flex flex-col justify-center border-t border-border-subtle">
                  {loading ? (
                    // Skeleton Transactions
                    <div className="space-y-4 p-5">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="skeleton h-9 w-9 rounded-xl shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <div className="skeleton h-3.5 w-2/3" />
                            <div className="skeleton h-2.5 w-1/3" />
                          </div>
                          <div className="skeleton h-4 w-14" />
                        </div>
                      ))}
                    </div>
                  ) : recentTransactions.length === 0 ? (
                    <div className="p-5 flex-1 flex flex-col justify-center items-center">
                      <EmptyState
                        icon={<DollarSign className="h-8 w-8 text-zinc-500" />}
                        title="No transactions yet"
                        description="Record a transaction to see your recent activity."
                      />
                      <Link to="/expenses" className="mt-4">
                        <Button size="sm">Add First Transaction</Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="divide-y divide-border-subtle flex-1 flex flex-col justify-between">
                      <div>
                        {recentTransactions.map((txn, idx) => {
                          const cat = getStyle(txn.category)
                          const isDebit = txn.type === 'debit'

                          return (
                            <div
                              key={txn.id}
                              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/40 animate-slide-up"
                              style={{ animationDelay: `${idx * 0.05}s` }}
                            >
                              {/* Category icon */}
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-md"
                                style={{ backgroundColor: `${cat.color}15` }}
                              >
                                {cat.emoji}
                              </div>

                              {/* Details — resolved identity, never raw narration.
                                  This list used to print txn.description, so the
                                  same payment read "Swiggy" in the modals below
                                  and "UPI/4412/SWIGGY-ORDER-BLR" here. */}
                              <div className="flex-1 min-w-0">
                                <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                                <span className="text-xs text-zinc-500 block mt-0.5">
                                  {formatDate(txn.date)}
                                </span>
                              </div>

                              {/* Amount */}
                              <div className="text-right shrink-0">
                                <p
                                  className={`text-xs font-bold ${
                                    isDebit ? 'text-[var(--status-danger-text)]' : 'text-[var(--status-positive-text)]'
                                  }`}
                                >
                                  {/* Pass the row's own currency — without it a $200
                                      charge renders as "-₹200" here while the
                                      "View All" modal below shows "-$200". */}
                                  {isDebit ? '-' : '+'}{formatCurrencyCompact(Number(txn.amount), txn.currency)}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* 🔄 Subscription Intelligence Widget */}
        {/* Fetches its own 24 months of history — detection needs two charges
            from one merchant, which the 5 recent rows above can never show. */}
        <ActiveSubscriptionsWidget isVisible={widgets.subscriptions} />

        {/* 📋 Recent Activity View All Modal */}
        <Modal
          isOpen={showAllRecentModal}
          onClose={() => setShowAllRecentModal(false)}
          title="Recent Activity"
          footer={
            <Button variant="secondary" onClick={() => setShowAllRecentModal(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">Your past 15 transaction records</p>
            {loadingAllRecent ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-surface-2 animate-pulse">
                    <div className="h-4 w-1/3 bg-zinc-700 rounded" />
                    <div className="h-4 w-12 bg-zinc-700 rounded" />
                  </div>
                ))}
              </div>
            ) : allRecentTransactions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No transactions found.</p>
            ) : (
              <div className="divide-y divide-border-subtle/40">
                {allRecentTransactions.map((txn) => {
                  const cat = getStyle(txn.category)
                  const isDebit = txn.type === 'debit'
                  return (
                    <div key={txn.id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xl shrink-0">{cat.emoji}</span>
                        <div className="min-w-0">
                          <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                          <span className="text-xs text-zinc-500">
                            {new Date(txn.date).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-bold shrink-0 ${
                          isDebit ? 'text-[var(--status-danger-text)]' : 'text-[var(--status-positive-text)]'
                        }`}
                      >
                        {isDebit ? '-' : '+'}{formatCurrency(Number(txn.amount), txn.currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Modal>

        {/* 💳 Credit Card Bill Payments Modal */}
        <Modal
          isOpen={showCcBillModal}
          onClose={() => setShowCcBillModal(false)}
          title="Credit Card Bill Payments"
          footer={
            <Button variant="secondary" onClick={() => setShowCcBillModal(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              {formatDateFilterLabel(dateFilter)} · {formatCurrency(ccBillTotal)} across{' '}
              {ccBillHomeTxns.length} payment{ccBillHomeTxns.length === 1 ? '' : 's'}
            </p>
            {Object.keys(ccBillForeignTotals).length > 0 && (
              <p className="text-xs text-zinc-500">
                Also paid in other currencies, not added to the total above:{' '}
                {Object.entries(ccBillForeignTotals)
                  .map(([code, amount]) => formatCurrency(amount, code))
                  .join(' · ')}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              These are tracked separately from Total Expenses — the purchases behind
              each bill were already counted when they happened.
            </p>
            {ccBillLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-surface-2 animate-pulse">
                    <div className="h-4 w-1/3 bg-zinc-700 rounded" />
                    <div className="h-4 w-12 bg-zinc-700 rounded" />
                  </div>
                ))}
              </div>
            ) : ccBillTxns.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">
                No credit card bill payments in this period. Categorize a transaction as
                a credit card bill to see it here.
              </p>
            ) : (
              <div className="divide-y divide-border-subtle/40">
                {ccBillTxns.map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between py-3">
                    <div className="flex flex-col min-w-0 pr-3">
                      <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                      <span className="text-xs text-zinc-500 mt-1">{formatDate(txn.date)}</span>
                    </div>
                    <span className="text-xs font-bold shrink-0 text-text-primary">
                      {formatCurrency(Number(txn.amount), txn.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        {/* 📊 Category Spending Breakdown Details Modal */}
        {showCategoryModal && selectedCategoryCode && (() => {
          const cat = getStyle(selectedCategoryCode)
          const matchedSummaryItem = summary?.category_breakdown.find(item => item.category === selectedCategoryCode)
          const totalAmount = matchedSummaryItem?.amount || 0
          const totalCount = matchedSummaryItem?.count || 0
          
          const monthLabel = formatDateFilterLabel(dateFilter)
          
          return (
            <Modal
              isOpen={showCategoryModal}
              onClose={() => {
                setShowCategoryModal(false)
                setSelectedCategoryCode(null)
                setCategoryTransactions([])
              }}
              title={`${cat.label} Spending`}
              footer={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCategoryModal(false)
                    setSelectedCategoryCode(null)
                    setCategoryTransactions([])
                  }}
                  className="font-bold text-xs"
                >
                  Close
                </Button>
              }
            >
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">
                  {monthLabel} · {formatCurrency(totalAmount)} total over {totalCount} transaction
                  {totalCount > 1 ? 's' : ''}
                </p>
                {loadingCategoryTxns ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-surface-2 animate-pulse">
                        <div className="space-y-2 w-1/3">
                          <div className="h-4 bg-zinc-700 rounded" />
                          <div className="h-3 bg-zinc-800 rounded w-2/3" />
                        </div>
                        <div className="h-4 w-12 bg-zinc-700 rounded" />
                      </div>
                    ))}
                  </div>
                ) : categoryTransactions.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-8">No transactions found for this category.</p>
                ) : (
                  <div className="divide-y divide-border-subtle/40">
                    {categoryTransactions.map((txn) => (
                      <div key={txn.id} className="flex items-center justify-between py-3">
                        <div className="flex flex-col min-w-0 pr-3">
                          <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                          <span className="text-xs text-zinc-500 mt-1">
                            {new Date(txn.date).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <span className="text-xs font-bold shrink-0 text-[var(--status-danger-text)]">
                          -{formatCurrency(Number(txn.amount), txn.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Modal>
          )
        })()}

        {/* Widget Customization Modal */}
        <Modal
          isOpen={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          title="Customize Dashboard"
          footer={
            <Button variant="secondary" onClick={() => setShowConfigModal(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-400 mb-4">Toggle widgets on or off</p>

            {/* Stats Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Income, Expense & Savings Cards</p>
                  <p className="text-xs text-zinc-500">Summary stats at the top</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.stats}
                onChange={() => toggleWidget('stats')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>

            {/* Spending Breakdown Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <BarChart2 className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Spending Breakdown</p>
                  <p className="text-xs text-zinc-500">Category breakdown for the selected period</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.breakdown}
                onChange={() => toggleWidget('breakdown')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>

            {/* Recent Activity Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Recent Activity List</p>
                  <p className="text-xs text-zinc-500">Show last 5 recorded transactions</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.recent}
                onChange={() => toggleWidget('recent')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>

            {/* Subscription Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Active Subscriptions</p>
                  <p className="text-xs text-zinc-500">Auto-detected recurring services</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.subscriptions}
                onChange={() => toggleWidget('subscriptions')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>

            {/* Credit Card Bills Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Credit Card Bills Paid</p>
                  <p className="text-xs text-zinc-500">Bill payments for the selected period</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.ccbills}
                onChange={() => toggleWidget('ccbills')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>

            {/* Insights Teaser Widget */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-2/40 border border-border-subtle/30">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-brand-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-text-primary">Insights Teaser</p>
                  <p className="text-xs text-zinc-500">Surfaces your top spending anomaly, if any</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={widgets.insights}
                onChange={() => toggleWidget('insights')}
                className="h-4 w-4 rounded border-zinc-700 bg-surface-1 text-brand-500 focus:ring-brand-400 cursor-pointer"
              />
            </div>
          </div>
        </Modal>

        {/* Month-end recap */}
        <Modal
          isOpen={!!monthEndRecap}
          onClose={() => setMonthEndRecap(null)}
          title={monthEndRecap ? `${formatMonthName(monthEndRecap.month)} recap` : 'Recap'}
          footer={
            <Button block onClick={() => setMonthEndRecap(null)} className="justify-center">
              Got it
            </Button>
          }
        >
          {monthEndRecap && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-2/40 border border-border-subtle/30 p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total spent</p>
                  <p className="text-xl font-bold text-text-primary mt-1">{formatCurrency(monthEndRecap.totalExpenses)}</p>
                </div>
                <div className="rounded-xl bg-surface-2/40 border border-border-subtle/30 p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Net saved</p>
                  <p className={`text-xl font-bold mt-1 ${monthEndRecap.totalIncome - monthEndRecap.totalExpenses >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'}`}>
                    {formatCurrency(monthEndRecap.totalIncome - monthEndRecap.totalExpenses)}
                  </p>
                </div>
              </div>

              {monthEndRecap.topCategory && (
                <p className="text-sm text-zinc-300">
                  Biggest category: <strong className="text-text-primary">{monthEndRecap.topCategory.label}</strong> ({formatCurrency(monthEndRecap.topCategory.amount)})
                </p>
              )}

              {monthEndRecap.priorExpenses !== null && monthEndRecap.priorExpenses > 0 && (
                <p className="text-sm text-zinc-300">
                  {monthEndRecap.totalExpenses < monthEndRecap.priorExpenses
                    ? `You spent ${formatCurrency(monthEndRecap.priorExpenses - monthEndRecap.totalExpenses)} less than the month before — nice work.`
                    : `You spent ${formatCurrency(monthEndRecap.totalExpenses - monthEndRecap.priorExpenses)} more than the month before.`}
                </p>
              )}
            </div>
          )}
        </Modal>
      </div>
    </AppLayout>
  )
}
