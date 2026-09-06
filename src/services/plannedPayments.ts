// ============================================
// Planned Payments Service
// Extends subscriptions into planned recurring payments:
// utilities, rent, insurance, EMIs, SIPs, and subscriptions.
// ============================================

import { toISODateLocal } from '@/utils/dateFilter'
import {
  merchantKey,
  ignoredSubscriptionsStorageKey,
  loadIgnoredSubscriptionKeys,
  SUBSCRIPTION_LOOKBACK_MONTHS,
} from './subscriptionDetection'

export {
  merchantKey,
  ignoredSubscriptionsStorageKey,
  loadIgnoredSubscriptionKeys,
  SUBSCRIPTION_LOOKBACK_MONTHS,
}

export type PaymentCadence = 'monthly' | 'quarterly' | 'annual' | 'weekly' | 'custom'

export type PlannedPaymentType =
  | 'subscription'
  | 'utility'
  | 'rent'
  | 'insurance'
  | 'emi'
  | 'sip'
  | 'credit_card_bill'
  | 'other'

/**
 * Core interface for a Planned Payment.
 * Compliant with specifications: title, amount, cadence, category, next_due_date, card_or_account, is_active.
 */
export interface PlannedPayment {
  id: string
  title: string
  amount: number
  cadence: PaymentCadence
  category: string
  next_due_date: string // ISO date string YYYY-MM-DD
  card_or_account: string | null // e.g. "HDFC ••4582", "SBI Card", "UPI AutoPay", "NACH"
  is_active: boolean
  payment_type: PlannedPaymentType
  days_until_due: number // 0 = today, 1 = tomorrow, < 0 = past due, > 0 = in X days
  last_billed?: string | null
  frequency_days: number
  times_charged: number
  is_auto_detected: boolean
  price_change?: number | null
  merchant?: string | null
  card_last4?: string | null
  card_issuer?: string | null
  card_brand?: string | null
  payment_mode?: string | null
}

/**
 * Flexible input row for detection. Accepts full Supabase transaction rows
 * or lightweight transaction objects.
 */
export interface PlannedPaymentDetectableTxn {
  date: string
  amount: number
  type: 'debit' | 'credit'
  category?: string | null
  merchant?: string | null
  description?: string | null
  payment_mode?: string | null
  card_last4?: string | null
  card_issuer?: string | null
  card_brand?: string | null
  card_id?: string | null
  event_type?: string | null
  id?: string
}

/** Categories that are inherently recurring */
export const RECURRING_CATEGORIES = [
  'Subscriptions',
  'Utilities & Bills',
  'Rent',
  'Insurance',
  'Investments',
  'Loan',
  'Loans & EMIs',
  'Credit Card Bill Payment',
]

/**
 * Resolves human-readable card or account label from transaction metadata
 */
export function resolveCardOrAccount(txn: {
  card_issuer?: string | null
  card_last4?: string | null
  card_brand?: string | null
  payment_mode?: string | null
}): string | null {
  const issuer = txn.card_issuer?.trim()
  const last4 = txn.card_last4?.trim()
  const brand = txn.card_brand?.trim()
  const mode = txn.payment_mode?.trim().toLowerCase()

  if (issuer && last4) {
    return `${issuer} ••${last4}`
  }
  if (last4) {
    const prefix = brand || (mode === 'credit_card' ? 'Credit Card' : 'Card')
    return `${prefix} ••${last4}`
  }
  if (issuer) {
    return issuer
  }

  if (mode) {
    switch (mode) {
      case 'upi':
        return 'UPI AutoPay'
      case 'nach':
        return 'NACH Mandate'
      case 'net_banking':
        return 'Net Banking'
      case 'credit_card':
        return 'Credit Card'
      case 'debit_card':
        return 'Debit Card'
      case 'wallet':
        return 'Wallet'
      case 'neft':
      case 'rtgs':
      case 'imps':
        return mode.toUpperCase()
      default:
        return null
    }
  }

  return null
}

/**
 * Classifies a payment into a specific planned payment category bucket.
 */
