import { describe, it, expect } from 'vitest'
import { planIdFor, durationDaysFor, planTypeForPlanId, type PlanType } from './subscriptionPlans.js'

describe('subscriptionPlans', () => {
  const env = { RAZORPAY_PLAN_MONTHLY: 'plan_mon', RAZORPAY_PLAN_ANNUAL: 'plan_ann' }

  it('maps plan types to configured Razorpay plan ids', () => {
    expect(planIdFor('monthly', env)).toBe('plan_mon')
    expect(planIdFor('annual', env)).toBe('plan_ann')
  })

  it('throws when a plan id is not configured, rather than charging the wrong plan', () => {
    expect(() => planIdFor('monthly', {})).toThrow(/not configured/i)
  })

  it('rejects an unknown plan type', () => {
    expect(() => planIdFor('lifetime' as PlanType, env)).toThrow(/unknown plan type/i)
  })

  it('reports the duration each plan buys', () => {
    expect(durationDaysFor('monthly')).toBe(30)
    expect(durationDaysFor('annual')).toBe(365)
  })

  it('maps a Razorpay plan id back to a plan type', () => {
    expect(planTypeForPlanId('plan_ann', env)).toBe('annual')
    expect(planTypeForPlanId('plan_unknown', env)).toBeNull()
  })

  it('never matches an empty/malformed plan id against an unconfigured (empty) env var', () => {
    expect(
      planTypeForPlanId('', { RAZORPAY_PLAN_MONTHLY: '', RAZORPAY_PLAN_ANNUAL: '' }),
    ).toBeNull()
  })

  it('throws rather than guessing when both plan ids are configured identically', () => {
    expect(() =>
      planTypeForPlanId('plan_dup', {
        RAZORPAY_PLAN_MONTHLY: 'plan_dup',
        RAZORPAY_PLAN_ANNUAL: 'plan_dup',
      }),
    ).toThrow(/same plan id/i)
  })
})
