// ============================================
// DashboardPage — the money screen
//
// Composition rule this page follows: the numbers come first. A person opens
// Intrack to answer "where did my money go", so the period totals sit directly
// under the greeting, and everything that is an action (quick add, a
// receivable to settle) or a detail (breakdown, recent rows) sits below them.
//
// Two things moved for correctness rather than taste:
//  - The foreign-currency note says "not included in the totals above". It used
//    to render ABOVE the totals it was talking about, so "above" pointed at the
//    greeting. It now sits directly under the stats it annotates.
//  - The credit-card-bill tile and the Insights teaser were two identical
//    full-width strips stacked on each other. They are one two-up row now; they
//    are the same kind of object — a one-line finding that links somewhere else.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { AppLayout } from '@/layouts'
import { useNextScan } from '@/hooks'
import {
  Card, Button, EmptyState, Modal, DateFilterPicker, TransactionIdentity, Skeleton,
  staggerParent, staggerChild, rowVariants, transition, SECTION_LABEL, ROW_TILE,
} from '@/components/ui'
import ActiveSubscriptionsWidget from '@/components/dashboard/ActiveSubscriptionsWidget'
import QuickAddWidget from '@/components/dashboard/QuickAddWidget'
import ReceivablesCard from '@/components/dashboard/ReceivablesCard'
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

/**
 * A page-level notice: an error, a scan reminder, the result of a scan.
 *
 * Local to this file on purpose — the brief for this pass forbids adding to
 * `components/ui`. Three banners were being hand-rolled here with three
 * different paddings, two different dismiss-button sizes and an icon that was
 * sometimes decorative and sometimes the only thing carrying the status. One
 * shape, and the status is always said in words as well as shown in colour.
 */
const NOTICE_TONES = {
  danger: {
    surface: 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)]',
    ink: 'text-[var(--status-danger-text)]',
  },
  warning: {
    surface: 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)]',
    ink: 'text-[var(--status-warning-text)]',
  },
  positive: {
    surface: 'bg-[var(--status-positive-subtle)] border-[var(--status-positive-border)]',
    ink: 'text-[var(--status-positive-text)]',
  },
} as const

interface NoticeProps {
  tone: keyof typeof NOTICE_TONES
  icon: typeof AlertTriangle
  title: string
  children?: ReactNode
  /** Buttons and links; laid out under the text on a phone, beside it from sm. */
  actions?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  role?: 'alert' | 'status' | 'note'
}

