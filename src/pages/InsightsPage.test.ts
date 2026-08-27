import { describe, it, expect } from 'vitest'
import { buildMerchantLeaderboard } from './InsightsPage'
import { computeEmergencyMonths, completedMonthsWindow } from './analytics/emergencyReserve'

describe('buildMerchantLeaderboard', () => {
  it('groups a known-brand narration under its real merchant total', () => {
    const result = buildMerchantLeaderboard([
      { type: 'debit', date: '2026-08-01', amount: 200, merchant: 'Swiggy', description: 'Swiggy order' },
      { type: 'debit', date: '2026-08-02', amount: 300, merchant: null, description: 'UPI/4412/SWIGGY-ORDER-BLR' },
    ])
    expect(result).toEqual([{ merchant: 'Swiggy', amount: 500, count: 2 }])
  })

  it('groups unrecognized narrations under a single Unclassified row', () => {
    const result = buildMerchantLeaderboard([
      { type: 'debit', date: '2026-08-01', amount: 100, merchant: null, description: 'IMPS/1/JOHN DOE' },
      { type: 'debit', date: '2026-08-02', amount: 150, merchant: null, description: 'NEFT/2/JANE DOE' },
    ])
    expect(result).toEqual([{ merchant: 'Unclassified', amount: 250, count: 2 }])
  })

  it('excludes credit transactions and rows outside the date range', () => {
    const result = buildMerchantLeaderboard([
      { type: 'credit', date: '2026-08-01', amount: 500, merchant: 'Salary', description: '' },
      { type: 'debit', date: '2026-01-01', amount: 100, merchant: 'Amazon', description: '' },
      { type: 'debit', date: '2026-08-05', amount: 200, merchant: 'Amazon', description: '' },
    ], { startStr: '2026-08-01', endStr: '2026-08-31' })
    expect(result).toEqual([{ merchant: 'Amazon', amount: 200, count: 1 }])
  })

  it('sorts by amount descending and caps at 8 rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      type: 'debit' as const,
      date: '2026-08-01',
      amount: i + 1,
      merchant: `Merchant${i}`,
      description: '',
    }))
    const result = buildMerchantLeaderboard(rows)
    expect(result).toHaveLength(8)
    expect(result[0]).toEqual({ merchant: 'Merchant9', amount: 10, count: 1 })
  })
})

describe('completedMonthsWindow', () => {
  it('spans the five whole months before this one, excluding the month in progress', () => {
    const w = completedMonthsWindow(new Date(2026, 7, 27)) // 27 Aug 2026
    expect(w).toEqual({ startStr: '2026-03-01', endStr: '2026-07-31', months: 5 })
  })

  it('rolls across a year boundary', () => {
    const w = completedMonthsWindow(new Date(2026, 1, 9)) // 9 Feb 2026
    expect(w).toEqual({ startStr: '2025-09-01', endStr: '2026-01-31', months: 5 })
  })
})

describe('computeEmergencyMonths', () => {
  const win = { startStr: '2026-03-01', endStr: '2026-07-31', months: 5 }
  const savings = ['Investments']
  const needs = ['Rent']

  const reserveRows = [
    { type: 'debit', date: '2026-03-10', amount: 20000, category: 'Investments' },
    { type: 'debit', date: '2026-04-10', amount: 20000, category: 'Investments' },
    { type: 'debit', date: '2026-05-10', amount: 20000, category: 'Investments' },
    { type: 'debit', date: '2026-06-10', amount: 20000, category: 'Investments' },
    { type: 'debit', date: '2026-07-10', amount: 20000, category: 'Investments' },
    { type: 'debit', date: '2026-08-10', amount: 20000, category: 'Investments' },
  ]
  const needsRows = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'].map((m) => ({
    type: 'debit', date: `${m}-01`, amount: 30000, category: 'Rent',
  }))

  it('divides the reserve by average monthly needs, not by one period of needs', () => {
    // 1,20,000 saved (Mar-Aug) / 30,000 average monthly rent = 4.0 months
    expect(computeEmergencyMonths([...reserveRows, ...needsRows], savings, needs, win)).toBe(4)
  })

  it('ignores credits sitting in a savings category', () => {
    const withRedemption = [
      ...reserveRows,
      ...needsRows,
      { type: 'credit', date: '2026-08-12', amount: 90000, category: 'Investments' },
    ]
    expect(computeEmergencyMonths(withRedemption, savings, needs, win)).toBe(4)
  })

  it('excludes the month in progress from the needs average', () => {
    // A huge partial-month rent row must not drag the average up or down.
    const withCurrentMonth = [
      ...reserveRows,
      ...needsRows,
      { type: 'debit', date: '2026-08-02', amount: 500000, category: 'Rent' },
    ]
    expect(computeEmergencyMonths(withCurrentMonth, savings, needs, win)).toBe(4)
  })

  it('falls back to a nominal monthly need when no needs are recorded', () => {
    // 1,20,000 / 15,000 fallback = 8.0
    expect(computeEmergencyMonths(reserveRows, savings, needs, win)).toBe(8)
  })

  it('returns 0 when nothing has been saved', () => {
    expect(computeEmergencyMonths(needsRows, savings, needs, win)).toBe(0)
  })
})
