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
 * The webhook receives a plan id and must decide what was bought. Returns null
 * rather than guessing, so an unrecognised plan is logged and ignored instead
 * of silently granting the wrong period.
 */
export function planTypeForPlanId(planId: string, env: Env = process.env): PlanType | null {
  for (const type of Object.keys(ENV_KEY) as PlanType[]) {
    if (env[ENV_KEY[type]] === planId) return type
  }
  return null
}
