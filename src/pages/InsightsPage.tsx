// ============================================
// InsightsPage — Visual & Advisory Hub
// Merged Insights and CA Advisory dashboard
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { Card, DateFilterPicker } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { fetchAllTransactions } from '@/services/transactions'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import { getCurrentMonth, withTimeout, resolveDateFilter, formatDateFilterLabel, resolveTransactionIdentity, creditCardBillCategoryNames, type DateFilter } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import { completedMonthsWindow, computeEmergencyMonths } from './analytics/emergencyReserve'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { detectAnomalies, generateForecast, generateAIInsights } from '@/services/aiService'
import type { FinancialContext } from '@/services/aiService'
import { getBudgets } from '@/services/budgets'
import { DrillDownProvider, useDrillDown } from '@/context/DrillDownContext'
import { DrillDownModal } from '@/pages/analytics/DrillDownModal'
import {
  AdherenceDiagnostic,
  BudgetVisualizer,
  AnomalyAlerts,
  AIInsights,
  ScenarioSimulator,
  ForecastPanel,
  TrendChart,
  ExpenseBreakdown,
  CreditCardPaymentTrend,
  SmartWealthTips,
  PeriodSelector,
  MerchantLeaderboard,
  CategoryTrendChart,
  BudgetBurndown,
  type RangeType,
  type MerchantLeaderboardItem,
  type CategoryTrendMonth,
  type BudgetBurndownItem,
  type CreditCardPaymentTrendItem
} from './analytics'

interface TrendItem {
  label: string
  income: number
  expenses: number
  savings: number
  /** Present on day-bucketed ranges (this-week, last-week, last-15-days). */
  dateStr?: string
  /** Present on the last-month range (week buckets). */
  startStr?: string
  endStr?: string
  /** Present on the last-6-months range. */
  monthKey?: string
}

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
}

/**
 * Sets `end` to the last moment of the day six days after `start`.
 *
 * This has to seed `end` from `start` first. The previous version did
 * `end.setDate(start.getDate() + 6)` while `end` still held today's date, so
 * only the day-of-month carried over and it was applied to the *current*
 * month. Any week straddling a month boundary then blew up: on Wed 2 Sep 2026
 * the Monday is 31 Aug, and `setDate(37)` on September produced 7 Oct — a
 * five-week "This Week".
 */
const setToSixDaysAfter = (end: Date, start: Date) => {
  end.setTime(start.getTime())
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
}

