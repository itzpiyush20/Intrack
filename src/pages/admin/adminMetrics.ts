// ============================================
// Admin display maths.
//
// Deliberately in TypeScript rather than SQL: this repo can test TypeScript and
// has no harness for Postgres, and these are the numbers most likely to be shown
// to an investor. SQL returns raw counts; the derivations happen here.
// ============================================

/** Live prices from the pricing page. Update both together if they ever change. */
const MONTHLY_PRICE_INR = 31
const ANNUAL_PRICE_INR = 365

/**
 * Approximate monthly recurring revenue from the plans people hold RIGHT NOW.
 *
 * This is not historic revenue, and the reason is no longer that receipts are
 * missing — `public.payments` has recorded them since migration 025. This
 * function simply answers a different question: what the current book of plans
 * is worth per month, not what has actually been collected. It values every
 * active plan at list price, so admin grants and coupon redemptions (both real
 * rows in `payments`, both worth ₹0) are counted here as if they were sales.
 *
 * Always label this as approximate in the UI, and do not present it as takings.
 */
export function approximateMonthlyRevenue(monthlyCount: number, annualCount: number): number {
  const fromMonthly = monthlyCount * MONTHLY_PRICE_INR
  const fromAnnual = annualCount * (ANNUAL_PRICE_INR / 12)
  return Math.round((fromMonthly + fromAnnual) * 100) / 100
}

/**
 * Share of scans that produced something, as a whole-number percentage.
 * Partial scans count as successes: they still returned transactions.
 * Returns null when no scans exist, so the UI can show "no data" not "0%".
 */
export function scanSuccessRate(counts: { succeeded: number; partial: number; failed: number }): number | null {
  const total = counts.succeeded + counts.partial + counts.failed
  if (total === 0) return null
  return Math.round(((counts.succeeded + counts.partial) / total) * 100)
}

/** Whole-number percentage, or null when the denominator is zero. */
export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 100)
}
