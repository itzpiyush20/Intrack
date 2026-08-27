// ============================================
// Emergency-reserve coverage — pure calculations
// ============================================
//
// These live outside InsightsPage.tsx on purpose: that file exports a
// component, and react-refresh requires shared functions to sit in their own
// module.

import { toISODateLocal } from '@/utils/dateFilter'

/** The five COMPLETED months before this one, as an inclusive date range.
 *
 * Anything on this page that takes an *average* over months must exclude the
 * month in progress: it is partial by definition and drags the average down.
 * (Totals and per-month bars are fine — they are showing actuals, not a rate.)
 * The window stops at month -5 because the page fetches from six months before
 * *today*, so month -6 is only partly loaded. */
export function completedMonthsWindow(now: Date = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0) // day 0 = last day of previous month
  return { startStr: toISODateLocal(start), endStr: toISODateLocal(end), months: 5 }
}

/** Pure: how many months of essential spending the accumulated savings pool covers.
 *
 * Two defects this replaces:
 *  - the reserve counted *credits* in savings categories, so a redemption read
 *    as money going into the reserve;
 *  - the reserve was a trailing-window total but was divided by whatever the
 *    advisory-period picker happened to be set to, so the same reserve read as
 *    5.7 months over a full month and 11.3 months over a single week — flipping
 *    the "Funded (6mo+)" badge on a filter change.
 *
 * The reserve is a stock, so it counts every savings debit in the loaded pool.
 * Essential burn is a rate, so it averages over completed months only. */
export function computeEmergencyMonths(
  txns: Array<{ type: string; date: string | null; amount: number; category: string }>,
  savingsCategories: string[],
  needsCategories: string[],
  needsWindow: { startStr: string; endStr: string; months: number },
  fallbackMonthlyNeeds = 15000
): number {
  const debits = txns.filter((t) => t.type === 'debit' && !!t.date)

  const reserve = debits
    .filter((t) => savingsCategories.includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const needsTotal = debits
    .filter(
      (t) =>
        needsCategories.includes(t.category) &&
        t.date! >= needsWindow.startStr &&
        t.date! <= needsWindow.endStr
    )
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const avgMonthlyNeeds =
    needsWindow.months > 0 && needsTotal > 0 ? needsTotal / needsWindow.months : fallbackMonthlyNeeds

  if (avgMonthlyNeeds <= 0) return 0
  return Number((reserve / avgMonthlyNeeds).toFixed(1))
}