export function classifyPaymentType(
  category?: string | null,
  eventType?: string | null,
  title?: string | null
): PlannedPaymentType {
  const cat = (category || '').toLowerCase()
  const evt = (eventType || '').toLowerCase()
  const txt = (title || '').toLowerCase()

  if (
    evt === 'emi' ||
    evt === 'loan_repayment' ||
    cat.includes('loan') ||
    cat.includes('emi') ||
    /\b(emi|loan|repayment|bajaj finserv|hdb financial)\b/i.test(txt)
  ) {
    return 'emi'
  }

  if (
    evt === 'sip' ||
    cat.includes('investment') ||
    cat.includes('sip') ||
    /\b(sip|mutual fund|zerodha|groww|kuvera|mf central|amc|uti|nippon|mirae|parag parikh|axis mf)\b/i.test(txt)
  ) {
    return 'sip'
  }

  if (
    evt === 'insurance' ||
    cat.includes('insurance') ||
    /\b(insurance|lic|hdfc ergo|max life|star health|icici pru|care health|bajaj allianz|tata aia)\b/i.test(txt)
  ) {
    return 'insurance'
  }

  if (
    cat.includes('rent') ||
    /\b(rent|landlord|house maintenance|society maintenance|maintenance charge)\b/i.test(txt)
  ) {
    return 'rent'
  }

  if (
    cat.includes('credit card') ||
    evt === 'credit_card_bill' ||
    /\bcredit card bill\b/i.test(txt)
  ) {
    return 'credit_card_bill'
  }

  if (
    cat.includes('utility') ||
    cat.includes('bill') ||
    /\b(electricity|water|gas|broadband|wifi|internet|cylinder|bescom|tata power|adani electricity|airtel|jio|act fibernet|mahanagar gas|igl)\b/i.test(txt)
  ) {
    return 'utility'
  }

  if (cat.includes('subscription') || evt === 'subscription') {
    return 'subscription'
  }

  return 'subscription'
}

/**
 * Determines whether a planned payment belongs to 'Subscriptions'
 * or 'Bills, Rent & EMIs' tab.
 */
export function isSubscriptionTabItem(payment: PlannedPayment): boolean {
  return payment.payment_type === 'subscription'
}

export function isBillRentOrEmiTabItem(payment: PlannedPayment): boolean {
  return (
    payment.payment_type === 'utility' ||
    payment.payment_type === 'rent' ||
    payment.payment_type === 'insurance' ||
    payment.payment_type === 'emi' ||
    payment.payment_type === 'sip' ||
    payment.payment_type === 'credit_card_bill' ||
    payment.payment_type === 'other'
  )
}

/**
 * Detects recurring patterns and returns all active Planned Payments.
 * Covers subscriptions, utilities, rent, insurance, EMIs, and SIPs.
 */
