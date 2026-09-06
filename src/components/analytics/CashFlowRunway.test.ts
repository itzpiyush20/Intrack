import { describe, it, expect } from 'vitest'
import {
  simulateCashFlowRunway,
  detectExpectedIncomes,
  detectPlannedPayments,
  calculateAvgDailyDiscretionarySpend,
} from './CashFlowRunway'
import { toISODateLocal } from '@/utils/dateFilter'

describe('CashFlowRunway simulation engine', () => {
  const fixedNow = new Date(2026, 8, 1) // 1 Sep 2026

  it('implements exact recurrence: Balance(t) = Balance(t-1) + Incomes(t) - Payments(t) - Discretionary', () => {
    const startingBalance = 50000
    const dailyDiscretionary = 800
    const customIncomes = [
      { id: '1', name: 'Salary', amount: 30000, dayOfMonth: 15, frequency: 'monthly' as const },
    ]
    const customPayments = [
      { id: 'sub1', name: 'Internet', amount: 1200, nextDate: '2026-09-10', frequency: 'monthly' as const },
    ]

    const result = simulateCashFlowRunway({
      startingBalance,
      horizon: 30,
      customIncomes,
      customPayments,
      discretionarySpendOverride: dailyDiscretionary,
      now: fixedNow,
    })

    expect(result.points).toHaveLength(31) // Day 0 + 30 days
    expect(result.points[0].balance).toBe(startingBalance)

    for (let t = 1; t <= 30; t++) {
      const prev = result.points[t - 1].balance
      const current = result.points[t].balance
      const inc = result.points[t].expectedIncome
      const pay = result.points[t].plannedPayments
      const disc = result.points[t].discretionarySpend

      expect(current).toBe(prev + inc - pay - disc)
    }
  })

  it('detects cash crunch and highlights exact date of negative balance', () => {
    // Starting balance 10,000, daily spend 1,000, no income -> runs out in 11 days (Day 11 dips to -1,000)
    const result = simulateCashFlowRunway({
      startingBalance: 10000,
      horizon: 30,
      customIncomes: [],
      customPayments: [],
      discretionarySpendOverride: 1000,
      now: fixedNow,
    })

    expect(result.status).toBe('crunch')
    expect(result.crunchDayIndex).toBe(11)
    expect(result.runwayDays).toBe(11)
    expect(result.crunchDate).toBe('2026-09-12')
    expect(result.points[11].balance).toBe(-1000)
    expect(result.points[11].isFirstCrunch).toBe(true)
  })

  it('highlights exact date and amount of lowest balance dip (trough)', () => {
    // Starts at 20,000, spends 1,000/day for 14 days (down to 6,000 on Sep 15),
    // receives 50,000 salary on Sep 15, ending higher
    const customIncomes = [
      { id: '1', name: 'Salary', amount: 50000, dayOfMonth: 15, frequency: 'monthly' as const },
    ]

    const result = simulateCashFlowRunway({
      startingBalance: 20000,
      horizon: 30,
      customIncomes,
      customPayments: [],
      discretionarySpendOverride: 1000,
      now: fixedNow,
    })

    // Dip happens on Day 13 (Sep 14) right before the salary credit on Sep 15
    expect(result.lowestBalanceDayIndex).toBe(13)
    expect(result.lowestBalanceDate).toBe('2026-09-14')
    expect(result.lowestBalance).toBe(7000)
    expect(result.points[13].isTrough).toBe(true)
  })

  it('supports 30, 60, and 90 day horizons', () => {
    const r30 = simulateCashFlowRunway({ startingBalance: 50000, horizon: 30, now: fixedNow })
    const r60 = simulateCashFlowRunway({ startingBalance: 50000, horizon: 60, now: fixedNow })
    const r90 = simulateCashFlowRunway({ startingBalance: 50000, horizon: 90, now: fixedNow })

    expect(r30.points).toHaveLength(31)
    expect(r60.points).toHaveLength(61)
    expect(r90.points).toHaveLength(91)
  })

  it('correctly calculates status as cushion when buffer is ample', () => {
    const result = simulateCashFlowRunway({
      startingBalance: 150000,
      horizon: 60,
      customIncomes: [
        { id: '1', name: 'Salary', amount: 75000, dayOfMonth: 1, frequency: 'monthly' as const },
      ],
      customPayments: [],
      discretionarySpendOverride: 500,
      now: fixedNow,
    })

    expect(result.status).toBe('cushion')
    expect(result.crunchDate).toBeNull()
    expect(result.endingBalance).toBeGreaterThan(150000)
  })
})

describe('detectExpectedIncomes', () => {
  it('detects recurring monthly salary across distinct months', () => {
    const transactions = [
      { type: 'credit' as const, date: '2026-07-01', amount: 65000, merchant: 'Acme Corp', category: 'Salary' },
      { type: 'credit' as const, date: '2026-08-01', amount: 65000, merchant: 'Acme Corp', category: 'Salary' },
    ]

    const incomes = detectExpectedIncomes(transactions)
    expect(incomes).toHaveLength(1)
    expect(incomes[0].amount).toBe(65000)
    expect(incomes[0].dayOfMonth).toBe(1)
  })
})

describe('calculateAvgDailyDiscretionarySpend', () => {
  it('excludes planned payments and credit card bill payments from discretionary spend', () => {
    const planned = [{ id: '1', name: 'Netflix', amount: 649, nextDate: '2026-09-10', frequency: 'monthly' as const }]
    const now = new Date(2026, 8, 1)

    const txns = [
      // Discretionary
      { type: 'debit' as const, date: '2026-08-20', amount: 3000, merchant: 'Swiggy', category: 'Food & Dining' },
      { type: 'debit' as const, date: '2026-08-25', amount: 3000, merchant: 'Supermarket', category: 'Groceries' },
      // Excluded
      { type: 'debit' as const, date: '2026-08-10', amount: 649, merchant: 'Netflix', category: 'Subscriptions' },
      { type: 'debit' as const, date: '2026-08-05', amount: 25000, merchant: 'HDFC CC', category: 'Credit Card Bill' },
    ]

    const avg = calculateAvgDailyDiscretionarySpend(txns, planned, now, 30)
    // 6000 total discretionary / ~12 days spanned >= 500
    expect(avg).toBeGreaterThan(0)
    expect(avg).toBeLessThan(1000)
  })
})