const getRangeDates = (range: RangeType) => {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (range === 'this-week') {
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day // Monday start
    start.setDate(now.getDate() + diff)
    start.setHours(0, 0, 0, 0)

    setToSixDaysAfter(end, start)
  } else if (range === 'last-week') {
    const day = now.getDay()
    const diff = (day === 0 ? -6 : 1 - day) - 7 // Previous Monday start
    start.setDate(now.getDate() + diff)
    start.setHours(0, 0, 0, 0)

    setToSixDaysAfter(end, start)
  } else if (range === 'this-month') {
    // Full calendar month, so this matches the Dashboard and Expenses totals
    // exactly — both of those scope to `{ mode: 'month' }`, not a rolling window.
    start.setDate(1)
    start.setHours(0, 0, 0, 0)

    end.setDate(1)
    end.setMonth(now.getMonth() + 1, 0) // day 0 of next month = last day of this one
    end.setHours(23, 59, 59, 999)
  } else if (range === 'last-15-days') {
    start.setDate(now.getDate() - 14)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else if (range === 'last-month') {
    // The previous calendar month, not a rolling 30 days. setDate(1) first so
    // stepping the month back from a 31st never overflows into the wrong month.
    start.setDate(1)
    start.setMonth(now.getMonth() - 1)
    start.setHours(0, 0, 0, 0)

    end.setDate(1)
    end.setMonth(now.getMonth(), 0) // day 0 of this month = last day of the previous one
    end.setHours(23, 59, 59, 999)
  } else if (range === 'last-6-months') {
    start.setDate(1)
    start.setMonth(now.getMonth() - 5)
    start.setHours(0, 0, 0, 0)

    end.setDate(1)
    end.setMonth(now.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
  }
  return { start, end }
}

/** True when a credit row counts as income.
 *
 * One definition across the whole page: a credit is income only when its
 * category carries the `income` analytics tag — the same rule the advisory
 * block has always used. Counting every credit here meant refunds, reversals
 * and transfers in inflated the trend chart and the savings rate, so the same
 * period reported two different incomes depending on which card you read.
 * Untagged credits are neither income nor expense; they are simply not spend. */
const isIncomeRow = (t: { type: string; category: string }, incomeCategories: string[]) =>
  t.type === 'credit' && incomeCategories.includes(t.category)

const getTrendData = (txns: any[], range: RangeType, incomeCategories: string[]): TrendItem[] => {
  const { start } = getRangeDates(range)
  
  if (range === 'this-week' || range === 'last-week') {
    const days: TrendItem[] = []
    const temp = new Date(start)
    for (let i = 0; i < 7; i++) {
      const dateStr = toISODateLocal(temp)
      const label = temp.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })
      days.push({ dateStr, label, income: 0, expenses: 0, savings: 0 })
      temp.setDate(temp.getDate() + 1)
    }
    txns.forEach((t) => {
      const dayObj = days.find((d) => d.dateStr === t.date)
      if (dayObj) {
        const amt = Number(t.amount)
        if (t.type === 'credit') {
          if (isIncomeRow(t, incomeCategories)) dayObj.income += amt
        } else {
          dayObj.expenses += amt
        }
        dayObj.savings = dayObj.income - dayObj.expenses
      }
    })
    return days
  }
  
  if (range === 'last-15-days') {
    const days: TrendItem[] = []
    const temp = new Date(start)
    for (let i = 0; i < 15; i++) {
      const dateStr = toISODateLocal(temp)
      const label = temp.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      days.push({ dateStr, label, income: 0, expenses: 0, savings: 0 })
      temp.setDate(temp.getDate() + 1)
    }
    txns.forEach((t) => {
      const dayObj = days.find((d) => d.dateStr === t.date)
      if (dayObj) {
        const amt = Number(t.amount)
        if (t.type === 'credit') {
          if (isIncomeRow(t, incomeCategories)) dayObj.income += amt
        } else {
          dayObj.expenses += amt
        }
        dayObj.savings = dayObj.income - dayObj.expenses
      }
    })
    return days
  }
  
  if (range === 'this-month' || range === 'last-month') {
    // Calendar weeks of the month: 1-7, 8-14, 15-21, 22-end. A calendar month
    // is 28-31 days, so the last bucket absorbs the remainder rather than being
    // cut at a fixed 30 — which is what the old rolling last-month buckets did,
    // silently dropping the 31st of every long month.
    const { end } = getRangeDates(range)
    const lastDay = end.getDate()
    const weekRanges = [
      { label: 'Week 1', from: 1, to: 7 },
      { label: 'Week 2', from: 8, to: 14 },
      { label: 'Week 3', from: 15, to: 21 },
      { label: 'Week 4', from: 22, to: lastDay },
    ].map((w) => {
      const wStart = new Date(start)
      wStart.setDate(w.from)
      const wEnd = new Date(start)
      wEnd.setDate(w.to)
      return {
        label: w.label,
        startStr: toISODateLocal(wStart),
        endStr: toISODateLocal(wEnd),
        income: 0,
        expenses: 0,
        savings: 0,
      }
    })

    txns.forEach((t) => {
      if (!t.date) return
      const week = weekRanges.find((w) => t.date >= w.startStr && t.date <= w.endStr)
      if (week) {
        const amt = Number(t.amount)
        if (t.type === 'credit') {
          if (isIncomeRow(t, incomeCategories)) week.income += amt
        } else {
          week.expenses += amt
        }
        week.savings = week.income - week.expenses
      }
    })
    return weekRanges
  }

  if (range === 'last-6-months') {
    const monthsList: TrendItem[] = []
    const temp = new Date(start)
    for (let i = 0; i < 6; i++) {
      const year = temp.getFullYear()
      const mon = temp.getMonth()
      const monthKey = `${year}-${String(mon + 1).padStart(2, '0')}`
      const label = temp.toLocaleDateString('en-IN', { month: 'short' }) + ' ' + String(year).substring(2)
      monthsList.push({ monthKey, label, income: 0, expenses: 0, savings: 0 })
      temp.setMonth(temp.getMonth() + 1)
    }
    
    txns.forEach((t) => {
      if (!t.date) return
      const tMonth = t.date.substring(0, 7)
      const monthObj = monthsList.find((m) => m.monthKey === tMonth)
      if (monthObj) {
        const amt = Number(t.amount)
        if (t.type === 'credit') {
          if (isIncomeRow(t, incomeCategories)) monthObj.income += amt
        } else {
          monthObj.expenses += amt
        }
        monthObj.savings = monthObj.income - monthObj.expenses
      }
    })
    return monthsList
  }
  
  return []
}

