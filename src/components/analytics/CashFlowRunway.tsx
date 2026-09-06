// ============================================================
// CashFlowRunway — Single Deterministic Cash Flow Simulation
//
// Governed by Priority 3: Single Cash Flow Runway.
// Replaces the old statistical forecast with a deterministic,
// daily balance projection over 30, 60, and 90 days.
//
// Core recurrence:
//   Balance(t) = Balance(t-1) + ExpectedIncomes(t) - PlannedPayments(t) - AvgDailyDiscretionarySpend
//
// Starting point:
//   Current available bank balance from getAvailableMoney() in src/services/balances.ts.
// ============================================================

import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { Card, Badge, Skeleton } from '@/components/ui'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateShort,
  toISODateLocal,
  cn,
} from '@/utils'
import { getAvailableMoney } from '@/services/balances'
import { detectSubscriptions, type DetectableTransaction } from '@/services/subscriptionDetection'
import {
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Calendar,
  Wallet,
  Activity,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'

export type RunwayHorizon = 30 | 60 | 90

export interface RunwayDayPoint {
  dayIndex: number
  date: string // YYYY-MM-DD
  dateLabel: string
  balance: number
  expectedIncome: number
  incomeItems: Array<{ name: string; amount: number }>
  plannedPayments: number
  paymentItems: Array<{ name: string; amount: number }>
  discretionarySpend: number
  netCashFlow: number
  isTrough: boolean
  isFirstCrunch: boolean
}

export interface ExpectedIncomeRule {
  id: string
  name: string
  amount: number
  dayOfMonth: number
  frequency: 'monthly'
}

export interface PlannedPaymentItem {
  id: string
  name: string
  amount: number
  nextDate: string
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_off'
  category?: string
}

export interface RunwaySimulationResult {
  startingBalance: number
  horizon: RunwayHorizon
  points: RunwayDayPoint[]
  endingBalance: number
  lowestBalance: number
  lowestBalanceDate: string | null
  lowestBalanceDayIndex: number | null
  crunchDate: string | null
  crunchDayIndex: number | null
  status: 'cushion' | 'caution' | 'crunch'
  runwayDays: number
  avgDailyDiscretionarySpend: number
  totalExpectedIncome: number
  totalPlannedPayments: number
  totalDiscretionarySpend: number
  detectedIncomes: ExpectedIncomeRule[]
  plannedPayments: PlannedPaymentItem[]
}

/**
 * Infer expected recurring incomes from historical credit transactions.
 * Looks for regular monthly salary, stipends, or retainer credits.
 */
export function detectExpectedIncomes(
  transactions: DetectableTransaction[],
  _now: Date = new Date()
): ExpectedIncomeRule[] {
  const credits = transactions.filter((t) => t.type === 'credit' && t.date)
  if (credits.length === 0) return []

  // Group credits by merchant or category/description
  const groups: Record<string, DetectableTransaction[]> = {}
  credits.forEach((t) => {
    const rawKey = t.merchant?.trim() || t.category?.trim() || 'Income'
    const key = rawKey.toLowerCase()
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  })

  const rules: ExpectedIncomeRule[] = []

  for (const [key, items] of Object.entries(groups)) {
    // Check if occurred in at least 2 distinct calendar months
    const distinctMonths = new Set(items.map((i) => i.date.substring(0, 7)))
    const isSalaryTag = key.includes('salary') || key.includes('payroll') || key.includes('stipend')

    if (distinctMonths.size >= 2 || (isSalaryTag && items.length >= 1)) {
      const amounts = items.map((i) => Number(i.amount))
      const avgAmount = Math.round(amounts.reduce((sum, a) => sum + a, 0) / amounts.length)

      // Find primary day of the month
      const days = items.map((i) => Number(i.date.slice(8, 10)))
      const dayCounts = new Map<number, number>()
      days.forEach((d) => dayCounts.set(d, (dayCounts.get(d) || 0) + 1))
      let modalDay = days[0] || 1
      let maxCount = 0
      dayCounts.forEach((count, d) => {
        if (count > maxCount) {
          maxCount = count
          modalDay = d
        }
      })

      const displayName =
        items[0].merchant?.trim() ||
        (isSalaryTag ? 'Monthly Salary' : items[0].category?.trim() || 'Expected Income')

      rules.push({
        id: `inc_${key}`,
        name: displayName,
        amount: avgAmount,
        dayOfMonth: modalDay,
        frequency: 'monthly',
      })
    }
  }

  // Fallback: If no distinct recurring merchant/category group, but positive credit history exists
  if (rules.length === 0) {
    const monthTotals = new Map<string, number>()
    credits.forEach((c) => {
      const m = c.date.substring(0, 7)
      monthTotals.set(m, (monthTotals.get(m) || 0) + Number(c.amount))
    })

    const monthlyValues = Array.from(monthTotals.values())
    const avgMonthly =
      monthlyValues.length > 0
        ? Math.round(monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length)
        : 0

    if (avgMonthly >= 5000) {
      // Find modal credit day
      const days = credits.map((c) => Number(c.date.slice(8, 10)))
      const dayCounts = new Map<number, number>()
      days.forEach((d) => dayCounts.set(d, (dayCounts.get(d) || 0) + 1))
      let modalDay = 1
      let maxCount = 0
      dayCounts.forEach((count, d) => {
        if (count > maxCount) {
          maxCount = count
          modalDay = d
        }
      })

      rules.push({
        id: 'inc_monthly_avg',
        name: 'Regular Income',
        amount: avgMonthly,
        dayOfMonth: modalDay,
        frequency: 'monthly',
      })
    }
  }

  return rules
}

/**
 * Infer planned recurring payments from transactions.
 * Utilizes detectSubscriptions and adds other regular fixed commitments (Rent, Loans, Bills).
 */
export function detectPlannedPayments(
  transactions: DetectableTransaction[],
  now: Date = new Date()
): PlannedPaymentItem[] {
  const list: PlannedPaymentItem[] = []
  const todayStr = toISODateLocal(now)

  // 1. Detected Subscriptions & utilities
  const subs = detectSubscriptions(transactions, { now })
  subs.forEach((s, idx) => {
    let nextDate = s.nextRenewal
    // If nextRenewal is in the past, roll it forward
    if (nextDate < todayStr) {
      const d = new Date(s.nextRenewal)
      while (toISODateLocal(d) < todayStr) {
        if (s.frequency === 'annual') d.setFullYear(d.getFullYear() + 1)
        else if (s.frequency === 'quarterly') d.setMonth(d.getMonth() + 3)
        else d.setMonth(d.getMonth() + 1)
      }
      nextDate = toISODateLocal(d)
    }

    list.push({
      id: `sub_${idx}_${s.merchant.toLowerCase().replace(/\s+/g, '_')}`,
      name: s.merchant,
      amount: s.amount,
      nextDate,
      frequency: s.frequency === 'unknown' ? 'monthly' : s.frequency,
      category: s.category,
    })
  })

  // 2. Identify fixed recurring payments like Rent / EMI if not already captured in subscriptions
  const fixedCategories = ['Rent', 'Loan', 'EMI', 'Insurance']
  const fixedDebits = transactions.filter(
    (t) => t.type === 'debit' && t.date && fixedCategories.includes(t.category)
  )

  const fixedGroups: Record<string, DetectableTransaction[]> = {}
  fixedDebits.forEach((t) => {
    const key = t.category.toLowerCase()
    if (!fixedGroups[key]) fixedGroups[key] = []
    fixedGroups[key].push(t)
  })

  for (const [key, items] of Object.entries(fixedGroups)) {
    const distinctMonths = new Set(items.map((i) => i.date.substring(0, 7)))
    if (distinctMonths.size >= 2) {
      // Don't duplicate if already detected under subscriptions
      const alreadySub = list.some((l) => l.category?.toLowerCase() === key)
      if (alreadySub) continue

      const avgAmount = Math.round(
        items.reduce((sum, i) => sum + Number(i.amount), 0) / items.length
      )
      const last = items.sort((a, b) => b.date.localeCompare(a.date))[0]
      const lastDay = Number(last.date.slice(8, 10))

      // Next due date
      const nextD = new Date(now.getFullYear(), now.getMonth(), lastDay)
      if (toISODateLocal(nextD) < todayStr) {
        nextD.setMonth(nextD.getMonth() + 1)
      }

      list.push({
        id: `fixed_${key}`,
        name: items[0].category,
        amount: avgAmount,
        nextDate: toISODateLocal(nextD),
        frequency: 'monthly',
        category: items[0].category,
      })
    }
  }

  return list
}

/**
 * Calculates average daily discretionary spend from historical debits.
 * Discretionary spend = debits excluding planned recurring payments, investments, and credit card bill payments.
 */
export function calculateAvgDailyDiscretionarySpend(
  transactions: DetectableTransaction[],
  plannedPayments: PlannedPaymentItem[],
  now: Date = new Date(),
  lookbackDays = 60
): number {
  const debits = transactions.filter((t) => t.type === 'debit' && t.date)
  if (debits.length === 0) return 0

  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  const cutoffStr = toISODateLocal(cutoff)
  const todayStr = toISODateLocal(now)

  const windowDebits = debits.filter((t) => t.date >= cutoffStr && t.date <= todayStr)
  if (windowDebits.length === 0) return 0

  const plannedNames = new Set(plannedPayments.map((p) => p.name.trim().toLowerCase()))
  const plannedCategories = new Set(
    plannedPayments.map((p) => (p.category || '').trim().toLowerCase())
  )

  let discretionarySum = 0

  windowDebits.forEach((t) => {
    const m = (t.merchant || '').trim().toLowerCase()
    const c = (t.category || '').trim().toLowerCase()

    // Exclude credit card bill settlements and savings/investments
    if (c === 'credit card bill' || c.includes('bill payment') || c === 'investments') {
      return
    }

    // Exclude debits identified as planned payments
    if (plannedNames.has(m) || plannedCategories.has(c)) {
      return
    }

    discretionarySum += Number(t.amount)
  })

  // Calculate days spanned
  const dates = windowDebits.map((t) => t.date).sort()
  const firstDate = new Date(dates[0])
  const daysSpan = Math.max(
    1,
    Math.min(lookbackDays, Math.round((now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)))
  )

  const avg = Math.round(discretionarySum / daysSpan)
  return Math.max(0, avg)
}

/**
 * Deterministic Cash Flow Runway Simulation Engine.
 * Implements: Balance(t) = Balance(t-1) + ExpectedIncomes(t) - PlannedPayments(t) - AvgDailyDiscretionarySpend
 */
export function simulateCashFlowRunway(params: {
  startingBalance: number
  horizon: RunwayHorizon
  transactions?: DetectableTransaction[]
  customIncomes?: ExpectedIncomeRule[]
  customPayments?: PlannedPaymentItem[]
  discretionarySpendOverride?: number
  now?: Date
}): RunwaySimulationResult {
  const {
    startingBalance,
    horizon,
    transactions = [],
    customIncomes,
    customPayments,
    discretionarySpendOverride,
    now = new Date(),
  } = params

  const incomes = customIncomes ?? detectExpectedIncomes(transactions, now)
  const payments = customPayments ?? detectPlannedPayments(transactions, now)
  const dailyDiscretionary =
    discretionarySpendOverride !== undefined
      ? discretionarySpendOverride
      : calculateAvgDailyDiscretionarySpend(transactions, payments, now)

  const points: RunwayDayPoint[] = []

  let runningBalance = startingBalance
  let lowestBalance = startingBalance
  let lowestBalanceDate: string | null = toISODateLocal(now)
  let lowestBalanceDayIndex: number | null = 0
  let crunchDate: string | null = startingBalance < 0 ? toISODateLocal(now) : null
  let crunchDayIndex: number | null = startingBalance < 0 ? 0 : null

  let totalExpectedIncome = 0
  let totalPlannedPayments = 0
  let totalDiscretionarySpend = 0

  // Day 0 (today)
  const todayStr = toISODateLocal(now)
  points.push({
    dayIndex: 0,
    date: todayStr,
    dateLabel: 'Today',
    balance: runningBalance,
    expectedIncome: 0,
    incomeItems: [],
    plannedPayments: 0,
    paymentItems: [],
    discretionarySpend: 0,
    netCashFlow: 0,
    isTrough: false,
    isFirstCrunch: startingBalance < 0,
  })

  // Pre-calculate occurrences of planned payments in the window
  const paymentSchedule = new Map<string, Array<{ name: string; amount: number }>>()
  payments.forEach((p) => {
    const cur = new Date(p.nextDate)
    const endHorizon = new Date(now)
    endHorizon.setDate(endHorizon.getDate() + horizon + 2)

    while (cur <= endHorizon) {
      const dateKey = toISODateLocal(cur)
      if (dateKey >= todayStr) {
        const existing = paymentSchedule.get(dateKey) || []
        existing.push({ name: p.name, amount: p.amount })
        paymentSchedule.set(dateKey, existing)
      }

      // Step forward by frequency
      if (p.frequency === 'annual') {
        cur.setFullYear(cur.getFullYear() + 1)
      } else if (p.frequency === 'quarterly') {
        cur.setMonth(cur.getMonth() + 3)
      } else if (p.frequency === 'monthly') {
        cur.setMonth(cur.getMonth() + 1)
      } else {
        break // one_off
      }
    }
  })

  // Project daily balance for day 1 to horizon
  for (let t = 1; t <= horizon; t++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + t)
    const dateStr = toISODateLocal(d)
    const dayOfMonth = d.getDate()
    const daysInThisMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

    // 1. Expected incomes on day t
    const incomeItems: Array<{ name: string; amount: number }> = []
    incomes.forEach((rule) => {
      // Handles month-end clamp (e.g. 31st on a 30-day month)
      const targetDay = Math.min(rule.dayOfMonth, daysInThisMonth)
      if (dayOfMonth === targetDay) {
        incomeItems.push({ name: rule.name, amount: rule.amount })
      }
    })
    const dayIncome = incomeItems.reduce((sum, i) => sum + i.amount, 0)

    // 2. Planned payments on day t
    const paymentItems = paymentSchedule.get(dateStr) || []
    const dayPayments = paymentItems.reduce((sum, p) => sum + p.amount, 0)

    // 3. Discretionary spend on day t
    const dayDiscretionary = dailyDiscretionary

    // Formula: Balance(t) = Balance(t-1) + ExpectedIncomes(t) - PlannedPayments(t) - AvgDailyDiscretionarySpend
    const netCashFlow = dayIncome - dayPayments - dayDiscretionary
    runningBalance = runningBalance + netCashFlow

    totalExpectedIncome += dayIncome
    totalPlannedPayments += dayPayments
    totalDiscretionarySpend += dayDiscretionary

    // Track lowest dip
    if (runningBalance < lowestBalance) {
      lowestBalance = runningBalance
      lowestBalanceDate = dateStr
      lowestBalanceDayIndex = t
    }

    // Track first crunch (negative balance)
    let isFirstCrunch = false
    if (runningBalance < 0 && crunchDayIndex === null) {
      crunchDayIndex = t
      crunchDate = dateStr
      isFirstCrunch = true
    }

    points.push({
      dayIndex: t,
      date: dateStr,
      dateLabel: formatDateShort(dateStr),
      balance: Math.round(runningBalance),
      expectedIncome: dayIncome,
      incomeItems,
      plannedPayments: dayPayments,
      paymentItems,
      discretionarySpend: dayDiscretionary,
      netCashFlow: Math.round(netCashFlow),
      isTrough: false,
      isFirstCrunch,
    })
  }

  // Flag the single trough point on the curve
  if (lowestBalanceDayIndex !== null && points[lowestBalanceDayIndex]) {
    points[lowestBalanceDayIndex].isTrough = true
  }

  // Cushion vs crunch determination
  // Caution buffer: 15 days of total daily burn rate, or ₹10,000 minimum
  const totalDailyBurn = dailyDiscretionary + totalPlannedPayments / horizon
  const cautionThreshold = Math.max(10000, totalDailyBurn * 15)

  let status: 'cushion' | 'caution' | 'crunch' = 'cushion'
  let runwayDays: number = horizon

  if (crunchDayIndex !== null) {
    status = 'crunch'
    runwayDays = crunchDayIndex
  } else if (lowestBalance < cautionThreshold) {
    status = 'caution'
    runwayDays = horizon
  } else {
    status = 'cushion'
    runwayDays = horizon
  }

  return {
    startingBalance,
    horizon,
    points,
    endingBalance: Math.round(runningBalance),
    lowestBalance: Math.round(lowestBalance),
    lowestBalanceDate,
    lowestBalanceDayIndex,
    crunchDate,
    crunchDayIndex,
    status,
    runwayDays,
    avgDailyDiscretionarySpend: dailyDiscretionary,
    totalExpectedIncome,
    totalPlannedPayments,
    totalDiscretionarySpend: Math.round(totalDiscretionarySpend),
    detectedIncomes: incomes,
    plannedPayments: payments,
  }
}