export function detectPlannedPayments(
  transactions: PlannedPaymentDetectableTxn[],
  options?: { ignoredKeys?: string[]; now?: Date }
): PlannedPayment[] {
  const now = options?.now ?? new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ignoredKeys = options?.ignoredKeys ?? []

  const debits = transactions.filter((t) => t.type === 'debit')

  // Group by primary identifier (merchant name or fallback description)
  const groups: Record<string, PlannedPaymentDetectableTxn[]> = {}

  debits.forEach((t) => {
    const rawKey = (t.merchant || t.description || '').trim()
    if (!rawKey) return
    const key = merchantKey(rawKey)
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  })

  const results: PlannedPayment[] = []

  for (const [key, txns] of Object.entries(groups)) {
    if (ignoredKeys.includes(key)) continue

    // Sort newest to oldest
    txns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const latest = txns[0]
    const category = latest.category || 'Other'
    const paymentType = classifyPaymentType(
      category,
      latest.event_type,
      latest.merchant || latest.description
    )

    const isRecurringCategory =
      RECURRING_CATEGORIES.some((rc) => category.toLowerCase().includes(rc.toLowerCase())) ||
      ['emi', 'sip', 'insurance', 'subscription', 'credit_card_bill'].includes(
        (latest.event_type || '').toLowerCase()
      )

    let isRecurring = false
    let cadence: PaymentCadence = 'monthly'
    let frequencyDays = 30
    let maxStaleDays = 65

    if (txns.length === 1) {
      if (isRecurringCategory) {
        isRecurring = true
        cadence = 'monthly'
        frequencyDays = 30
        maxStaleDays = 65
      }
    } else {
      const d1 = new Date(txns[0].date)
      const d2 = new Date(txns[1].date)
      const diffDays = Math.round(Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24))
      const amountVar =
        Math.abs(Number(txns[0].amount) - Number(txns[1].amount)) / Math.max(1, Number(txns[0].amount))

      // Utilities/Bills can vary in amount (e.g. electricity units, seasonal usage)
      const allowsAmountVariation =
        paymentType === 'utility' ||
        paymentType === 'credit_card_bill' ||
        category.toLowerCase().includes('utilities')

      const varianceThreshold = allowsAmountVariation ? 0.85 : 0.2

      if (diffDays >= 5 && diffDays <= 10 && (amountVar < varianceThreshold || allowsAmountVariation)) {
        isRecurring = true
        cadence = 'weekly'
        frequencyDays = 7
        maxStaleDays = 21
      } else if (diffDays >= 22 && diffDays <= 45 && (amountVar < varianceThreshold || allowsAmountVariation)) {
        isRecurring = true
        cadence = 'monthly'
        frequencyDays = 30
        maxStaleDays = 65
      } else if (diffDays >= 75 && diffDays <= 110 && (amountVar < varianceThreshold || allowsAmountVariation)) {
        isRecurring = true
        cadence = 'quarterly'
        frequencyDays = 91
        maxStaleDays = 110
      } else if (diffDays >= 335 && diffDays <= 400 && (amountVar < varianceThreshold || allowsAmountVariation)) {
        isRecurring = true
        cadence = 'annual'
        frequencyDays = 365
        maxStaleDays = 400
      } else if (isRecurringCategory) {
        isRecurring = true
        cadence = 'monthly'
        frequencyDays = 30
        maxStaleDays = 65
      }
    }

    if (!isRecurring) continue

    const [y, m, d] = latest.date.split('-').map(Number)
    const lastBilledDate = new Date(y, m - 1, d)
    const daysSinceLastBilled = Math.round(
      (todayStart.getTime() - lastBilledDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    // Stale check
    if (daysSinceLastBilled > maxStaleDays) continue

    // Calculate next due date
    const nextDueDate = new Date(lastBilledDate)
    nextDueDate.setDate(nextDueDate.getDate() + frequencyDays)

    // If nextDueDate has already passed by more than 5 days, roll forward to the upcoming cycle
    while (
      Math.round((nextDueDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)) < -5 &&
      frequencyDays > 0
    ) {
      nextDueDate.setDate(nextDueDate.getDate() + frequencyDays)
    }

    const daysUntilDue = Math.round(
      (nextDueDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
    )

    const avgAmount = txns.reduce((sum, t) => sum + Number(t.amount), 0) / txns.length

    let priceChange: number | null = null
    if (txns.length >= 2) {
      const delta = Number(txns[0].amount) - Number(txns[1].amount)
      if (Math.abs(delta) > 5) priceChange = delta
    }

    const cardOrAccount = resolveCardOrAccount({
      card_issuer: latest.card_issuer,
      card_last4: latest.card_last4,
      card_brand: latest.card_brand,
      payment_mode: latest.payment_mode,
    })

    const title = latest.merchant?.trim() || latest.description?.trim() || 'Planned Payment'

    results.push({
      id: latest.id || `planned-${key}`,
      title,
      amount: Math.round(avgAmount),
      cadence,
      category,
      next_due_date: toISODateLocal(nextDueDate),
      card_or_account: cardOrAccount,
      is_active: true,
      payment_type: paymentType,
      days_until_due: daysUntilDue,
      last_billed: latest.date,
      frequency_days: frequencyDays,
      times_charged: txns.length,
      is_auto_detected: true,
      price_change: priceChange,
      merchant: latest.merchant,
      card_last4: latest.card_last4,
      card_issuer: latest.card_issuer,
      card_brand: latest.card_brand,
      payment_mode: latest.payment_mode,
    })
  }

  return results.sort((a, b) => a.days_until_due - b.days_until_due)
}

/** Day item in the 30-day upcoming timeline */
export interface TimelineDay {
  date: string // YYYY-MM-DD
  dayOfMonth: number
  dayOfWeek: string // Mon, Tue, etc.
  isToday: boolean
  bills: PlannedPayment[]
  totalAmount: number
}

/** Aggregated upcoming bills analysis */
export interface UpcomingBillsSummary {
  bills: PlannedPayment[]
  totalUpcomingAmount: number
  dueIn7DaysAmount: number
  dueIn7DaysCount: number
  overdueCount: number
  overdueAmount: number
  billsByDate: Record<string, PlannedPayment[]>
  timeline: TimelineDay[]
}

/**
 * Calculates upcoming bills for the next 30 days.
 * Includes items due within [0, 30] days as well as immediately overdue items (last 2 days).
 */
export function calculateUpcomingBillsForNext30Days(
  plannedPayments: PlannedPayment[],
  options?: { now?: Date }
): UpcomingBillsSummary {
  const now = options?.now ?? new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayISO = toISODateLocal(todayStart)

  const active = plannedPayments.filter((p) => p.is_active)

  // Filter bills due within the 30-day window (or up to 2 days overdue)
  const upcomingBills = active.filter((p) => {
    return p.days_until_due >= -2 && p.days_until_due <= 30
  }).sort((a, b) => a.days_until_due - b.days_until_due)

  let totalUpcomingAmount = 0
  let dueIn7DaysAmount = 0
  let dueIn7DaysCount = 0
  let overdueCount = 0
  let overdueAmount = 0

  const billsByDate: Record<string, PlannedPayment[]> = {}

  upcomingBills.forEach((bill) => {
    totalUpcomingAmount += bill.amount

    if (bill.days_until_due < 0) {
      overdueCount++
      overdueAmount += bill.amount
    } else if (bill.days_until_due <= 7) {
      dueIn7DaysCount++
      dueIn7DaysAmount += bill.amount
    }

    if (!billsByDate[bill.next_due_date]) {
      billsByDate[bill.next_due_date] = []
    }
    billsByDate[bill.next_due_date].push(bill)
  })

  // Build full 30-day timeline array from today
  const timeline: TimelineDay[] = []
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  for (let i = 0; i < 30; i++) {
    const dayDate = new Date(todayStart)
    dayDate.setDate(dayDate.getDate() + i)
    const isoDate = toISODateLocal(dayDate)

    const dayBills = billsByDate[isoDate] ?? []
    const dayTotal = dayBills.reduce((sum, b) => sum + b.amount, 0)

    timeline.push({
      date: isoDate,
      dayOfMonth: dayDate.getDate(),
      dayOfWeek: weekdayNames[dayDate.getDay()],
      isToday: isoDate === todayISO,
      bills: dayBills,
      totalAmount: dayTotal,
    })
  }

  return {
    bills: upcomingBills,
    totalUpcomingAmount,
    dueIn7DaysAmount,
    dueIn7DaysCount,
    overdueCount,
    overdueAmount,
    billsByDate,
    timeline,
  }
}

// ============================================
// Category-Based Planned Payments
// Only categories explicitly marked by the user in Settings
// and specific planned payment items defined by the user
// appear in the Planned Payments Command Center.
// Zero algorithmic guessing or auto-tagging.
// ============================================

export interface UserPlannedPayment {
  id: string
  name: string // e.g. "Netflix", "Spotify", "Tata Power", "House Rent", "HDFC Car Loan"
  category: string // Category name, e.g. "Subscriptions", "Utilities & Bills", "Rent"
  dueDay: number // 1..31 (e.g. 5 for 5th of each month)
  expectedAmount: number // e.g. 649, 25000
  notes?: string
  createdAt?: string
}

export function plannedPaymentsStorageKey(userId?: string): string {
  return `intrack_user_planned_payments_${userId || 'default'}`
}

export function getUserPlannedPayments(userId?: string): UserPlannedPayment[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = localStorage.getItem(plannedPaymentsStorageKey(userId))
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    console.warn('Failed to load user planned payments:', e)
    return []
  }
}

export function saveUserPlannedPayment(
  payment: Omit<UserPlannedPayment, 'id'> & { id?: string },
  userId?: string
): UserPlannedPayment {
  const current = getUserPlannedPayments(userId)
  const id = payment.id || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()

  const existingIndex = current.findIndex((p) => p.id === id)
  let updated: UserPlannedPayment

  if (existingIndex >= 0) {
    updated = {
      ...current[existingIndex],
      ...payment,
      id,
    }
    current[existingIndex] = updated
  } else {
    updated = {
      ...payment,
      id,
      createdAt: payment.createdAt || now,
    }
    current.push(updated)
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(plannedPaymentsStorageKey(userId), JSON.stringify(current))
    } catch (e) {
      console.warn('Failed to save planned payment to localStorage:', e)
    }
  }
  return updated
}

