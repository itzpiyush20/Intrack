// ============================================
// Subscription pricing — single source of truth
// ============================================
//
// CHANGING A PRICE
// ----------------
// Edit PRICING below, and the matching paise amounts in api/_lib/pricing.ts.
// Nothing else in the app carries a price: every rupee figure, per-day figure
// and savings badge shown to a customer is derived from this object at render
// time. api/_lib/pricing.test.ts fails the build if the two files disagree, so
// a half-finished price change cannot reach production.
//
// The two files exist because functions under api/ import nothing from src/ —
// no api handler does today, and the Vercel bundler's handling of that is not
// something this repo has verified. The test is the seam that keeps them
// honest instead.
//
// WHY DERIVED, NOT TYPED OUT
// --------------------------
// A hand-written "Save 17%" badge sat on the pricing page against a ₹31/₹365
// pair whose real saving was 2%. Every derived number below is computed so a
// price change cannot leave stale marketing copy behind.

/** Rupee amounts and access windows for the two purchasable plans. */
export const PRICING = {
  MONTHLY_AMOUNT: 199,
  MONTHLY_DAYS: 30,
  ANNUAL_AMOUNT: 699,
  ANNUAL_DAYS: 365,
} as const

/** Annual cost per day, formatted for display, e.g. "1.92". */
export const ANNUAL_PER_DAY = (PRICING.ANNUAL_AMOUNT / PRICING.ANNUAL_DAYS).toFixed(2)

/**
 * Whole-percent saving of one annual purchase against twelve monthly ones.
 * Negative or zero if annual ever stops being the cheaper route — the badge
 * copy should be revisited if that happens.
 */
export const ANNUAL_SAVING_PCT = Math.round(
  ((PRICING.MONTHLY_AMOUNT * 12 - PRICING.ANNUAL_AMOUNT) / (PRICING.MONTHLY_AMOUNT * 12)) * 100
)
