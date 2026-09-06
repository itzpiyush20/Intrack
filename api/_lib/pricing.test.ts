import { describe, it, expect } from 'vitest'
import { PLAN_AMOUNTS_PAISE, PLAN_DURATION_DAYS } from './pricing.js'
import { PRICING, ANNUAL_PER_DAY, ANNUAL_SAVING_PCT } from '../../src/constants/pricing'

/**
 * The seam between the two pricing files. api/ imports nothing from src/ at
 * runtime, so a price change has to be made in both places; these assertions
 * are what stops someone shipping half of one and charging the old amount.
 */
describe('pricing stays in step across the api/src boundary', () => {
  it('charges the monthly rupee price the UI advertises', () => {
    expect(PLAN_AMOUNTS_PAISE.monthly).toBe(PRICING.MONTHLY_AMOUNT * 100)
  })

  it('charges the annual rupee price the UI advertises', () => {
    expect(PLAN_AMOUNTS_PAISE.annual).toBe(PRICING.ANNUAL_AMOUNT * 100)
  })

  it('grants the access window the UI advertises', () => {
    expect(PLAN_DURATION_DAYS.monthly).toBe(PRICING.MONTHLY_DAYS)
    expect(PLAN_DURATION_DAYS.annual).toBe(PRICING.ANNUAL_DAYS)
  })

  it('bills in whole paise', () => {
    for (const amount of Object.values(PLAN_AMOUNTS_PAISE)) {
      expect(Number.isInteger(amount)).toBe(true)
      expect(amount).toBeGreaterThan(0)
    }
  })
})

describe('derived pricing copy', () => {
  it('derives the per-day figure from the annual price', () => {
    expect(Number(ANNUAL_PER_DAY)).toBeCloseTo(PRICING.ANNUAL_AMOUNT / PRICING.ANNUAL_DAYS, 2)
  })

  it('derives the savings badge from both prices', () => {
    const twelveMonths = PRICING.MONTHLY_AMOUNT * 12
    expect(ANNUAL_SAVING_PCT).toBe(
      Math.round(((twelveMonths - PRICING.ANNUAL_AMOUNT) / twelveMonths) * 100)
    )
  })

  it('never advertises a saving the prices do not support', () => {
    const annualIsCheaper = PRICING.ANNUAL_AMOUNT < PRICING.MONTHLY_AMOUNT * 12
    expect(ANNUAL_SAVING_PCT > 0).toBe(annualIsCheaper)
  })
})