export function deleteUserPlannedPayment(id: string, userId?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const current = getUserPlannedPayments(userId).filter((p) => p.id !== id)
  try {
    localStorage.setItem(plannedPaymentsStorageKey(userId), JSON.stringify(current))
  } catch (e) {
    console.warn('Failed to delete planned payment from localStorage:', e)
  }
}

export interface PlannedCategorySchedule {
  categoryName: string
  dueDay: number // 1..31
  expectedAmount?: number
  notes?: string
}

export function plannedCategoryStorageKey(userId?: string): string {
  return `intrack_planned_schedules_${userId || 'default'}`
}

export function getAllPlannedCategorySchedules(userId?: string): Record<string, PlannedCategorySchedule> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = localStorage.getItem(plannedCategoryStorageKey(userId))
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    console.warn('Failed to load planned category schedules:', e)
    return {}
  }
}

export function getPlannedCategorySchedule(categoryName: string, userId?: string): PlannedCategorySchedule {
  const all = getAllPlannedCategorySchedules(userId)
  const normalized = categoryName.trim().toLowerCase()
  const found = Object.entries(all).find(([k]) => k.trim().toLowerCase() === normalized)
  if (found) return found[1]
  return {
    categoryName,
    dueDay: 1,
    expectedAmount: undefined,
  }
}