function Notice({ tone, icon: Icon, title, children, actions, onDismiss, dismissLabel, role }: NoticeProps) {
  const t = NOTICE_TONES[tone]
  return (
    <div role={role} className={`relative rounded-2xl border p-4 sm:p-5 ${t.surface}`}>
      {/* Top-right, out of the flow: in the row it used to sit in, a phone
          stacked it under the text and the close button landed on the left. */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel || 'Dismiss'}
          className={`absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-lg opacity-70 transition-opacity hover:opacity-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${t.ink}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${onDismiss ? 'pr-10 sm:pr-0' : ''}`}>
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${t.ink}`} aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <p className={`text-sm font-semibold ${t.ink}`}>{title}</p>
            {children}
          </div>
        </div>
        {actions && (
          <div className={`flex w-full shrink-0 flex-col gap-2 self-start sm:w-auto sm:flex-row sm:items-center ${onDismiss ? 'sm:mr-10' : ''}`}>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The dashboard's optional sections, in the order they appear on the page.
 *
 * Driven from data so the customise modal cannot drift out of step with what
 * the page actually renders — it previously repeated the same 16-line block six
 * times, and each copy had to be edited by hand when a widget was added.
 */
const WIDGET_OPTIONS = [
  { key: 'stats', icon: Wallet, label: 'Income, expenses and savings', hint: 'The three period totals at the top' },
  { key: 'insights', icon: Sparkles, label: 'Insights finding', hint: 'Your biggest spending change, if there is one' },
  { key: 'ccbills', icon: CreditCard, label: 'Credit card bills paid', hint: 'Bill payments in the selected period' },
  { key: 'breakdown', icon: BarChart2, label: 'Spending breakdown', hint: 'Where the money went, by category' },
  { key: 'recent', icon: DollarSign, label: 'Recent activity', hint: 'Your five most recent transactions' },
  { key: 'subscriptions', icon: RefreshCw, label: 'Active subscriptions', hint: 'Recurring payments detected from your history' },
] as const

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

  // Motion on this page reports one of three things: the sections arriving on
  // first paint, a list row appearing, or a value's bar moving. Every one of
  // them collapses to nothing when the visitor has asked for reduced motion.
  const reduce = useReducedMotion()

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
    document.title = `Home | ${APP_CONFIG.APP_NAME}`
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

  // What the period is called, once, so the greeting, the stat cards and the
  // tiles all name it the same way instead of three variations on "this month".
  const periodLabel = formatDateFilterLabel(dateFilter)

  // The two link tiles sit side by side; with only one turned on it takes the
  // full width rather than leaving a hole where the other one would be.
  const linkTileCount = (widgets.insights ? 1 : 0) + (widgets.ccbills ? 1 : 0)
  const linkTileSpan = linkTileCount === 1 ? 'sm:col-span-2' : ''

  return (
    <AppLayout>
      <motion.div
        variants={staggerParent(reduce, 8)}
        initial="initial"
        animate="animate"
        className="space-y-6 md:space-y-8"
      >
        {/* ── Greeting and period controls ───────────────────────────────
            The controls wrap under the greeting on a phone. DateFilterPicker
            already wraps internally, so at 360px it breaks onto its own lines
            rather than pushing the page wider. */}
        <motion.header variants={staggerChild(reduce)} className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">
              Hello, {getFirstName()}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-sm text-zinc-400">
                {/* A month reads as "in September 2026"; a custom range is a
                    span, not a place, so it takes a comma instead. */}
                What your money did{dateFilter.mode === 'month' ? ' in ' : ', '}
                {periodLabel}.
              </p>
              {streakInfo.streak > 1 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle/50 bg-surface-2 px-2 py-0.5 text-xs font-semibold text-zinc-400">
                  <Flame className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="tnum">{streakInfo.streak}</span> days logged in a row
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
            <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
            <Button
              variant="secondary"
              onClick={() => setShowConfigModal(true)}
              className="h-11 gap-1.5 rounded-xl"
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden="true" /> Customise
            </Button>
          </div>
        </motion.header>

        {/* ── Notices ────────────────────────────────────────────────── */}
        {error && (
          <motion.div variants={staggerChild(reduce)}>
            <Notice
              tone="danger"
              role="alert"
              icon={AlertTriangle}
              title="Your dashboard could not be loaded"
            >
              <p className="text-sm text-[var(--status-danger-text)] leading-relaxed">{error}</p>
            </Notice>
          </motion.div>
        )}

        {syncSummary && (
          <motion.div variants={staggerChild(reduce)}>
            <Notice
              tone="positive"
              role="status"
              icon={CheckCircle2}
              title={
                syncSummary.total === 0
                  ? 'Scan finished — nothing new in your inbox'
                  : `Scan finished — ${syncSummary.total} new transaction${syncSummary.total === 1 ? '' : 's'}`
              }
              onDismiss={() => setSyncSummary(null)}
              dismissLabel="Dismiss scan result"
              actions={
                syncSummary.pendingReview > 0 ? (
                  <Link to="/pending" className="w-full sm:w-auto">
                    <Button variant="secondary" block className="h-11 gap-1.5 sm:w-auto">
                      Review them <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </Button>
                  </Link>
                ) : undefined
              }
            >
              {syncSummary.total > 0 && (
                <p className="text-sm text-[var(--status-positive-text)] opacity-90 leading-relaxed">
                  <span className="tnum">{syncSummary.autoApproved}</span> filed automatically
                  {syncSummary.pendingReview > 0 && (
                    <>
                      , <span className="tnum">{syncSummary.pendingReview}</span> waiting for you in Pending
                    </>
                  )}
                  {syncSummary.topCategory && (
                    <>
                      {' · '}biggest category {syncSummary.topCategory.label}{' '}
                      <span className="tnum">{formatCurrency(syncSummary.topCategory.amount)}</span>
                    </>
                  )}
                </p>
              )}
            </Notice>
          </motion.div>
        )}

        {/* Nothing scans on its own — automatic scanning was removed on
            2026-08-27 — so this is a reminder, not an error. The old copy read
            "Refresh Alert — Action Required", and its trial variant claimed
            Gmail sync was "unlocked", which reads like a free tier. There is
            no free tier: the trial ends and access stops. */}
        {showInactivityBanner && (
          <motion.div variants={staggerChild(reduce)}>
            <Notice
              tone="warning"
              role="status"
              icon={RefreshCw}
              title="Your inbox hasn’t been scanned recently"
              actions={
                <Button
                  onClick={handleManualBannerSync}
                  loading={syncingBackground}
                  block
                  disabled={syncingBackground}
                  className="h-11 gap-1.5 sm:w-auto"
                >
                  {syncingBackground ? 'Scanning…' : 'Scan now'}
                </Button>
              }
            >
              <p className="text-sm text-[var(--status-warning-text)] opacity-90 leading-relaxed">
                Intrack only reads your Gmail when you ask it to. Last scan:{' '}
                <span className="tnum font-medium">
                  {lastScanTime ? lastScanTime.toLocaleString('en-IN') : 'never'}
                </span>
                .
              </p>

              {syncingBackground && (scanProgress || scanTakingLong) && (
                <p role="status" className="text-sm text-[var(--status-warning-text)] opacity-75">
                  {scanProgress ?? 'Still scanning — a large inbox can take up to a minute.'}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
                {nextScanAt && (
                  <span className="text-xs text-[var(--status-warning-text)] opacity-80">
                    Next scan available {formatNextScanTime(nextScanAt)}
                    {quotaExhausted ? ' — today’s scans are used up' : ' — scans are four hours apart'}
                  </span>
                )}
                {(profile?.subscription_status === 'trial' ||
                  (profile?.subscription_status === 'active' && profile?.subscription_plan_type === 'monthly')) && (
                  <Link
                    to="/pricing"
                    className="inline-flex items-center gap-1 rounded text-xs font-semibold text-[var(--status-warning-text)] underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-warning-border)]"
                  >
                    <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Switch to yearly
                  </Link>
                )}
              </div>

              {syncError && (
                <div
                  role="alert"
                  className="mt-2 flex flex-col gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 py-2.5 text-sm text-[var(--status-danger-text)] sm:flex-row sm:items-center"
                >
                  <span className="flex flex-1 items-start gap-2 leading-relaxed">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    {syncError}
                  </span>
                  {(syncError.includes('expired') || syncError.includes('connected')) && (
                    <Link
                      to="/pending"
                      className="shrink-0 rounded text-sm font-semibold text-[var(--status-danger-text)] underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger-border)]"
                    >
                      Go to Pending
                    </Link>
                  )}
                </div>
              )}
            </Notice>
          </motion.div>
        )}

        {/* ── First-run checklist ──────────────────────────────────────
            Current month only: monthBudgetTotal follows the period picker, so
            browsing an older month with no budget set used to bring the whole
            checklist back for an established user. */}
        {!checklistDismissed && isCurrentMonth && (recentTransactions.length === 0 || monthBudgetTotal === 0) && (
          <motion.div variants={staggerChild(reduce)}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-zinc-100">Three things to set up</h2>
                  <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                    Each one takes under a minute, and the dashboard fills in as you go.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissChecklist}
                  aria-label="Dismiss the setup checklist"
                  className="h-11 w-11 -mr-2 -mt-2 flex shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-surface-2 hover:text-zinc-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <ul className="mt-5 space-y-2.5">
                {[
                  {
                    done: recentTransactions.length > 0,
                    label: 'Record your first transaction',
                    hint: 'Connect Gmail on Pending, or add one by hand below.',
                    to: recentTransactions.length > 0 ? null : '/expenses',
                  },
                  {
                    done: monthBudgetTotal > 0,
                    label: 'Set a monthly budget',
                    hint: 'One category is enough to start — add more later.',
                    to: monthBudgetTotal > 0 ? null : '/budgets',
                  },
                  {
                    done: visitedAnalytics,
                    label: 'Look at your Insights',
                    hint: 'Trends, forecasts and where the money actually goes.',
                    // '/analytics' is not a route — App.tsx's catch-all
                    // redirected this straight out of the app.
                    to: visitedAnalytics ? null : '/insights',
                  },
                ].map((step) => (
                  <li key={step.label} className={`${ROW_TILE} flex items-center gap-3 p-3.5`}>
                    {step.done ? (
                      <CheckCircle2
                        className="h-5 w-5 shrink-0 text-[var(--status-positive-text)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${step.done ? 'text-zinc-400 line-through' : 'text-zinc-100'}`}>
                        {step.label}
                        <span className="sr-only">{step.done ? ' — done' : ' — not done yet'}</span>
                      </p>
                      {!step.done && <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">{step.hint}</p>}
                    </div>
                    {step.to && (
                      <Link to={step.to} className="shrink-0">
                        <Button variant="secondary" className="h-11">Start</Button>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        )}

        {/* ── The numbers ─────────────────────────────────────────────
            First, because this is what a person opened the app to read. */}
        {widgets.stats && (
          <motion.section variants={staggerChild(reduce)} aria-label={`Totals for ${periodLabel}`}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                [0, 1, 2].map((i) => (
                  <Card key={i} className={i === 2 ? 'sm:col-span-2 lg:col-span-1' : undefined}>
                    <div role="status" aria-label="Loading totals">
                      <div className="flex items-center gap-2.5">
                        <Skeleton shape="block" className="h-9 w-9" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="mt-4 h-8 w-36" />
                      <Skeleton className="mt-3 h-3 w-28" />
                    </div>
                  </Card>
                ))
              ) : (
                <>
                  <Card>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]"
                      >
                        <TrendingUp className="h-4.5 w-4.5" />
                      </span>
                      <h2 className={SECTION_LABEL}>Money in</h2>
                    </div>
                    <p className="mt-4 text-3xl font-semibold tracking-tight tnum text-[var(--status-positive-text)]">
                      {formatCurrency(summary?.total_income || 0)}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">Received in {periodLabel}</p>
                  </Card>

                  {/* Expenses are a neutral fact, not a warning — no red. */}
                  <Card>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-zinc-300"
                      >
                        <TrendingDown className="h-4.5 w-4.5" />
                      </span>
                      <h2 className={SECTION_LABEL}>Money out</h2>
                    </div>
                    <p className="mt-4 text-3xl font-semibold tracking-tight tnum text-zinc-50">
                      {formatCurrency(summary?.total_expenses || 0)}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">Spent in {periodLabel}</p>
                  </Card>

                  <Card className="sm:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
                      >
                        <Shield className="h-4.5 w-4.5" />
                      </span>
                      <h2 className={SECTION_LABEL}>Kept</h2>
                    </div>
                    <p
                      className={`mt-4 text-3xl font-semibold tracking-tight tnum ${
                        (summary?.savings || 0) >= 0
                          ? 'text-[var(--status-positive-text)]'
                          : 'text-[var(--status-danger-text)]'
                      }`}
                    >
                      {formatCurrency(summary?.savings || 0)}
                    </p>
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        {/* Said in words as well as colour: a negative rate is
                            "overspent", not just a red number. */}
                        <span className="text-zinc-400">
                          {(summary?.savings || 0) >= 0 ? 'Of what came in' : 'Overspent'}
                        </span>
                        <span
                          className={`font-semibold tnum ${
                            (summary?.savings || 0) >= 0
                              ? 'text-[var(--status-positive-text)]'
                              : 'text-[var(--status-danger-text)]'
                          }`}
                        >
                          {savingsRate.toFixed(0)}%
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={Math.round(Math.max(0, Math.min(100, savingsRate)))}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Share of income kept"
                        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                      >
                        <div
                          className={`h-full rounded-full ${
                            reduce ? '' : 'transition-[width] duration-500 ease-out'
                          } ${(summary?.savings || 0) >= 0 ? 'bg-brand-500' : 'bg-[var(--status-danger-text)]'}`}
                          style={{ width: `${Math.max(0, Math.min(100, savingsRate))}%` }}
                        />
                      </div>
                    </div>
                  </Card>
                </>
              )}
            </div>
          </motion.section>
        )}

        {/* Foreign spend is deliberately excluded from the INR figures — the app
            holds no exchange rates, and summing mixed currencies would produce
            a meaningless number. It sits directly under the totals it is
            qualifying; it used to render above them, where "the totals above"
            pointed at the page heading. */}
        {summary?.other_currency_totals && Object.keys(summary.other_currency_totals).length > 0 && (
          <motion.aside
            variants={staggerChild(reduce)}
            className="rounded-2xl border border-border-subtle bg-surface-1 p-4 sm:p-5"
          >
            <p className="text-sm font-semibold text-zinc-100">Also spent in other currencies</p>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              Left out of the totals above — Intrack does not convert between currencies.
            </p>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {Object.entries(summary.other_currency_totals).map(([code, totals]) => (
                <li key={code} className="text-sm tnum text-zinc-300">
                  {totals.expenses > 0 && <>{formatCurrency(totals.expenses, code)} spent</>}
                  {totals.expenses > 0 && totals.income > 0 && ' · '}
                  {totals.income > 0 && <>{formatCurrency(totals.income, code)} received</>}
                </li>
              ))}
            </ul>
          </motion.aside>
        )}

        {/* ── Two findings, side by side ───────────────────────────────
            Both are the same object: one sentence about the period, and a way
            through to the screen that explains it. They were two stacked
            full-width strips, which read as two unrelated banners. */}
        {linkTileCount > 0 && (
          <motion.section variants={staggerChild(reduce)} className="grid gap-4 sm:grid-cols-2">
            {widgets.insights && (
              <Link
                to="/insights"
                className={`group flex items-start gap-4 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-border-hover hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${linkTileSpan}`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
                >
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className={SECTION_LABEL}>Worth knowing</h2>
                  {insightsTeaser === 'loading' ? (
                    <div role="status" aria-label="Looking for unusual spending">
                      <Skeleton className="mt-2 h-4 w-full" />
                      <Skeleton className="mt-1.5 h-4 w-2/3" />
                    </div>
                  ) : insightsTeaser === 'none' ? (
                    <p className="mt-1.5 text-sm text-zinc-200 leading-relaxed">
                      Nothing unusual this month — your spending is steady.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm text-zinc-200 leading-relaxed">
                      {(() => {
                        const cat = getStyle(insightsTeaser.category)
                        return (
                          <>
                            <span className="font-semibold">{cat.emoji} {cat.label}</span> spending is
                            {insightsTeaser.isProjection ? ' on track to be up ' : ' up '}
                            <span className="font-semibold tnum text-[var(--status-warning-text)]">
                              {Math.round(insightsTeaser.spike)}%
                            </span>{' '}
                            this month — <span className="tnum">{formatCurrency(insightsTeaser.projectedMonth)}</span>
                            {insightsTeaser.isProjection ? ' projected' : ''} against a{' '}
                            <span className="tnum">{formatCurrency(insightsTeaser.baseline)}</span> average.
                          </>
                        )
                      })()}
                    </p>
                  )}
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                    See all insights
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            )}

            {widgets.ccbills && (
              <button
                type="button"
                onClick={() => setShowCcBillModal(true)}
                className={`group flex items-start gap-4 rounded-2xl border border-border-subtle bg-surface-1 p-5 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-border-hover hover:bg-surface-2/40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${linkTileSpan}`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
                >
                  <CreditCard className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className={SECTION_LABEL}>Credit card bills paid</h2>
                  {ccBillLoading ? (
                    <div role="status" aria-label="Loading credit card bill payments">
                      <Skeleton className="mt-2 h-6 w-32" />
                      <Skeleton className="mt-2 h-4 w-2/3" />
                    </div>
                  ) : (
                    <>
                      <p className="mt-1.5 text-2xl font-semibold tracking-tight tnum text-zinc-50">
                        {formatCurrency(ccBillTotal)}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                        {ccBillHomeTxns.length === 0
                          ? ccBillTxns.length > 0
                            // Foreign-currency payments only: ₹0 with a flat
                            // "none" would contradict the list the modal shows.
                            ? `Only foreign-currency payments in ${periodLabel}.`
                            : `No bill payments in ${periodLabel}.`
                          : `${ccBillHomeTxns.length} payment${ccBillHomeTxns.length === 1 ? '' : 's'} in ${periodLabel}, kept out of Money out — the purchases behind them were already counted.`}
                      </p>
                    </>
                  )}
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                    View payments
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </span>
                </div>
              </button>
            )}
          </motion.section>
        )}

        {/* ── Act on it ───────────────────────────────────────────────
            Quick add and anything owed back are the two things a person does
            on this screen rather than reads. They sit together, below the
            figures they change. */}
        {isCurrentMonth && (
          <motion.section variants={staggerChild(reduce)} className="space-y-4">
            <QuickAddWidget
              topCategories={topCategories}
              onAdded={() => {
                fetchDashboardData(dateFilter)
                refreshStreak()
              }}
              footnote={
                !loading && !streakInfo.loggedToday
                  ? `Log something today to ${streakInfo.streak > 0 ? 'keep' : 'start'} your streak.`
                  : undefined
              }
            />
            <ReceivablesCard onSettled={() => fetchDashboardData(dateFilter)} />
          </motion.section>
        )}

        {/* ── The detail ──────────────────────────────────────────────── */}
        {(widgets.breakdown || widgets.recent) && (
          <motion.section variants={staggerChild(reduce)} className="grid gap-4 lg:grid-cols-12 lg:gap-6">
            {widgets.breakdown && (
              <Card className={`flex flex-col ${widgets.recent ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-zinc-100">Where it went</h2>
                    <p className="mt-1 text-sm text-zinc-400">By category, {periodLabel}</p>
                  </div>
                  {summary && summary.category_breakdown.length > CATEGORY_BREAKDOWN_PREVIEW_COUNT && (
                    <Button
                      variant="ghost"
                      onClick={() => setShowAllCategories((prev) => !prev)}
                      className="h-11 shrink-0 px-3"
                    >
                      {showAllCategories
                        ? 'Show fewer'
                        : `All ${summary.category_breakdown.length}`}
                    </Button>
                  )}
                </div>

                <div className="mt-5 flex-1">
                  {loading ? (
                    <div role="status" aria-label="Loading spending breakdown" className="space-y-5">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <Skeleton shape="block" className="h-2 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : !summary || summary.category_breakdown.length === 0 ? (
                    <EmptyState
                      icon={<BarChart2 className="h-8 w-8 text-zinc-400" />}
                      title="Nothing spent in this period"
                      description={
                        isCurrentMonth
                          ? 'Add an expense below, or scan your inbox, and your categories appear here ranked by size.'
                          : `No expenses fall in ${periodLabel}. Pick another period to see its breakdown.`
                      }
                      action={
                        isCurrentMonth ? undefined : (
                          <Button
                            variant="secondary"
                            onClick={() => setDateFilter({ mode: 'month', month: getCurrentMonth() })}
                            className="h-11"
                          >
                            Back to this month
                          </Button>
                        )
                      }
                    />
                  ) : (
                    <motion.ul
                      key={`${periodLabel}-${showAllCategories}`}
                      variants={staggerParent(reduce, CATEGORY_BREAKDOWN_PREVIEW_COUNT)}
                      initial="initial"
                      animate="animate"
                      className="space-y-1"
                    >
                      {(showAllCategories
                        ? summary.category_breakdown
                        : summary.category_breakdown.slice(0, CATEGORY_BREAKDOWN_PREVIEW_COUNT)
                      ).map((item) => {
                        const cat = getStyle(item.category)
                        return (
                          <motion.li
                            key={item.category}
                            variants={rowVariants(reduce)}
                            transition={transition(reduce)}
                          >
                            <button
                              type="button"
                              onClick={() => handleCategoryClick(item.category)}
                              aria-label={`${cat.label}: ${formatCurrency(item.amount)} across ${item.count} transactions`}
                              className="-mx-2 w-full space-y-2 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-2/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                            >
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="flex min-w-0 items-baseline gap-2">
                                  <span aria-hidden="true" className="text-base leading-none">{cat.emoji}</span>
                                  <span className="truncate text-sm font-medium text-zinc-100">{cat.label}</span>
                                  <span className="shrink-0 text-xs tnum text-zinc-400">
                                    {item.count}
                                  </span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="text-sm font-semibold tnum text-zinc-100">
                                    {formatCurrency(item.amount)}
                                  </span>
                                  <span className="ml-2 text-xs tnum text-zinc-400">
                                    {item.percentage.toFixed(0)}%
                                  </span>
                                </span>
                              </div>
                              <span
                                role="progressbar"
                                aria-valuenow={Math.round(item.percentage)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${cat.label} share of spending`}
                                className="block h-2 w-full overflow-hidden rounded-full bg-surface-3"
                              >
                                <span
                                  className={`block h-full rounded-full ${reduce ? '' : 'transition-[width] duration-500 ease-out'}`}
                                  style={{ width: `${item.percentage}%`, backgroundColor: cat.color }}
                                />
                              </span>
                            </button>
                          </motion.li>
                        )
                      })}
                    </motion.ul>
                  )}
                </div>
              </Card>
            )}

            {widgets.recent && (
              <Card
                noPadding
                className={`flex flex-col ${widgets.breakdown ? 'lg:col-span-5' : 'lg:col-span-12'}`}
              >
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 md:px-6 md:pt-6">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-zinc-100">Latest activity</h2>
                    <p className="mt-1 text-sm text-zinc-400">Across every period</p>
                  </div>
                  <Button variant="ghost" onClick={handleOpenRecentModal} className="h-11 shrink-0 px-3">
                    View more
                  </Button>
                </div>

                <div className="flex-1 border-t border-border-subtle">
                  {loading ? (
                    <div role="status" aria-label="Loading recent activity" className="space-y-4 p-5 md:p-6">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Skeleton shape="block" className="h-9 w-9 shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                          </div>
                          <Skeleton className="h-4 w-16 shrink-0" />
                        </div>
                      ))}
                    </div>
                  ) : recentTransactions.length === 0 ? (
                    <div className="px-5 md:px-6">
                      <EmptyState
                        icon={<DollarSign className="h-8 w-8 text-zinc-400" />}
                        title="No transactions yet"
                        description="Every transaction you add or approve shows up here, newest first — so you can check at a glance that nothing is missing."
                        action={
                          <Link to="/expenses">
                            <Button>Add a transaction</Button>
                          </Link>
                        }
                      />
                    </div>
                  ) : (
                    <motion.ul
                      variants={staggerParent(reduce, recentTransactions.length)}
                      initial="initial"
                      animate="animate"
                      className="divide-y divide-border-subtle"
                    >
                      {recentTransactions.map((txn) => {
                        const cat = getStyle(txn.category)
                        const isDebit = txn.type === 'debit'
                        return (
                          <motion.li
                            key={txn.id}
                            variants={rowVariants(reduce)}
                            transition={transition(reduce)}
                            className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/40 md:px-6"
                          >
                            <span
                              aria-hidden="true"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
                              style={{ backgroundColor: `${cat.color}15` }}
                            >
                              {cat.emoji}
                            </span>

                            {/* Resolved identity, never raw narration. This list
                                used to print txn.description, so one payment read
                                "Swiggy" in the modal and "UPI/4412/SWIGGY-BLR"
                                here. */}
                            <div className="min-w-0 flex-1">
                              <TransactionIdentity {...resolveTransactionIdentity(txn)} size="md" />
                              <span className="mt-0.5 block text-xs tnum text-zinc-400">
                                {formatDate(txn.date)}
                              </span>
                            </div>

                            <p
                              className={`shrink-0 text-sm font-semibold tnum ${
                                isDebit ? 'text-zinc-100' : 'text-[var(--status-positive-text)]'
                              }`}
                            >
                              {/* The row's own currency — without it a $200
                                  charge renders as "-₹200" here and "-$200" in
                                  the modal below. */}
                              {isDebit ? '−' : '+'}
                              {formatCurrencyCompact(Number(txn.amount), txn.currency)}
                              <span className="sr-only">{isDebit ? ' spent' : ' received'}</span>
                            </p>
                          </motion.li>
                        )
                      })}
                    </motion.ul>
                  )}
                </div>
              </Card>
            )}
          </motion.section>
        )}

        {/* Fetches its own 24 months of history — detection needs two charges
            from one merchant, which the 5 recent rows above can never show.
            Deliberately NOT wrapped in a motion.div: it returns null whenever
            it has nothing to show, and an empty wrapper would still take a
            `space-y` margin, leaving a gap at the bottom of the page. */}
        <ActiveSubscriptionsWidget isVisible={widgets.subscriptions} />

        {/* ── Modals ─────────────────────────────────────────────────── */}
        <Modal
          isOpen={showAllRecentModal}
          onClose={() => setShowAllRecentModal(false)}
          title="Latest activity"
          footer={
            <Button variant="secondary" onClick={() => setShowAllRecentModal(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">Your fifteen most recent transactions.</p>
            {loadingAllRecent ? (
              <div role="status" aria-label="Loading transactions" className="space-y-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-4 w-20 shrink-0" />
                  </div>
                ))}
              </div>
            ) : allRecentTransactions.length === 0 ? (
              <EmptyState
                icon={<DollarSign className="h-8 w-8 text-zinc-400" />}
                title="Nothing recorded yet"
                description="Add a transaction, or scan your inbox from Pending, and it will appear here."
              />
            ) : (
              <ul className="divide-y divide-border-subtle/40">
                {allRecentTransactions.map((txn) => {
                  const cat = getStyle(txn.category)
                  const isDebit = txn.type === 'debit'
                  return (
                    <li key={txn.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="shrink-0 text-xl">{cat.emoji}</span>
                        <div className="min-w-0">
                          <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                          <span className="mt-0.5 block text-xs tnum text-zinc-400">
                            {formatDate(txn.date)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold tnum ${
                          isDebit ? 'text-zinc-100' : 'text-[var(--status-positive-text)]'
                        }`}
                      >
                        {isDebit ? '−' : '+'}{formatCurrency(Number(txn.amount), txn.currency)}
                        <span className="sr-only">{isDebit ? ' spent' : ' received'}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Modal>

        <Modal
          isOpen={showCcBillModal}
          onClose={() => setShowCcBillModal(false)}
          title="Credit card bills paid"
          footer={
            <Button variant="secondary" onClick={() => setShowCcBillModal(false)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-4">
              <p className={SECTION_LABEL}>{periodLabel}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight tnum text-zinc-50">
                {formatCurrency(ccBillTotal)}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                across <span className="tnum">{ccBillHomeTxns.length}</span> payment
                {ccBillHomeTxns.length === 1 ? '' : 's'}
              </p>
              {Object.keys(ccBillForeignTotals).length > 0 && (
                <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                  Also paid in other currencies, not added to the figure above:{' '}
                  <span className="tnum">
                    {Object.entries(ccBillForeignTotals)
                      .map(([code, amount]) => formatCurrency(amount, code))
                      .join(' · ')}
                  </span>
                </p>
              )}
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">
              These sit outside Money out. Paying a card bill is not new spending — the
              purchases behind it were counted the day each one happened.
            </p>
            {ccBillLoading ? (
              <div role="status" aria-label="Loading bill payments" className="space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-4 w-20 shrink-0" />
                  </div>
                ))}
              </div>
            ) : ccBillTxns.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="h-8 w-8 text-zinc-400" />}
                title="No bill payments in this period"
                description="Tag a transaction with a credit-card-bill category and it is counted here instead of in Money out."
              />
            ) : (
              <ul className="divide-y divide-border-subtle/40">
                {ccBillTxns.map((txn) => (
                  <li key={txn.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 flex-col">
                      <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                      <span className="mt-0.5 text-xs tnum text-zinc-400">{formatDate(txn.date)}</span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tnum text-zinc-100">
                      {formatCurrency(Number(txn.amount), txn.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>

        {showCategoryModal && selectedCategoryCode && (() => {
          const cat = getStyle(selectedCategoryCode)
          const matchedSummaryItem = summary?.category_breakdown.find((item) => item.category === selectedCategoryCode)
          const totalAmount = matchedSummaryItem?.amount || 0
          const totalCount = matchedSummaryItem?.count || 0

          const closeCategoryModal = () => {
            setShowCategoryModal(false)
            setSelectedCategoryCode(null)
            setCategoryTransactions([])
          }

          return (
            <Modal
              isOpen={showCategoryModal}
              onClose={closeCategoryModal}
              title={`${cat.label} spending`}
              footer={
                <Button variant="secondary" onClick={closeCategoryModal}>
                  Close
                </Button>
              }
            >
              <div className="space-y-4">
                <div className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-4">
                  <p className={SECTION_LABEL}>{periodLabel}</p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-tight tnum text-zinc-50">
                    {formatCurrency(totalAmount)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    across <span className="tnum">{totalCount}</span> transaction
                    {totalCount === 1 ? '' : 's'}
                  </p>
                </div>
                {loadingCategoryTxns ? (
                  <div role="status" aria-label="Loading transactions" className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between gap-3">
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <Skeleton className="h-4 w-20 shrink-0" />
                      </div>
                    ))}
                  </div>
                ) : categoryTransactions.length === 0 ? (
                  <EmptyState
                    icon={<BarChart2 className="h-8 w-8 text-zinc-400" />}
                    title="Nothing to list"
                    description="No transactions in this category fall inside the selected period."
                  />
                ) : (
                  <ul className="divide-y divide-border-subtle/40">
                    {categoryTransactions.map((txn) => (
                      <li key={txn.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="flex min-w-0 flex-col">
                          <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                          <span className="mt-0.5 text-xs tnum text-zinc-400">{formatDate(txn.date)}</span>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tnum text-zinc-100">
                          −{formatCurrency(Number(txn.amount), txn.currency)}
                          <span className="sr-only"> spent</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Modal>
          )
        })()}

        {/* Customise — one switch per optional section, listed in the order
            they appear on the page. Each row is the target, not a 16px
            checkbox floating at the end of it. */}
        <Modal
          isOpen={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          title="Customise dashboard"
          footer={
            <Button variant="secondary" onClick={() => setShowConfigModal(false)}>
              Done
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Turn off anything you do not use. This is saved on this device only, and
              hiding a section never deletes the data behind it.
            </p>
            <ul className="space-y-2">
              {WIDGET_OPTIONS.map(({ key, icon: WidgetIcon, label, hint }) => {
                const on = !!widgets[key]
                return (
                  <li key={key}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => toggleWidget(key)}
                      className={`${ROW_TILE} flex min-h-14 w-full items-center gap-3 p-3.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          on ? 'bg-brand-500/10 text-brand-700' : 'bg-surface-3 text-zinc-400'
                        }`}
                      >
                        <WidgetIcon className="h-4.5 w-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-100">{label}</span>
                        <span className="mt-0.5 block text-xs text-zinc-400 leading-relaxed">{hint}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                          on ? 'border-brand-500/40 bg-brand-500' : 'border-border-default bg-surface-3'
                        }`}
                      >
                        <span
                          className={`h-4.5 w-4.5 rounded-full bg-static-white shadow-[var(--shadow-sm)] ${
                            reduce ? '' : 'transition-transform duration-150 ease-out'
                          } ${on ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Modal>

        {/* Month-end recap — a session that closes on a summary is remembered
            better, and it is a reason to open the app again next month. */}
        <Modal
          isOpen={!!monthEndRecap}
          onClose={() => setMonthEndRecap(null)}
          title={monthEndRecap ? `${formatMonthName(monthEndRecap.month)} in review` : 'Recap'}
          footer={
            <Button block onClick={() => setMonthEndRecap(null)}>
              Got it
            </Button>
          }
        >
          {monthEndRecap && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-4">
                  <p className={SECTION_LABEL}>Money out</p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-tight tnum text-zinc-50">
                    {formatCurrency(monthEndRecap.totalExpenses)}
                  </p>
                </div>
                <div className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-4">
                  <p className={SECTION_LABEL}>Kept</p>
                  <p
                    className={`mt-1.5 text-2xl font-semibold tracking-tight tnum ${
                      monthEndRecap.totalIncome - monthEndRecap.totalExpenses >= 0
                        ? 'text-[var(--status-positive-text)]'
                        : 'text-[var(--status-danger-text)]'
                    }`}
                  >
                    {formatCurrency(monthEndRecap.totalIncome - monthEndRecap.totalExpenses)}
                  </p>
                </div>
              </div>

              {monthEndRecap.topCategory && (
                <p className="text-sm text-zinc-300 leading-relaxed">
                  Biggest category:{' '}
                  <strong className="font-semibold text-zinc-100">{monthEndRecap.topCategory.label}</strong>{' '}
                  <span className="tnum">({formatCurrency(monthEndRecap.topCategory.amount)})</span>
                </p>
              )}

              {monthEndRecap.priorExpenses !== null && monthEndRecap.priorExpenses > 0 && (
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {monthEndRecap.totalExpenses < monthEndRecap.priorExpenses ? (
                    <>
                      That is{' '}
                      <span className="tnum font-semibold text-zinc-100">
                        {formatCurrency(monthEndRecap.priorExpenses - monthEndRecap.totalExpenses)}
                      </span>{' '}
                      less than the month before.
                    </>
                  ) : (
                    <>
                      That is{' '}
                      <span className="tnum font-semibold text-zinc-100">
                        {formatCurrency(monthEndRecap.totalExpenses - monthEndRecap.priorExpenses)}
                      </span>{' '}
                      more than the month before.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </Modal>
      </motion.div>
    </AppLayout>
  )
}
