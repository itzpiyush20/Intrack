import { describe, it, expect } from 'vitest'
import { planIdFor, durationDaysFor, planTypeForPlanId, scheduledStartFor, type PlanType } from './subscriptionPlans.js'

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

describe('scheduledStartFor', () => {
  const now = new Date('2026-09-08T00:00:00.000Z')

  it('schedules the first charge for the day existing access runs out', () => {
    const expiry = '2026-09-28T00:00:00.000Z'
    expect(scheduledStartFor(expiry, now)).toBe(Math.floor(Date.parse(expiry) / 1000))
  })

  it('starts immediately when the customer has no time left to protect', () => {
    expect(scheduledStartFor(null, now)).toBeNull()
    expect(scheduledStartFor(undefined, now)).toBeNull()
  })

  it('starts immediately when access has already lapsed', () => {
    expect(scheduledStartFor('2026-09-01T00:00:00.000Z', now)).toBeNull()
  })

  it('starts immediately when expiry is too close for Razorpay to schedule against', () => {
    // Inside the buffer. Scheduling here risks Razorpay rejecting a start_at
    // that has already passed by the time the request lands.
    expect(scheduledStartFor('2026-09-08T00:30:00.000Z', now)).toBeNull()
  })

  it('ignores an unparseable expiry rather than sending NaN to Razorpay', () => {
    expect(scheduledStartFor('not-a-date', now)).toBeNull()
  })
})