export function savePlannedCategorySchedule(
  categoryName: string,
  schedule: Partial<PlannedCategorySchedule>,
  userId?: string
): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const all = getAllPlannedCategorySchedules(userId)
    const existing = getPlannedCategorySchedule(categoryName, userId)
    all[categoryName] = {
      ...existing,
      ...schedule,
      categoryName,
    }
    localStorage.setItem(plannedCategoryStorageKey(userId), JSON.stringify(all))
  } catch (e) {
    console.warn('Failed to save planned category schedule:', e)
  }
}

export function removePlannedCategorySchedule(categoryName: string, userId?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const all = getAllPlannedCategorySchedules(userId)
    delete all[categoryName]
    localStorage.setItem(plannedCategoryStorageKey(userId), JSON.stringify(all))
  } catch (e) {
    console.warn('Failed to remove planned category schedule:', e)
  }
}

export function isPlannedCategory(category: { analytics_tags?: string[] | null }): boolean {
  const tags = category.analytics_tags || []
  return tags.includes('subscription') || tags.includes('planned_payment')
}

export interface EvaluatedPlannedPayment {
  id: string
  itemId?: string
  name: string // e.g. "Netflix", "Spotify", "House Rent"
  categoryId?: string
  categoryName: string
  categoryEmoji?: string
  categoryColor?: string
  status: 'paid' | 'due'
  dueDay: number
  dueDate: string // YYYY-MM-DD
  daysUntilDue: number // < 0 overdue, 0 today, > 0 future
  amount: number // actual paid if paid, expected if due
  expectedAmount: number
  amountPaid: number
  paidDate?: string
  lastChargedMerchant?: string
  matchedTxns: {
    id: string
    date: string
    amount: number
    description: string
    merchant?: string | null
    payment_mode?: string | null
  }[]
}

export interface MonthlyPlannedPaymentsEvaluation {
  totalCommitment: number
  clearedAmount: number
  remainingDueAmount: number
  clearedCount: number
  dueCount: number
  totalCount: number
  items: EvaluatedPlannedPayment[]
}

