/**
 * Server-side plan amounts, in paise, as sent to Razorpay.
 *
 * These are the amounts a customer is actually charged, so this file — not the
 * UI — is the authority on money. It mirrors PRICING in src/constants/pricing.ts,
 * which is where a price change starts; pricing.test.ts asserts the two agree
 * and fails the build if they drift.
 */
export const PLAN_AMOUNTS_PAISE = {
  monthly: 199 * 100,
  annual: 699 * 100,
} as const

/**
 * How many days of access each plan buys. Mirrors MONTHLY_DAYS / ANNUAL_DAYS
 * in src/constants/pricing.ts, guarded by the same test as the amounts.
 */
export const PLAN_DURATION_DAYS = {
  monthly: 30,
  annual: 365,
} as const

export type PurchasablePlan = keyof typeof PLAN_AMOUNTS_PAISE

/** Narrow an untrusted request body value to a plan we sell. */
export function isPurchasablePlan(value: unknown): value is PurchasablePlan {
  return value === 'monthly' || value === 'annual'
}
