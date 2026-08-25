// ============================================
// Subscription detection — shared by the Subscriptions
// page and the Dashboard's Active Subscriptions widget
// ============================================
//
// This lived inline in SubscriptionsPage while the Dashboard widget carried a
// second, drifted copy: different recurrence window (22 days vs 25), different
// staleness cutoff (60 vs 65), no quarterly or annual tier, and no awareness of
// the merchants the user had marked "not a subscription". The two views
// disagreed about the same data. One implementation, imported by both, is what
// keeps them honest.

import { toISODateLocal } from '../utils/dateFilter'

/**
 * The transaction columns detection actually reads. Deliberately structural
 * rather than `TransactionRow` so callers can pass either a full row or a
 * narrowed select.
 */
export interface DetectableTransaction {
  date: string
  amount: number
  merchant: string | null
  category: string
  type: 'debit' | 'credit'
}

export interface DetectedSubscription {
  merchant: string
  category: string
  amount: number
  lastBilled: string
  nextRenewal: string
  daysToRenewal: number
  isAutoDetected: boolean
  frequency: 'monthly' | 'quarterly' | 'annual' | 'unknown'
  /** Positive = price went up, negative = down, null = not enough history. */
  priceChange: number | null
  timesCharged: number
}

/**
 * How far back detection looks.
 *
 * Two annual charges need just over twelve months between them, so 24 is
 * already twice the span required to see a pair. Going unbounded would pull a
 * heavy user's entire history into the browser, and a charge older than two
 * years is not evidence of a subscription that is still running.
 */
export const SUBSCRIPTION_LOOKBACK_MONTHS = 24

/** Categories that imply recurrence even without a second charge to compare. */
const SUBSCRIPTION_CATEGORIES = ['Subscriptions', 'Utilities & Bills']

/** Normalisation used for both grouping and the ignored-merchant list. */
export function merchantKey(merchant: string): string {
  return merchant.trim().toLowerCase()
}

/** localStorage key holding the merchants this user marked "not a subscription". */
export function ignoredSubscriptionsStorageKey(userId: string): string {
  return `intrack_ignored_subscriptions_${userId}`
}

/** Read the ignored-merchant list, tolerating absent or corrupt JSON. */
export function loadIgnoredSubscriptionKeys(userId: string | null | undefined): string[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(ignoredSubscriptionsStorageKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Infer active recurring payments from transaction history.
 *
 * Needs the FULL history window to work: two or more charges from the same
 * merchant are what establish a frequency. Handed a short slice — the
 * Dashboard's five most recent transactions, say — every merchant looks like a
 * one-off, detection falls through to the category heuristic, and a single
 * utility bill gets reported as a subscription with an invented renewal date.
 * Callers should fetch `SUBSCRIPTION_LOOKBACK_MONTHS` of history with
 * `fetchAllTransactions`, whose paging avoids the 1000-row ceiling that would
 * otherwise cut off the older of the two charges.
 */
export function detectSubscriptions(
  transactions: DetectableTransaction[],
  options?: { ignoredKeys?: string[]; now?: Date }
): DetectedSubscription[] {
  const list: DetectedSubscription[] = []
  const now = options?.now ?? new Date()
  const ignoredKeys = options?.ignoredKeys ?? []

  const debits = transactions.filter((t) => t.type === 'debit')

  // Group by cleaned merchant
  const grouped: Record<string, DetectableTransaction[]> = {}
  debits.forEach((t) => {
    if (!t.merchant) return
    const cleanKey = merchantKey(t.merchant)
    if (!grouped[cleanKey]) grouped[cleanKey] = []
    grouped[cleanKey].push(t)
  })

  for (const [cleanKey, txns] of Object.entries(grouped)) {
    // Skip merchants the user marked as "not a subscription".
    if (ignoredKeys.includes(cleanKey)) continue

    txns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const latest = txns[0]
    const isSubCategory = SUBSCRIPTION_CATEGORIES.includes(latest.category)

    let isRecurring = false
    let frequency: DetectedSubscription['frequency'] = 'unknown'
    let renewalDays = 30
    let maxStaleDays = 65 // how old last charge can be and still be "active"

    if (isSubCategory && txns.length === 1) {
      // Single entry but subscription category — treat as monthly
      isRecurring = true
      frequency = 'monthly'
      renewalDays = 30
    } else if (txns.length >= 2) {
      const d1 = new Date(txns[0].date)
      const d2 = new Date(txns[1].date)
      const diffDays = Math.round(Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24))
      const amountVar =
        Math.abs(Number(txns[0].amount) - Number(txns[1].amount)) / Math.max(1, Number(txns[0].amount))

      if (diffDays >= 25 && diffDays <= 40 && amountVar < 0.15) {
        isRecurring = true; frequency = 'monthly'; renewalDays = 30; maxStaleDays = 65
      } else if (diffDays >= 80 && diffDays <= 100 && amountVar < 0.15) {
        isRecurring = true; frequency = 'quarterly'; renewalDays = 91; maxStaleDays = 105
      } else if (diffDays >= 350 && diffDays <= 380 && amountVar < 0.15) {
        isRecurring = true; frequency = 'annual'; renewalDays = 365; maxStaleDays = 395
      } else if (isSubCategory) {
        // Category hints it's recurring even if we can't determine frequency
        isRecurring = true; frequency = 'monthly'; renewalDays = 30; maxStaleDays = 65
      }
    }

    if (isRecurring) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const [y, m, d] = latest.date.split('-').map(Number)
      const lastBilledDate = new Date(y, m - 1, d)

      const daysSinceLastBilled = Math.round(
        (todayStart.getTime() - lastBilledDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysSinceLastBilled > maxStaleDays) continue // Expired or cancelled

      const nextRenewalDate = new Date(lastBilledDate)
      nextRenewalDate.setDate(nextRenewalDate.getDate() + renewalDays)
      const daysToRenewal = Math.round((nextRenewalDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24))

      const avgAmount = txns.reduce((sum, t) => sum + Number(t.amount), 0) / txns.length

      // Detect price change: compare latest vs previous charge
      let priceChange: number | null = null
      if (txns.length >= 2) {
        const delta = Number(txns[0].amount) - Number(txns[1].amount)
        if (Math.abs(delta) > 5) priceChange = delta // ₹5 threshold to ignore rounding
      }

      list.push({
        merchant: latest.merchant || 'Recurring Payment',
        category: latest.category,
        amount: Math.round(avgAmount),
        lastBilled: latest.date,
        nextRenewal: toISODateLocal(nextRenewalDate),
        daysToRenewal,
        isAutoDetected: true,
        frequency,
        priceChange,
        timesCharged: txns.length,
      })
    }
  }

  return list.sort((a, b) => a.daysToRenewal - b.daysToRenewal)
}