export function evaluateMonthlyPlannedPayments(options: {
  categories: Array<{ id?: string; name: string; emoji?: string; color?: string; analytics_tags?: string[] | null }>
  monthTransactions: Array<{
    id: string
    date: string
    amount: number
    type: string
    category: string
    description?: string | null
    merchant?: string | null
    payment_mode?: string | null
    approval_status?: string | null
  }>
  year: number
  monthIndex: number // 0-11
  referenceDate?: Date // defaults to new Date()
  userId?: string
  userPlannedPayments?: UserPlannedPayment[]
}): MonthlyPlannedPaymentsEvaluation {
  const {
    categories,
    monthTransactions,
    year,
    monthIndex,
    referenceDate = new Date(),
    userId,
    userPlannedPayments,
  } = options

  const plannedCats = categories.filter(isPlannedCategory)
  const categoryMap = Object.fromEntries(categories.map((c) => [c.name.trim().toLowerCase(), c]))

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const todayDateOnly = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())

  // Specific items defined by the user
  const definedItems: UserPlannedPayment[] = userPlannedPayments ?? getUserPlannedPayments(userId)

  // If user has specific items defined, use those.
  // If not, fall back to any categories marked with isPlannedCategory
  let paymentDefinitions: Array<{
    id: string
    itemId?: string
    name: string
    categoryName: string
    dueDay: number
    expectedAmount: number
  }> = []

  if (definedItems.length > 0) {
    paymentDefinitions = definedItems.map((item) => ({
      id: item.id,
      itemId: item.id,
      name: item.name,
      categoryName: item.category,
      dueDay: item.dueDay,
      expectedAmount: item.expectedAmount,
    }))
  } else {
    // Fallback: evaluate planned categories if no specific items are defined yet
    paymentDefinitions = plannedCats.map((cat) => {
      const schedule = getPlannedCategorySchedule(cat.name, userId)
      return {
        id: cat.id || cat.name,
        name: cat.name,
        categoryName: cat.name,
        dueDay: schedule.dueDay || 1,
        expectedAmount: schedule.expectedAmount ?? 0,
      }
    })
  }

  // Count items per category to determine matching precision
  const countPerCategory: Record<string, number> = {}
  paymentDefinitions.forEach((p) => {
    const key = p.categoryName.trim().toLowerCase()
    countPerCategory[key] = (countPerCategory[key] || 0) + 1
  })

  let totalCommitment = 0
  let clearedAmount = 0
  let remainingDueAmount = 0
  let clearedCount = 0
  let dueCount = 0

  const items: EvaluatedPlannedPayment[] = paymentDefinitions.map((itemDef) => {
    const catMeta = categoryMap[itemDef.categoryName.trim().toLowerCase()]
    const validDueDay = Math.min(Math.max(itemDef.dueDay || 1, 1), daysInMonth)
    const dueDateObj = new Date(year, monthIndex, validDueDay)
    const dueDateStr = toISODateLocal(dueDateObj)

    // Calculate days until due (calendar day diff)
    const diffTime = dueDateObj.getTime() - todayDateOnly.getTime()
    const daysUntilDue = Math.round(diffTime / (1000 * 60 * 60 * 24))

    const isOnlyItemInCategory = (countPerCategory[itemDef.categoryName.trim().toLowerCase()] || 0) <= 1
    const itemNameLower = itemDef.name.trim().toLowerCase()

    // Match transactions for this item
    const matchingTxns = monthTransactions.filter((t) => {
      if (t.type !== 'debit') return false
      if (t.approval_status && t.approval_status !== 'approved') return false

      const matchesCat = t.category.trim().toLowerCase() === itemDef.categoryName.trim().toLowerCase()
      if (!matchesCat) return false

      if (isOnlyItemInCategory) {
        return true
      }

      // If multiple items exist in the same category (e.g. Netflix & Spotify under Subscriptions):
      const descLower = (t.description || '').toLowerCase()
      const merchLower = (t.merchant || '').toLowerCase()
      return descLower.includes(itemNameLower) || merchLower.includes(itemNameLower)
    })

    const isPaid = matchingTxns.length > 0
    const amountPaid = matchingTxns.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    const expectedAmount = itemDef.expectedAmount || 0

    if (isPaid) {
      clearedCount++
      clearedAmount += amountPaid
      totalCommitment += amountPaid
    } else {
      dueCount++
      remainingDueAmount += expectedAmount
      totalCommitment += expectedAmount
    }

    const sortedTxns = [...matchingTxns].sort((a, b) => b.date.localeCompare(a.date))
    const latestTxn = sortedTxns[0]

    return {
      id: itemDef.id,
      itemId: itemDef.itemId,
      name: itemDef.name,
      categoryId: catMeta?.id,
      categoryName: itemDef.categoryName,
      categoryEmoji: catMeta?.emoji,
      categoryColor: catMeta?.color,
      status: isPaid ? 'paid' : 'due',
      dueDay: validDueDay,
      dueDate: dueDateStr,
      daysUntilDue,
      amount: isPaid ? amountPaid : expectedAmount,
      expectedAmount,
      amountPaid,
      paidDate: latestTxn?.date,
      lastChargedMerchant: latestTxn?.merchant || latestTxn?.description || undefined,
      matchedTxns: sortedTxns.map((t) => ({
        id: t.id,
        date: t.date,
        amount: Number(t.amount) || 0,
        description: t.description || '',
        merchant: t.merchant,
        payment_mode: t.payment_mode,
      })),
    }
  })

  // Sort items: due items first (sorted by due date ascending), then paid items (sorted by paid date descending)
  items.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'due' ? -1 : 1
    }
    if (a.status === 'due') {
      return a.daysUntilDue - b.daysUntilDue
    }
    return (b.paidDate || '').localeCompare(a.paidDate || '')
  })

  return {
    totalCommitment,
    clearedAmount,
    remainingDueAmount,
    clearedCount,
    dueCount,
    totalCount: items.length,
    items,
  }
}