export interface CashFlowRunwayProps {
  transactions?: DetectableTransaction[]
  initialStartingBalance?: number
  className?: string
}

export function CashFlowRunway({
  transactions = [],
  initialStartingBalance,
  className,
}: CashFlowRunwayProps) {
  const [horizon, setHorizon] = useState<RunwayHorizon>(60)
  const [startingBalance, setStartingBalance] = useState<number>(initialStartingBalance ?? 0)
  const [loading, setLoading] = useState<boolean>(initialStartingBalance === undefined)
  const [hoveredPoint, setHoveredPoint] = useState<RunwayDayPoint | null>(null)
  const [showSettings, setShowSettings] = useState<boolean>(false)

  // Simulation adjustments
  const [discretionaryAdjustment, setDiscretionaryAdjustment] = useState<number>(0) // -50% to +50%
  const [manualIncome, setManualIncome] = useState<number | null>(null)

  // Fetch starting available money from balances service if not passed in
  useEffect(() => {
    if (initialStartingBalance !== undefined) {
      setStartingBalance(initialStartingBalance)
      setLoading(false)
      return
    }

    let isMounted = true
    setLoading(true)

    getAvailableMoney()
      .then((state) => {
        if (isMounted) {
          // If available money is configured, use its current value;
          // otherwise fallback to 0 or net movement
          setStartingBalance(state.current || 0)
        }
      })
      .catch((err) => {
        console.warn('Could not fetch available bank balance for runway:', err)
        if (isMounted) {
          setStartingBalance(0)
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [initialStartingBalance])

  // Compute baseline daily discretionary spend
  const detectedPlanned = useMemo(
    () => detectPlannedPayments(transactions),
    [transactions]
  )
  const baselineDiscretionary = useMemo(
    () => calculateAvgDailyDiscretionarySpend(transactions, detectedPlanned),
    [transactions, detectedPlanned]
  )

  const effectiveDiscretionary = useMemo(() => {
    const multiplier = 1 + discretionaryAdjustment / 100
    return Math.max(0, Math.round(baselineDiscretionary * multiplier))
  }, [baselineDiscretionary, discretionaryAdjustment])

  // Detected incomes with manual override option
  const detectedIncomes = useMemo(() => {
    const list = detectExpectedIncomes(transactions)
    if (manualIncome !== null && manualIncome > 0) {
      return [
        {
          id: 'manual_income',
          name: 'Monthly Income',
          amount: manualIncome,
          dayOfMonth: 1,
          frequency: 'monthly' as const,
        },
      ]
    }
    return list
  }, [transactions, manualIncome])

  // Run simulation
  const simulation = useMemo(() => {
    return simulateCashFlowRunway({
      startingBalance,
      horizon,
      transactions,
      customIncomes: detectedIncomes,
      customPayments: detectedPlanned,
      discretionarySpendOverride: effectiveDiscretionary,
    })
  }, [
    startingBalance,
    horizon,
    transactions,
    detectedIncomes,
    detectedPlanned,
    effectiveDiscretionary,
  ])

  // SVG Chart Dimensions
  const SVG_WIDTH = 760
  const SVG_HEIGHT = 200
  const PADDING_TOP = 20
  const PADDING_BOTTOM = 30
  const PADDING_LEFT = 50
  const PADDING_RIGHT = 30

  const chartPoints = simulation.points
  const balances = chartPoints.map((p) => p.balance)
  const minBal = Math.min(...balances)
  const maxBal = Math.max(...balances)

  // Determine Y-axis domain with headroom
  const yMin = Math.min(0, minBal < 0 ? minBal * 1.15 : 0)
  const yMax = Math.max(10000, maxBal * 1.1)
  const yRange = yMax - yMin || 1

  const getX = (idx: number) => {
    const span = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT
    return PADDING_LEFT + (idx / horizon) * span
  }

  const getY = (val: number) => {
    const span = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM
    const normalized = (val - yMin) / yRange
    return SVG_HEIGHT - PADDING_BOTTOM - normalized * span
  }

  const zeroY = getY(0)
  const hasNegative = minBal < 0

  // Build SVG Path strings
  const pathD = useMemo(() => {
    if (chartPoints.length === 0) return ''
    return chartPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(p.balance).toFixed(1)}`)
      .join(' ')
  }, [chartPoints, yMin, yRange])

  // Gradient area path
  const areaD = useMemo(() => {
    if (chartPoints.length === 0) return ''
    const firstX = getX(0)
    const lastX = getX(horizon)
    const baseLineY = zeroY
    return `${pathD} L ${lastX.toFixed(1)} ${baseLineY.toFixed(1)} L ${firstX.toFixed(1)} ${baseLineY.toFixed(1)} Z`
  }, [pathD, horizon, zeroY])

  // Status visual attributes
  const statusMeta = {
    cushion: {
      label: 'Cash Cushion Secure',
      badgeVariant: 'success' as const,
      icon: ShieldCheck,
      colorClass: 'text-[var(--status-positive-text)]',
      borderClass: 'border-[var(--status-positive-border)]',
      bgClass: 'bg-[var(--status-positive-subtle)]',
      strokeColor: '#059669', // Emerald
      description: `Your balance maintains a healthy liquidity reserve throughout the entire ${horizon}-day period.`,
    },
    caution: {
      label: 'Caution: Low Cushion',
      badgeVariant: 'warning' as const,
      icon: AlertCircle,
      colorClass: 'text-[var(--status-warning-text)]',
      borderClass: 'border-[var(--status-warning-border)]',
      bgClass: 'bg-[var(--status-warning-subtle)]',
      strokeColor: '#d97706', // Amber
      description: `Projected balance remains positive but drops near safety buffer (${formatCurrency(simulation.lowestBalance)} dip on ${simulation.lowestBalanceDate ? formatDateShort(simulation.lowestBalanceDate) : ''}).`,
    },
    crunch: {
      label: 'Projected Cash Crunch',
      badgeVariant: 'danger' as const,
      icon: AlertTriangle,
      colorClass: 'text-[var(--status-danger-text)]',
      borderClass: 'border-[var(--status-danger-border)]',
      bgClass: 'bg-[var(--status-danger-subtle)]',
      strokeColor: '#dc2626', // Red
      description: `Cash deficit projected in ${simulation.runwayDays} days on ${simulation.crunchDate ? formatDate(simulation.crunchDate) : ''}. Corrective action recommended.`,
    },
  }[simulation.status]

  const StatusIcon = statusMeta.icon

  // Y-axis tick marks
  const yTicks = useMemo(() => {
    const ticks = [yMin, yMin + yRange * 0.33, yMin + yRange * 0.66, yMax]
    return ticks.map((val) => ({
      val: Math.round(val),
      y: getY(val),
    }))
  }, [yMin, yMax, yRange])

  // X-axis tick intervals
  const xTicks = useMemo(() => {
    const step = horizon === 30 ? 7 : horizon === 60 ? 14 : 20
    const indices: number[] = [0]
    for (let i = step; i < horizon; i += step) {
      indices.push(i)
    }
    indices.push(horizon)
    return indices.map((idx) => ({
      idx,
      x: getX(idx),
      label: chartPoints[idx]?.dateLabel || `${idx}d`,
    }))
  }, [horizon, chartPoints])

  if (loading) {
    return (
      <Card className={cn('p-6 space-y-4', className)}>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton shape="block" className="h-56 w-full mt-4" />
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        'relative overflow-hidden bg-surface-1 border border-sb-hairline p-5 shadow-card rounded-2xl',
        'before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent',
        className
      )}
    >
      {/* Top Header & Horizon Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-xs',
              statusMeta.bgClass,
              statusMeta.borderClass
            )}
          >
            <Activity className={cn('h-5 w-5', statusMeta.colorClass)} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-sb-ink">Cash Flow Runway</h2>
              <Badge variant={statusMeta.badgeVariant} className="gap-1 text-xs">
                <StatusIcon className="h-3 w-3" aria-hidden="true" />
                {statusMeta.label}
              </Badge>
            </div>
            <p className="text-xs text-sb-ink-muted mt-0.5 leading-relaxed">
              Deterministic daily balance projection from your bank balance, scheduled bills, expected income, and daily burn.
            </p>
          </div>
        </div>

        {/* Horizon Pill Selector (30 / 60 / 90 Days) */}
        <div className="flex items-center gap-1 self-start sm:self-auto rounded-xl border border-sb-hairline bg-surface-2 p-1">
          {([30, 60, 90] as RunwayHorizon[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setHorizon(d)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer',
                horizon === d
                  ? 'bg-surface-1 text-sb-ink shadow-xs border border-sb-hairline'
                  : 'text-sb-ink-muted hover:text-sb-ink'
              )}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        {/* Starting Balance */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sb-ink-muted flex items-center gap-1">
            <Wallet className="h-3 w-3" /> Starting Balance
          </p>
          <p className="mt-1 text-base md:text-lg font-bold text-sb-ink tnum truncate">
            {formatCurrency(startingBalance)}
          </p>
          <p className="text-[11px] text-sb-ink-muted mt-0.5">Current bank cash</p>
        </div>

        {/* Projected Horizon Balance */}
        <div
          className={cn(
            'rounded-xl border p-3',
            simulation.endingBalance >= 0
              ? 'border-sb-hairline bg-surface-2/60'
              : 'border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)]'
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sb-ink-muted flex items-center gap-1">
            <Calendar className="h-3 w-3" /> {horizon}-Day Ending
          </p>
          <p
            className={cn(
              'mt-1 text-base md:text-lg font-bold tnum truncate',
              simulation.endingBalance >= 0
                ? 'text-[var(--status-positive-text)]'
                : 'text-[var(--status-danger-text)]'
            )}
          >
            {formatCurrency(simulation.endingBalance)}
          </p>
          <p className="text-[11px] text-sb-ink-muted mt-0.5">
            {simulation.endingBalance >= startingBalance ? 'Net liquidity gain' : 'Net liquidity draw'}
          </p>
        </div>

        {/* Runway Days */}
        <div
          className={cn(
            'rounded-xl border p-3',
            simulation.status === 'crunch'
              ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)]'
              : simulation.status === 'caution'
                ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)]'
                : 'border-sb-hairline bg-surface-2/60'
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sb-ink-muted">
            Runway Cushion
          </p>
          <p
            className={cn(
              'mt-1 text-base md:text-lg font-bold tnum truncate',
              simulation.status === 'crunch'
                ? 'text-[var(--status-danger-text)]'
                : simulation.status === 'caution'
                  ? 'text-[var(--status-warning-text)]'
                  : 'text-[var(--status-positive-text)]'
            )}
          >
            {simulation.status === 'crunch' ? `${simulation.runwayDays} Days` : `${horizon}+ Days`}
          </p>
          <p className="text-[11px] text-sb-ink-muted mt-0.5 truncate">
            {simulation.status === 'crunch'
              ? `Deficit on ${simulation.crunchDate ? formatDateShort(simulation.crunchDate) : ''}`
              : 'Zero deficit projected'}
          </p>
        </div>

        {/* Lowest Dip Point */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sb-ink-muted flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-amber-500" /> Lowest Dip
          </p>
          <p
            className={cn(
              'mt-1 text-base md:text-lg font-bold tnum truncate',
              simulation.lowestBalance < 0
                ? 'text-[var(--status-danger-text)]'
                : 'text-sb-ink'
            )}
          >
            {formatCurrency(simulation.lowestBalance)}
          </p>
          <p className="text-[11px] text-sb-ink-muted mt-0.5 truncate">
            {simulation.lowestBalanceDate ? formatDate(simulation.lowestBalanceDate) : 'No dip'}
          </p>
        </div>
      </div>

      {/* Alert Callout for Crunch or Dip */}
      {simulation.status === 'crunch' && simulation.crunchDate && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-xs text-[var(--status-danger-text)] leading-relaxed"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Projected Liquidity Crunch on {formatDate(simulation.crunchDate)}:</span>{' '}
            At current burn rate and planned payments, cash reserves will dip negative in {simulation.runwayDays} days. Consider deferring non-essential discretionary spends or accelerating receivables.
          </div>
        </div>
      )}

      {simulation.status === 'caution' && simulation.lowestBalanceDate && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] p-3.5 text-xs text-[var(--status-warning-text)] leading-relaxed"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Liquidity Trough on {formatDate(simulation.lowestBalanceDate)}:</span>{' '}
            Balance will dip to {formatCurrency(simulation.lowestBalance)} before recovering on expected payday. Maintain caution around this date.
          </div>
        </div>
      )}

      {/* SVG Interactive Chart Canvas */}
      <div className="relative w-full overflow-hidden rounded-xl border border-sb-hairline bg-surface-2/30 p-2 sm:p-4">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full h-auto overflow-visible select-none"
          aria-label="Cash flow runway balance projection graph"
        >
          <defs>
            {/* Area Fill Gradient */}
            <linearGradient id="runwayGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={simulation.status === 'crunch' ? '#ef4444' : '#10b981'}
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor={simulation.status === 'crunch' ? '#ef4444' : '#10b981'}
                stopOpacity="0.02"
              />
            </linearGradient>

            {/* Zero Line Marker */}
            <linearGradient id="deficitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.35" />
            </linearGradient>
          </defs>

          {/* Gridlines & Y-ticks */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PADDING_LEFT}
                y1={tick.y}
                x2={SVG_WIDTH - PADDING_RIGHT}
                y2={tick.y}
                stroke="var(--sb-hairline, #e4e4e7)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={PADDING_LEFT - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="text-[10px] font-medium fill-sb-ink-muted tnum"
              >
                {formatCurrencyCompact(tick.val)}
              </text>
            </g>
          ))}

          {/* Zero baseline (Deficit line) if visible */}
          {hasNegative && (
            <g>
              <line
                x1={PADDING_LEFT}
                y1={zeroY}
                x2={SVG_WIDTH - PADDING_RIGHT}
                y2={zeroY}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <text
                x={SVG_WIDTH - PADDING_RIGHT}
                y={zeroY - 6}
                textAnchor="end"
                className="text-[10px] font-bold fill-red-500 tnum"
              >
                ₹0 Crunch Line
              </text>
            </g>
          )}

          {/* Area Fill */}
          <path d={areaD} fill="url(#runwayGradient)" />

          {/* Runway Curve Line */}
          <path
            d={pathD}
            fill="none"
            stroke={statusMeta.strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X-axis ticks */}
          {xTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={tick.x}
                y1={SVG_HEIGHT - PADDING_BOTTOM}
                x2={tick.x}
                y2={SVG_HEIGHT - PADDING_BOTTOM + 5}
                stroke="var(--sb-hairline, #e4e4e7)"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={SVG_HEIGHT - PADDING_BOTTOM + 16}
                textAnchor="middle"
                className="text-[10px] font-medium fill-sb-ink-muted tnum"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Trough / Lowest Dip Marker */}
          {simulation.lowestBalanceDayIndex !== null && (
            <g>
              {(() => {
                const pt = chartPoints[simulation.lowestBalanceDayIndex]
                if (!pt) return null
                const cx = getX(pt.dayIndex)
                const cy = getY(pt.balance)
                return (
                  <g>
                    <circle cx={cx} cy={cy} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
                    <circle cx={cx} cy={cy} r="8" fill="none" stroke="#f59e0b" strokeWidth="1" strokeOpacity="0.5" />
                  </g>
                )
              })()}
            </g>
          )}

          {/* First Crunch Marker */}
          {simulation.crunchDayIndex !== null && (
            <g>
              {(() => {
                const pt = chartPoints[simulation.crunchDayIndex]
                if (!pt) return null
                const cx = getX(pt.dayIndex)
                const cy = getY(pt.balance)
                return (
                  <g>
                    <circle cx={cx} cy={cy} r="5.5" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
                    <circle cx={cx} cy={cy} r="9" fill="none" stroke="#ef4444" strokeWidth="1.5" className="animate-ping" />
                  </g>
                )
              })()}
            </g>
          )}

          {/* Hover Scrubber Line & Dot */}
          {hoveredPoint && (
            <g>
              <line
                x1={getX(hoveredPoint.dayIndex)}
                y1={PADDING_TOP}
                x2={getX(hoveredPoint.dayIndex)}
                y2={SVG_HEIGHT - PADDING_BOTTOM}
                stroke="var(--sb-ink, #27272a)"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                opacity="0.6"
              />
              <circle
                cx={getX(hoveredPoint.dayIndex)}
                cy={getY(hoveredPoint.balance)}
                r="6"
                fill={statusMeta.strokeColor}
                stroke="#ffffff"
                strokeWidth="2.5"
              />
            </g>
          )}

          {/* Interactive Transparent Hit Columns for Hover */}
          {chartPoints.map((pt, i) => {
            const x = getX(i)
            const width = SVG_WIDTH / horizon
            return (
              <rect
                key={i}
                x={x - width / 2}
                y={PADDING_TOP}
                width={width}
                height={SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
                onTouchStart={() => setHoveredPoint(pt)}
              />
            )
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && (
          <div
            className="pointer-events-none absolute z-20 rounded-xl border border-sb-hairline bg-surface-1 p-3 text-xs shadow-card animate-fade-in"
            style={{
              left: `${Math.min(85, Math.max(15, (hoveredPoint.dayIndex / horizon) * 100))}%`,
              top: '12px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-sb-hairline pb-1.5 mb-2 font-semibold">
              <span className="text-sb-ink">{formatDate(hoveredPoint.date)}</span>
              <span className="text-sb-ink-muted text-[11px]">Day {hoveredPoint.dayIndex}</span>
            </div>

            <div className="space-y-1.5 tnum">
              <div className="flex justify-between gap-4">
                <span className="text-sb-ink-muted">Projected Balance:</span>
                <span
                  className={cn(
                    'font-bold',
                    hoveredPoint.balance >= 0
                      ? 'text-[var(--status-positive-text)]'
                      : 'text-[var(--status-danger-text)]'
                  )}
                >
                  {formatCurrency(hoveredPoint.balance)}
                </span>
              </div>

              {hoveredPoint.expectedIncome > 0 && (
                <div className="flex justify-between gap-4 text-[var(--status-positive-text)]">
                  <span>
                    Inflow ({hoveredPoint.incomeItems.map((i) => i.name).join(', ')}):
                  </span>
                  <span className="font-semibold">+{formatCurrency(hoveredPoint.expectedIncome)}</span>
                </div>
              )}

              {hoveredPoint.plannedPayments > 0 && (
                <div className="flex justify-between gap-4 text-[var(--status-warning-text)]">
                  <span>
                    Bills ({hoveredPoint.paymentItems.map((p) => p.name).join(', ')}):
                  </span>
                  <span className="font-semibold">-{formatCurrency(hoveredPoint.plannedPayments)}</span>
                </div>
              )}

              <div className="flex justify-between gap-4 text-sb-ink-muted">
                <span>Discretionary Burn:</span>
                <span>-{formatCurrency(hoveredPoint.discretionarySpend)}</span>
              </div>

              <div className="border-t border-sb-hairline pt-1.5 flex justify-between gap-4 font-semibold">
                <span className="text-sb-ink">Net Day Shift:</span>
                <span
                  className={
                    hoveredPoint.netCashFlow >= 0
                      ? 'text-[var(--status-positive-text)]'
                      : 'text-[var(--status-warning-text)]'
                  }
                >
                  {hoveredPoint.netCashFlow >= 0 ? '+' : ''}
                  {formatCurrency(hoveredPoint.netCashFlow)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Curve Legends */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-sb-ink-muted border-t border-sb-hairline pt-3">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: statusMeta.strokeColor }}
            />
            <span>Projected Daily Balance</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
            <span>Lowest Dip Point</span>
          </span>
          {hasNegative && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
              <span>Crunch (Deficit)</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>{showSettings ? 'Hide Simulation Controls' : 'Simulation What-If & Rules'}</span>
          {showSettings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Simulation Assumptions & What-If Controls (Collapsible) */}
      {showSettings && (
        <div className="mt-4 rounded-xl border border-sb-hairline bg-surface-2/60 p-4 space-y-4 animate-fade-in text-xs">
          <div className="flex items-center justify-between border-b border-sb-hairline pb-2">
            <div>
              <h3 className="font-bold text-sb-ink text-sm">Simulation Assumptions & Controls</h3>
              <p className="text-sb-ink-muted text-xs">
                Test how adjusting your daily discretionary burn or income alters your cash runway.
              </p>
            </div>
            {(discretionaryAdjustment !== 0 || manualIncome !== null) && (
              <button
                type="button"
                onClick={() => {
                  setDiscretionaryAdjustment(0)
                  setManualIncome(null)
                }}
                className="inline-flex items-center gap-1 text-xs text-sb-ink-muted hover:text-sb-ink transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> Reset to Actuals
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Discretionary Spend Slider */}
            <div className="space-y-2 rounded-lg border border-sb-hairline bg-surface-1 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sb-ink">Daily Discretionary Burn</span>
                <span className="font-bold text-sb-ink tnum">
                  {formatCurrency(effectiveDiscretionary)} / day
                </span>
              </div>
              <p className="text-[11px] text-sb-ink-muted">
                Baseline: {formatCurrency(baselineDiscretionary)}/day (variable spends excluding bills).
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="-50"
                  max="50"
                  step="5"
                  value={discretionaryAdjustment}
                  onChange={(e) => setDiscretionaryAdjustment(Number(e.target.value))}
                  className="w-full accent-brand-600 cursor-pointer"
                />
                <span className="w-12 text-right font-semibold tnum">
                  {discretionaryAdjustment > 0 ? `+${discretionaryAdjustment}%` : `${discretionaryAdjustment}%`}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-sb-ink-muted">
                <span>Frugal (-50%)</span>
                <span>Actual (0%)</span>
                <span>Expanded (+50%)</span>
              </div>
            </div>

            {/* Incomes & Bills detected */}
            <div className="space-y-2 rounded-lg border border-sb-hairline bg-surface-1 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sb-ink">Planned Recurring Inflows & Bills</span>
                <span className="text-[11px] text-sb-ink-muted">
                  {simulation.detectedIncomes.length} Incomes · {simulation.plannedPayments.length} Bills
                </span>
              </div>
              <ul className="space-y-1 max-h-24 overflow-y-auto scrollbar-none text-[11px]">
                {simulation.detectedIncomes.map((inc) => (
                  <li key={inc.id} className="flex justify-between text-[var(--status-positive-text)]">
                    <span>{inc.name} (Day {inc.dayOfMonth})</span>
                    <span className="font-semibold tnum">+{formatCurrency(inc.amount)}</span>
                  </li>
                ))}
                {simulation.plannedPayments.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex justify-between text-sb-ink-muted">
                    <span className="truncate">{p.name} ({formatDateShort(p.nextDate)})</span>
                    <span className="font-semibold text-[var(--status-warning-text)] tnum">
                      -{formatCurrency(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

export default CashFlowRunway