const getAllocationData = (txns: any[], range: RangeType, incomeCategories: string[]): SummaryData => {
  const { start, end } = getRangeDates(range)
  const startStr = toISODateLocal(start)
  const endStr = toISODateLocal(end)
  
  const filtered = txns.filter((t) => t.date && t.date >= startStr && t.date <= endStr)
  
  const total_income = filtered
    .filter((t) => isIncomeRow(t, incomeCategories))
    .reduce((sum, t) => sum + Number(t.amount), 0)
    
  const total_expenses = filtered
    .filter((t) => t.type === 'debit')
    .reduce((sum, t) => sum + Number(t.amount), 0)
    
  const categoryMap = new Map<string, { amount: number; count: number }>()
  filtered
    .filter((t) => t.type === 'debit')
    .forEach((t) => {
      const existing = categoryMap.get(t.category) || { amount: 0, count: 0 }
      categoryMap.set(t.category, {
        amount: existing.amount + Number(t.amount),
        count: existing.count + 1,
      })
    })
    
  const category_breakdown = Array.from(categoryMap.entries())
    .map(([category, { amount, count }]) => ({
      category,
      amount,
      count,
      percentage: total_expenses > 0 ? (amount / total_expenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    
  return {
    total_income,
    total_expenses,
    savings: total_income - total_expenses,
    category_breakdown,
  }
}

const getMoMTrend = (allTxns: any[], incomeCategories: string[]) => {
  const monthlyStats = getTrendData(allTxns, 'last-6-months', incomeCategories)
  if (monthlyStats.length < 2) return null
  
  const prevMonthData = monthlyStats[monthlyStats.length - 2]
  const curMonthData = monthlyStats[monthlyStats.length - 1]
  
  if (!prevMonthData || !curMonthData || prevMonthData.expenses === 0) return null

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  let curExpenses = curMonthData.expenses
  if (curMonthData.monthKey === currentMonthKey) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysElapsed = Math.max(1, now.getDate())
    // Blend prorated run-rate with actual spend during the first 7 days to prevent early-month lump-sum spike distortion
    const weight = Math.min(1, daysElapsed / 7)
    const prorated = (curMonthData.expenses / daysElapsed) * daysInMonth
    curExpenses = weight * prorated + (1 - weight) * curMonthData.expenses
  }
  
  const diff = curExpenses - prevMonthData.expenses
  const pct = (diff / prevMonthData.expenses) * 100
  return {
    diff,
    pct,
    increased: diff > 0,
    prevLabel: prevMonthData.label,
  }
}

/** Pure: groups debit transactions in [startStr, endStr] by resolved merchant identity. Extracted so it's testable without rendering the page. Defaults to the full range when no bounds are passed (used by the memo below, which always passes explicit bounds). */
export function buildMerchantLeaderboard(
  txns: Array<{ type: string; date: string | null; amount: number; merchant?: string | null; description?: string | null }>,
  bounds?: { startStr: string; endStr: string }
): MerchantLeaderboardItem[] {
  const merchantMap = new Map<string, { amount: number; count: number }>()
  txns
    .filter((t) => {
      if (t.type !== 'debit' || !t.date) return false
      if (!bounds) return true
      return t.date >= bounds.startStr && t.date <= bounds.endStr
    })
    .forEach((t) => {
      const { title } = resolveTransactionIdentity(t)
      const existing = merchantMap.get(title) || { amount: 0, count: 0 }
      merchantMap.set(title, { amount: existing.amount + Number(t.amount), count: existing.count + 1 })
    })

  return Array.from(merchantMap.entries())
    .map(([merchant, { amount, count }]) => ({ merchant, amount, count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
}

export default function InsightsPage() {
  const { user } = useAuth()
  const { categories, categoryMap } = useCategories()

  // 50/30/20 buckets — derived from each category's analytics_tags rather
  // than hardcoded display names, so a rename doesn't silently break these.
  const needsCategoryNames = useMemo(
    () => categories.filter((c) => c.analytics_tags?.includes('needs')).map((c) => c.name),
    [categories]
  )
  const wantsCategoryNames = useMemo(
    () => categories.filter((c) => c.analytics_tags?.includes('wants')).map((c) => c.name),
    [categories]
  )
  const savingsCategoryNames = useMemo(
    () => categories.filter((c) => c.analytics_tags?.includes('savings')).map((c) => c.name),
    [categories]
  )
  const ccBillCategories = useMemo(() => creditCardBillCategoryNames(categories), [categories])
  const incomeCategoryNames = useMemo(
    () => categories.filter((c) => c.analytics_tags?.includes('income')).map((c) => c.name),
    [categories]
  )
  const hasTag = (categoryName: string, tag: 'income' | 'subscription' | 'credit_card_bill') =>
    categoryMap[categoryName]?.analytics_tags?.includes(tag) ?? false
  const [range, setRange] = useState<RangeType>('this-week')
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Progressive disclosure — a mixed-literacy audience opening 8 analytics
  // modules at once tends to bounce off the page entirely. Default to the 3
  // core ones; remember the choice once someone opts into the rest.
  const [showAdvanced, setShowAdvanced] = useState(
    () => localStorage.getItem('intrack_analytics_advanced') === 'true'
  )
  const toggleAdvanced = () => {
    setShowAdvanced((prev) => {
      const next = !prev
      localStorage.setItem('intrack_analytics_advanced', String(next))
      return next
    })
  }

  // AI Insights State
  const [aiInsights, setAiInsights] = useState<string[]>([])
  const [aiAlerts, setAiAlerts] = useState<string[]>([])
  const [aiSource, setAiSource] = useState<'gemini' | 'rule-based' | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // Advisory Month Picker & Simulator State
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
  const [simSalary, setSimSalary] = useState<number>(0)
  const [simWants, setSimWants] = useState<number>(0)

  useEffect(() => {
    if (user) localStorage.setItem(`intrack_visited_analytics_${user.id}`, 'true')
  }, [user])

  const fetchAllData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const sixMonthsAgo = (() => {
        const d = new Date()
        d.setMonth(d.getMonth() - 6)
        return toISODateLocal(d)
      })()

      // fetchAllTransactions, not a bare .select(): PostgREST clamps a response
      // to its own db-max-rows (1000 here), and a single unbounded query has no
      // way to tell a complete answer from a truncated one. Ordering newest-first
      // only chose *which* rows got dropped — a heavy user still lost their
      // oldest months from every six-month chart on this page, with no error
      // anywhere. This pages until the server says there is nothing left.
      // The Dashboard's anomaly teaser already fetches this way for the same
      // reason; see src/services/transactions.ts.
      const { data, error: queryError } = await withTimeout(
        fetchAllTransactions({ dateFrom: sixMonthsAgo }),
        45000,
        'Insights data fetch'
      )

      if (queryError) throw queryError
      setTransactions(data || [])
    } catch (err: any) {
      console.error('Error fetching insights data:', err)
      setError(err.message || 'Failed to load financial analysis.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = `Insights | ${APP_CONFIG.APP_NAME}`
    fetchAllData()
  }, [fetchAllData])

  // Credit card bill payments are excluded from every total/trend/breakdown on
  // this page — the purchases they cover were already counted as expenses when
  // they happened, so counting the bill payment too would double-book that
  // spend. The raw `transactions` array is still used, unfiltered, by the new
  // dedicated credit-card-payment trend chart added in the next task.
  const expenseTransactions = useMemo(
    () => transactions.filter((t) => !hasTag(t.category, 'credit_card_bill')),
    [transactions, categoryMap]
  )

  const ccBillPaymentTrend = useMemo(() => {
    const months: { monthKey: string; label: string; amount: number }[] = []
    const temp = new Date()
    temp.setDate(1)
    temp.setMonth(temp.getMonth() - 5)
    for (let i = 0; i < 6; i++) {
      const year = temp.getFullYear()
      const mon = temp.getMonth()
      const monthKey = `${year}-${String(mon + 1).padStart(2, '0')}`
      const label = temp.toLocaleDateString('en-IN', { month: 'short' }) + ' ' + String(year).substring(2)
      months.push({ monthKey, label, amount: 0 })
      temp.setMonth(temp.getMonth() + 1)
    }

    transactions
      // Debits only: a bill *payment* is money going out. A credit sitting in a
      // credit-card-bill category is a reversal or refund, and adding it to the
      // bar made the bar disagree with the list behind it.
      .filter((t) => t.type === 'debit' && hasTag(t.category, 'credit_card_bill') && t.date)
      .forEach((t) => {
        const tMonth = t.date.substring(0, 7)
        const monthObj = months.find((m) => m.monthKey === tMonth)
        if (monthObj) monthObj.amount += Number(t.amount)
      })

    return months.map(({ monthKey, label, amount }) => ({ monthKey, label, amount }))
  }, [transactions, categoryMap])

  // Top merchants by spend for the selected range — recognized brands hiding
  // in raw narration are folded into their real merchant's total; anything
  // else collapses into a single "Unclassified" row instead of leaking
  // narration text into the ranking.
  const merchantLeaderboard = useMemo<MerchantLeaderboardItem[]>(() => {
    const { start, end } = getRangeDates(range)
    return buildMerchantLeaderboard(expenseTransactions, {
      startStr: toISODateLocal(start),
      endStr: toISODateLocal(end),
    })
  }, [expenseTransactions, range])

  // Top-5 category spend per month over the trailing 6 months — independent
  // of the range selector, since the point is to see the multi-month shape.
  const categoryTrendData = useMemo<CategoryTrendMonth[]>(() => {
    const monthKeys: string[] = []
    const monthMeta = new Map<string, { label: string; catTotals: Map<string, number> }>()
    const temp = new Date()
    temp.setDate(1)
    temp.setMonth(temp.getMonth() - 5)
    for (let i = 0; i < 6; i++) {
      const year = temp.getFullYear()
      const mon = temp.getMonth()
      const monthKey = `${year}-${String(mon + 1).padStart(2, '0')}`
      const label = temp.toLocaleDateString('en-IN', { month: 'short' }) + ' ' + String(year).substring(2)
      monthKeys.push(monthKey)
      monthMeta.set(monthKey, { label, catTotals: new Map() })
      temp.setMonth(temp.getMonth() + 1)
    }

    expenseTransactions.forEach((t) => {
      if (t.type !== 'debit' || !t.date) return
      const bucket = monthMeta.get(t.date.substring(0, 7))
      if (!bucket) return
      bucket.catTotals.set(t.category, (bucket.catTotals.get(t.category) || 0) + Number(t.amount))
    })

    const overallTotals = new Map<string, number>()
    monthMeta.forEach(({ catTotals }) => {
      catTotals.forEach((amt, cat) => overallTotals.set(cat, (overallTotals.get(cat) || 0) + amt))
    })
    const topCategories = Array.from(overallTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat)

    return monthKeys.map((monthKey) => {
      const { label, catTotals } = monthMeta.get(monthKey)!
      const segments = topCategories.map((category) => ({ category, amount: catTotals.get(category) || 0 }))
      const topSum = segments.reduce((sum, s) => sum + s.amount, 0)
      const total = Array.from(catTotals.values()).reduce((sum, v) => sum + v, 0)
      const otherAmount = total - topSum
      if (otherAmount > 0.01) segments.push({ category: '__other__', amount: otherAmount })
      return { monthKey, label, total, segments }
    })
  }, [expenseTransactions])

  // 1. Cashflow Analytics Data (memoized to avoid recalculation on every render)
  const trendData = useMemo(
    () => getTrendData(expenseTransactions, range, incomeCategoryNames),
    [expenseTransactions, range, incomeCategoryNames]
  )
  const summary = useMemo(
    () => getAllocationData(expenseTransactions, range, incomeCategoryNames),
    [expenseTransactions, range, incomeCategoryNames]
  )
  const trend = useMemo(
    () => getMoMTrend(expenseTransactions, incomeCategoryNames),
    [expenseTransactions, incomeCategoryNames]
  )

  // 2. Anomaly detection & forecasting (memoized)
  const anomalies = useMemo(() => detectAnomalies(expenseTransactions), [expenseTransactions])
  const forecast = useMemo(() => generateForecast(expenseTransactions), [expenseTransactions])

  const savingsRate =
    summary && summary.total_income > 0
      ? (summary.savings / summary.total_income) * 100
      : 0

  // Budgets for the burn-down chart — fetched separately since the summary
  // query above doesn't carry limit amounts, only actuals.
  const [budgets, setBudgets] = useState<Array<{ category: string; amount: number }>>([])
  useEffect(() => {
    let cancelled = false
    const targetMonth = dateFilter.mode === 'month' ? dateFilter.month : resolveDateFilter(dateFilter).dateTo.slice(0, 7)
    getBudgets(targetMonth).then(({ data }) => {
      if (!cancelled) setBudgets((data || []).map((b) => ({ category: b.category, amount: Number(b.amount) })))
    })
    return () => { cancelled = true }
  }, [dateFilter])

  // 2. CA Advisory Computations — bound to Advisory Period date filter
  const { advisoryFrom, advisoryTo } = useMemo(() => {
    const resolved = resolveDateFilter(dateFilter)
    return { advisoryFrom: resolved.dateFrom, advisoryTo: resolved.dateTo }
  }, [dateFilter])
  const monthlyTxns = useMemo(
    () => expenseTransactions.filter((t) => t.date && t.date >= advisoryFrom && t.date <= advisoryTo),
    [expenseTransactions, advisoryFrom, advisoryTo]
  )

  // Budget burn-down — cumulative actual spend per budgeted category against
  // an even daily pace, projected forward at the current run-rate.
  const budgetBurndownData = useMemo<BudgetBurndownItem[]>(() => {
    if (budgets.length === 0) return []

    const targetMonth = dateFilter.mode === 'month' ? dateFilter.month : resolveDateFilter(dateFilter).dateTo.slice(0, 7)
    const [y, m] = targetMonth.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const isCurrentMonth = targetMonth === getCurrentMonth()
    const daysElapsed = isCurrentMonth ? Math.min(new Date().getDate(), daysInMonth) : daysInMonth

    return budgets
      .filter((b) => b.amount > 0)
      .map((b) => {
        const dailyTotals = new Array(daysInMonth).fill(0)
        monthlyTxns
          // `startsWith(targetMonth)` is load-bearing: monthlyTxns follows the
          // advisory period, which in Custom mode can span several months, and
          // the day-of-month bucketing below would otherwise pile 5 July and
          // 5 August into the same slot.
          .filter((t) => t.type === 'debit' && t.category === b.category && t.date?.startsWith(targetMonth))
          .forEach((t) => {
            const day = Number(t.date.slice(8, 10))
            if (day >= 1 && day <= daysInMonth) dailyTotals[day - 1] += Number(t.amount)
          })

        const cumulative: number[] = []
        let running = 0
        dailyTotals.forEach((v) => {
          running += v
          cumulative.push(running)
        })

        const spentSoFar = cumulative[daysElapsed - 1] ?? running
        const dailyPace = daysElapsed > 0 ? spentSoFar / daysElapsed : 0
        const projectedTotal = dailyPace * daysInMonth
        const projectedOverBy = projectedTotal - b.amount

        const asDayLabel = (day: number) =>
          new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

        // If the limit has already been crossed, report the day it ACTUALLY
        // happened by reading the cumulative curve. Deriving that date from the
        // average daily pace named the wrong day whenever spending was lumpy.
        const crossedOnIndex = cumulative.findIndex((v, i) => i < daysElapsed && v > b.amount)

        let projectedOverDate: string | null = null
        let isPastOvershoot = false
        if (crossedOnIndex >= 0) {
          isPastOvershoot = true
          projectedOverDate = asDayLabel(crossedOnIndex + 1)
        } else if (dailyPace > 0 && projectedOverBy > 0) {
          // Not crossed yet, so the projected day must lie ahead of today.
          const dayOfOvershoot = Math.min(
            daysInMonth,
            Math.max(daysElapsed + 1, Math.ceil(b.amount / dailyPace))
          )
          projectedOverDate = asDayLabel(dayOfOvershoot)
        }

        return {
          category: b.category,
          budgetAmount: b.amount,
          cumulative,
          daysInMonth,
          daysElapsed,
          spentSoFar,
          projectedTotal,
          projectedOverBy,
          projectedOverDate,
          isPastOvershoot,
        }
      })
      .sort((a, b) => b.spentSoFar / b.budgetAmount - a.spentSoFar / a.budgetAmount)
  }, [budgets, monthlyTxns, dateFilter])

  const incomeTxns = monthlyTxns.filter((t) => isIncomeRow(t, incomeCategoryNames))
  const totalIncome = incomeTxns.reduce((sum, t) => sum + Number(t.amount), 0)

  const debitTxns = monthlyTxns.filter((t) => t.type === 'debit')
  const totalDebit = debitTxns.reduce((sum, t) => sum + Number(t.amount), 0)

  // Category split for the advisory block (health score card, AI wealth
  // advisory), scoped to the "Advisory period" picker like every other number
  // in that block. It deliberately does NOT reuse `summary.category_breakdown`,
  // which follows the header "Range" selector instead — reading it here fed the
  // AI a month's totals alongside a single week's category split, so the
  // percentages could not reconcile with the totals sitting next to them.
  const advisoryCategoryBreakdown = (() => {
    const byCategory = new Map<string, { amount: number; count: number }>()
    debitTxns.forEach((t) => {
      const existing = byCategory.get(t.category) || { amount: 0, count: 0 }
      byCategory.set(t.category, {
        amount: existing.amount + Number(t.amount),
        count: existing.count + 1,
      })
    })
    return Array.from(byCategory.entries())
      .map(([category, { amount, count }]) => ({
        category,
        amount,
        count,
        percentage: totalDebit > 0 ? (amount / totalDebit) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  })()

  const needsSpent = debitTxns
    .filter((t) => needsCategoryNames.includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const wantsSpent = debitTxns
    .filter((t) => wantsCategoryNames.includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const savingsSpent = debitTxns
    .filter((t) => savingsCategoryNames.includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const denominator = totalIncome > 0 ? totalIncome : totalDebit || 1
  const needsPct = Math.round((needsSpent / denominator) * 100)
  const wantsPct = Math.round((wantsSpent / denominator) * 100)
  // Actual spend into savings-tagged categories, measured the same way Needs
  // and Wants are. This used to be the *residual* (income - needs - wants),
  // which silently counted every untagged category as savings and could not be
  // reconciled with the rupee figure or the transaction list beside it.
  const savingsPct = Math.round((savingsSpent / denominator) * 100)

  const finalSavingsPct = Math.max(0, savingsPct)

  const needsVariance = Math.abs(needsPct - 50)
  const wantsVariance = Math.abs(wantsPct - 30)
  const savingsVariance = Math.abs(finalSavingsPct - 20)
  const totalVariance = needsVariance + wantsVariance + savingsVariance
  const healthScore = Math.max(10, 100 - Math.round(totalVariance * 1.5))

  // Deliberately NOT scoped to the advisory period — a reserve is a stock, and
  // its coverage should not move when the period picker moves. See
  // computeEmergencyMonths above.
  const emergencyMonths = useMemo(
    () =>
      computeEmergencyMonths(
        expenseTransactions,
        savingsCategoryNames,
        needsCategoryNames,
        completedMonthsWindow()
      ),
    [expenseTransactions, savingsCategoryNames, needsCategoryNames]
  )
  const isEmergencyFundReady = emergencyMonths >= 6

  // Set default simulation inputs once data is loaded
  useEffect(() => {
    if (totalIncome > 0 && simSalary === 0) {
      setSimSalary(totalIncome)
    }
    if (wantsSpent > 0 && simWants === 0) {
      setSimWants(wantsSpent)
    }
  }, [totalIncome, wantsSpent])

  // Generate AI insights when financial data is ready — only once the
  // advanced section is actually opened, so users who never look don't
  // burn Gemini quota for a card they'll never see.
  useEffect(() => {
    if (!showAdvanced) return
    if (loading || transactions.length === 0) return
    if (totalIncome === 0 && totalDebit === 0) return

    const ctx: FinancialContext = {
      month: dateFilter.mode === 'month' ? dateFilter.month : formatDateFilterLabel(dateFilter),
      totalIncome,
      totalExpenses: totalDebit,
      savings: totalIncome - totalDebit,
      savingsRate: totalIncome > 0 ? ((totalIncome - totalDebit) / totalIncome) * 100 : 0,
      needsPct,
      wantsPct,
      savingsPct: finalSavingsPct,
      healthScore,
      topCategory: advisoryCategoryBreakdown[0]?.category || 'Other',
      topCategoryAmount: advisoryCategoryBreakdown[0]?.amount || 0,
      topCategoryPct: advisoryCategoryBreakdown[0]?.percentage || 0,
      momTrend: trend,
      // The prompt renders this as "/month", so it has to be the advisory
      // period's subscription spend. Summing the whole 6-month `transactions`
      // window reported roughly six months of subscriptions as one month's burn.
      subscriptionBurn: debitTxns
        .filter((t) => hasTag(t.category, 'subscription'))
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0),
      emergencyMonths,
      categoryBreakdown: advisoryCategoryBreakdown,
    }

    setAiLoading(true)
    generateAIInsights(ctx)
      .then(({ insights, alerts, source }) => {
        setAiInsights(insights)
        setAiAlerts(alerts)
        setAiSource(source)
      })
      .catch(() => {
        setAiInsights([])
        setAiAlerts([])
      })
      .finally(() => setAiLoading(false))
  }, [loading, transactions.length, dateFilter, showAdvanced, categoryMap])

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Unified Main Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 bg-surface-2/10 border border-border-subtle/10 rounded-2xl backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Insights</h1>
            <p className="mt-1 text-xs text-zinc-400">
              Understand where your money went this period and whether your spending split is healthy.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center shrink-0 bg-surface-2/40 border border-border-subtle/30 rounded-xl px-3 py-2">
            <span className="text-xs text-zinc-500">Range:</span>
            <PeriodSelector value={range} onChange={setRange} id="insights-range" />
          </div>
        </div>

        <Link
          to="/budgets"
          className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle/40 bg-surface-2/30 px-4 py-2.5 text-xs text-zinc-400 hover:bg-surface-2/60 hover:text-zinc-200 transition-colors"
        >
          <span>Want spending limits with overspend alerts instead?</span>
          <span className="font-semibold text-brand-400 shrink-0">Budgets →</span>
        </Link>

        {error && (
          <div className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-xs text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        <DrillDownProvider onDirtyClose={fetchAllData}>
          {/* Core view: trend, breakdown, one tip — enough for most check-ins */}
          <TrendChartWithDrillDown
            range={range}
            trendData={trendData}
            loading={loading}
            hasTransactions={transactions.length > 0}
            ccBillCategories={ccBillCategories}
            incomeCategories={incomeCategoryNames}
          />

          <CreditCardPaymentTrendWithDrillDown data={ccBillPaymentTrend} loading={loading} ccBillCategories={ccBillCategories} />

          <div className="grid gap-6 lg:grid-cols-12">
            <ExpenseBreakdownWithDrillDown summary={summary} loading={loading} range={range} />
            <SmartWealthTips
              loading={loading}
              summary={summary}
              trend={trend}
              savingsRate={savingsRate}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <CategoryTrendChartWithDrillDown data={categoryTrendData} loading={loading} hasTransactions={categoryTrendData.some((m) => m.total > 0)} />
            <MerchantLeaderboardWithDrillDown data={merchantLeaderboard} loading={loading} range={range} ccBillCategories={ccBillCategories} />
          </div>

          {/* Progressive disclosure toggle */}
          {!loading && (
            <button
              onClick={toggleAdvanced}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border-subtle/50 bg-surface-2/40 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-surface-2 transition-colors"
            >
              {showAdvanced ? (
                <>Hide advanced analysis <ChevronUp className="h-3.5 w-3.5" /></>
              ) : (
                <>Show advanced analysis — health score, AI insights, forecast, anomalies <ChevronDown className="h-3.5 w-3.5" /></>
              )}
            </button>
          )}

          {showAdvanced && (
            <>
              <div className="flex items-center justify-end gap-2 -mt-2">
                <span className="text-xs text-zinc-500">Advisory period:</span>
                <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
              </div>

              {/* Executive Diagnostic Summary */}
              {loading ? (
                <div className="grid gap-6 md:grid-cols-3">
                  <Card className="h-60 skeleton"><div /></Card>
                  <Card className="md:col-span-2 h-60 skeleton"><div /></Card>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-3">
                  <AdherenceDiagnosticWithDrillDown
                    healthScore={healthScore}
                    totalIncome={totalIncome}
                    totalDebit={totalDebit}
                    advisoryFrom={advisoryFrom}
                    advisoryTo={advisoryTo}
                    ccBillCategories={ccBillCategories}
                    incomeCategories={incomeCategoryNames}
                  />
                  <BudgetVisualizerWithDrillDown
                    needsSpent={needsSpent}
                    needsPct={needsPct}
                    wantsSpent={wantsSpent}
                    wantsPct={wantsPct}
                    savingsSpent={savingsSpent}
                    finalSavingsPct={finalSavingsPct}
                    emergencyMonths={emergencyMonths}
                    isEmergencyFundReady={isEmergencyFundReady}
                    advisoryFrom={advisoryFrom}
                    advisoryTo={advisoryTo}
                    needsCategoryNames={needsCategoryNames}
                    wantsCategoryNames={wantsCategoryNames}
                    savingsCategoryNames={savingsCategoryNames}
                  />
                </div>
              )}

              {!loading && (
                <BudgetBurndownWithDrillDown data={budgetBurndownData} loading={loading} dateFilter={dateFilter} />
              )}

              {/* AI Wealth Advisory + Anomalies + Scenario Simulator */}
              {!loading && (
                <div className="space-y-6">
                  <AnomalyAlertsWithDrillDown anomalies={anomalies} />

                  <div className="grid gap-6 md:grid-cols-2">
                    <AIInsights
                      aiSource={aiSource}
                      aiLoading={aiLoading}
                      aiAlerts={aiAlerts}
                      aiInsights={aiInsights}
                    />
                    <ScenarioSimulator
                      simSalary={simSalary}
                      setSimSalary={setSimSalary}
                      simWants={simWants}
                      setSimWants={setSimWants}
                      totalIncome={totalIncome}
                      wantsSpent={wantsSpent}
                      needsSpent={needsSpent}
                    />
                  </div>

                  <ForecastPanel forecast={forecast} />
                </div>
              )}
            </>
          )}

          <DrillDownModal transactions={transactions} />
        </DrillDownProvider>
      </div>
    </AppLayout>
  )
}

function ExpenseBreakdownWithDrillDown({ summary, loading, range }: { summary: SummaryData | null; loading: boolean; range: RangeType }) {
  const { openDrillDown } = useDrillDown()
  return (
    <ExpenseBreakdown
      summary={summary}
      loading={loading}
      onCategoryClick={(category) => {
        const { start, end } = getRangeDates(range)
        openDrillDown(
          { category, type: 'debit', dateFrom: toISODateLocal(start), dateTo: toISODateLocal(end) },
          category
        )
      }}
    />
  )
}

function CategoryTrendChartWithDrillDown({ data, loading, hasTransactions }: { data: CategoryTrendMonth[]; loading: boolean; hasTransactions: boolean }) {
  const { openDrillDown } = useDrillDown()
  return (
    <CategoryTrendChart
      data={data}
      loading={loading}
      hasTransactions={hasTransactions}
      onSegmentClick={(category, monthKey) => {
        const monthLabel = data.find((m) => m.monthKey === monthKey)?.label ?? monthKey
        openDrillDown({ category, type: 'debit', month: monthKey }, `${category} — ${monthLabel}`)
      }}
    />
  )
}

function TrendChartWithDrillDown({ range, trendData, loading, hasTransactions, ccBillCategories, incomeCategories }: { range: RangeType; trendData: TrendItem[]; loading: boolean; hasTransactions: boolean; ccBillCategories: string[]; incomeCategories: string[] }) {
  const { openDrillDown } = useDrillDown()
  // No `type` filter -- these bars carry income and expenses both. But they were
  // built from a pool with credit-card bill payments removed, so the list has to
  // drop them too or it shows rows the bar never counted.
  const excludeCategories = ccBillCategories
  return (
    <TrendChart
      range={range}
      trendData={trendData}
      loading={loading}
      hasTransactions={hasTransactions}
      onPeriodClick={(item, label) => {
        const base = { excludeCategories, incomeCategories }
        if (item.dateStr) {
          openDrillDown({ ...base, dateFrom: item.dateStr, dateTo: item.dateStr }, label)
        } else if (item.startStr && item.endStr) {
          openDrillDown({ ...base, dateFrom: item.startStr, dateTo: item.endStr }, label)
        } else if (item.monthKey) {
          openDrillDown({ ...base, month: item.monthKey }, label)
        }
      }}
    />
  )
}

function CreditCardPaymentTrendWithDrillDown({ data, loading, ccBillCategories }: { data: CreditCardPaymentTrendItem[]; loading: boolean; ccBillCategories: string[] }) {
  const { openDrillDown } = useDrillDown()
  return (
    <CreditCardPaymentTrend
      data={data}
      loading={loading}
      // Drills down on the same tagged categories the bars were built from.
      // This used to filter on the literal name 'Credit Card Bill Payment',
      // so a bar could show an amount and open to an empty list whenever the
      // tagged category was named anything else.
      onMonthClick={(monthKey, label) => openDrillDown({ categories: ccBillCategories, type: 'debit', month: monthKey }, `Credit Card Bill Payments — ${label}`)}
    />
  )
}

function MerchantLeaderboardWithDrillDown({ data, loading, range, ccBillCategories }: { data: MerchantLeaderboardItem[]; loading: boolean; range: RangeType; ccBillCategories: string[] }) {
  const { openDrillDown } = useDrillDown()
  return (
    <MerchantLeaderboard
      data={data}
      loading={loading}
      onMerchantClick={(merchant) => {
        const { start, end } = getRangeDates(range)
        openDrillDown(
          { merchant, type: 'debit', excludeCategories: ccBillCategories, dateFrom: toISODateLocal(start), dateTo: toISODateLocal(end) },
          merchant
        )
      }}
    />
  )
}

function AnomalyAlertsWithDrillDown({ anomalies }: { anomalies: ReturnType<typeof detectAnomalies> }) {
  const { openDrillDown } = useDrillDown()
  return (
    <AnomalyAlerts
      anomalies={anomalies}
      onAnomalyClick={(category) => openDrillDown({ category, type: 'debit', month: getCurrentMonth() }, `${category} — spike this month`)}
    />
  )
}

function BudgetBurndownWithDrillDown({ data, loading, dateFilter }: { data: BudgetBurndownItem[]; loading: boolean; dateFilter: DateFilter }) {
  const { openDrillDown } = useDrillDown()
  return (
    <BudgetBurndown
      data={data}
      loading={loading}
      onCategoryClick={(category) => {
        const targetMonth = dateFilter.mode === 'month' ? dateFilter.month : resolveDateFilter(dateFilter).dateTo.slice(0, 7)
        openDrillDown({ category, type: 'debit', month: targetMonth }, category)
      }}
    />
  )
}

function AdherenceDiagnosticWithDrillDown({ healthScore, totalIncome, totalDebit, advisoryFrom, advisoryTo, ccBillCategories, incomeCategories }: { healthScore: number; totalIncome: number; totalDebit: number; advisoryFrom: string; advisoryTo: string; ccBillCategories: string[]; incomeCategories: string[] }) {
  const { openDrillDown } = useDrillDown()
  return (
    <AdherenceDiagnostic
      healthScore={healthScore}
      totalIncome={totalIncome}
      totalDebit={totalDebit}
      onClick={() => openDrillDown({ excludeCategories: ccBillCategories, incomeCategories, dateFrom: advisoryFrom, dateTo: advisoryTo }, 'All transactions this period')}
    />
  )
}

function BudgetVisualizerWithDrillDown({
  needsSpent, needsPct, wantsSpent, wantsPct, savingsSpent, finalSavingsPct, emergencyMonths, isEmergencyFundReady,
  advisoryFrom, advisoryTo, needsCategoryNames, wantsCategoryNames, savingsCategoryNames,
}: {
  needsSpent: number; needsPct: number; wantsSpent: number; wantsPct: number; savingsSpent: number; finalSavingsPct: number
  emergencyMonths: number; isEmergencyFundReady: boolean
  advisoryFrom: string; advisoryTo: string
  needsCategoryNames: string[]; wantsCategoryNames: string[]; savingsCategoryNames: string[]
}) {
  const { openDrillDown } = useDrillDown()
  const bucketLabels: Record<'needs' | 'wants' | 'savings', string> = { needs: 'Needs', wants: 'Wants', savings: 'Savings' }
  const bucketCategories: Record<'needs' | 'wants' | 'savings', string[]> = {
    needs: needsCategoryNames,
    wants: wantsCategoryNames,
    savings: savingsCategoryNames,
  }
  return (
    <BudgetVisualizer
      needsSpent={needsSpent}
      needsPct={needsPct}
      wantsSpent={wantsSpent}
      wantsPct={wantsPct}
      savingsSpent={savingsSpent}
      finalSavingsPct={finalSavingsPct}
      emergencyMonths={emergencyMonths}
      isEmergencyFundReady={isEmergencyFundReady}
      onBucketClick={(bucket) => openDrillDown(
        { categories: bucketCategories[bucket], type: 'debit', dateFrom: advisoryFrom, dateTo: advisoryTo },
        bucketLabels[bucket]
      )}
    />
  )
}

