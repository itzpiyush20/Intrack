export type PlanType = 'monthly' | 'annual'

type Env = Record<string, string | undefined>

const DURATION_DAYS: Record<PlanType, number> = { monthly: 30, annual: 365 }

const ENV_KEY: Record<PlanType, string> = {
  monthly: 'RAZORPAY_PLAN_MONTHLY',
  annual: 'RAZORPAY_PLAN_ANNUAL',
}

/**
 * Plan ids come from the environment, never from the request body. The body is
 * what verify-payment.ts already exists to distrust, and a caller who could
 * choose the Razorpay plan could choose its price.
 */
export function planIdFor(planType: PlanType, env: Env = process.env): string {
  const key = ENV_KEY[planType]
  if (!key) throw new Error(`Unknown plan type: ${planType}`)
  const planId = env[key]
  if (!planId) throw new Error(`Razorpay plan id not configured for ${planType} (${key})`)
  return planId
}

export function durationDaysFor(planType: PlanType): number {
  const days = DURATION_DAYS[planType]
  if (!days) throw new Error(`Unknown plan type: ${planType}`)
  return days
}

/**
 * Razorpay rejects a start_at that is not comfortably in the future, and a
 * request can sit in flight for a while. An expiry closer than this just starts
 * the subscription now.
 */
const START_AT_BUFFER_MS = 60 * 60 * 1000

/**
 * When a customer still holds paid access, their subscription's first charge is
 * scheduled for the day that access runs out — they must not pay twice for the
 * same days. Returns a Unix timestamp for Razorpay's `start_at`, or null to
 * start immediately.
 *
 * Razorpay authorises a future-dated subscription with a small token charge
 * (~₹5) that it refunds straight away, then bills the real amount on the date
 * returned here.
 */
export function scheduledStartFor(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!expiresAt) return null
  const expiryMs = Date.parse(expiresAt)
  // An unparseable date must never reach Razorpay as NaN, which would either be
  // rejected or — worse — silently coerced into a wrong billing date.
  if (Number.isNaN(expiryMs)) return null
  if (expiryMs - now.getTime() < START_AT_BUFFER_MS) return null
  return Math.floor(expiryMs / 1000)
}

/**
 * The webhook receives a plan id and must decide what was bought. Returns null
 * rather than guessing, so an unrecognised plan is logged and ignored instead
 * of silently granting the wrong period.
 */
export function planTypeForPlanId(planId: string, env: Env = process.env): PlanType | null {
  const configured = (Object.keys(ENV_KEY) as PlanType[]).map((type) => env[ENV_KEY[type]])
  if (configured[0] && configured[1] && configured[0] === configured[1]) {
    throw new Error(
      `RAZORPAY_PLAN_MONTHLY and RAZORPAY_PLAN_ANNUAL are both set to the same plan id (${configured[0]}); refusing to guess which plan was purchased`,
    )
  }
  for (const type of Object.keys(ENV_KEY) as PlanType[]) {
    const configuredId = env[ENV_KEY[type]]
    if (configuredId && configuredId === planId) return type
  }
  return null
}
