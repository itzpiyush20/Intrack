import { describe, it, expect, afterEach, vi } from 'vitest'
import { detectAnomalies } from './aiService'

const at = (back: number, day: number) => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - back, day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const row = (back: number, day: number, amount: number, category = 'Food') => ({
  amount, category, date: at(back, day), merchant: '', type: 'debit',
})

/** Three completed months at 10,000 each — the baseline every test compares to. */
const baselineRows = [row(1, 5, 10000), row(2, 5, 10000), row(3, 5, 10000)]

afterEach(() => vi.useRealTimers())

/** Freeze to a mid-month day so proration is active and the ramp is fully weighted. */
const freezeToDay = (day: number) => {
  const now = new Date()
  vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0))
}

describe('detectAnomalies — the month in progress is prorated', () => {
  it('catches a spike mid-month that raw totals would still be hiding', () => {
    vi.useFakeTimers()
    freezeToDay(10)
    // 9,000 spent by day 10 is under the 10,000 baseline, but the month-end
    // pace lands far above it.
    const found = detectAnomalies([...baselineRows, row(0, 3, 4500), row(0, 8, 4500)])
    expect(found).toHaveLength(1)
    expect(found[0].category).toBe('Food')
    expect(found[0].isProjection).toBe(true)
    expect(found[0].thisMonth).toBe(9000)
    expect(found[0].projectedMonth).toBeGreaterThan(found[0].thisMonth)
    expect(found[0].spike).toBeGreaterThan(80)
  })

  it('reports the actual spend and the projection as separate figures', () => {
    vi.useFakeTimers()
    freezeToDay(10)
    const [found] = detectAnomalies([...baselineRows, row(0, 3, 4500), row(0, 8, 4500)])
    // The percentage must be derived from the projection, not the raw total,
    // or the three numbers on the card cannot be reconciled.
    expect(found.spike).toBeCloseTo(((found.projectedMonth - found.baseline) / found.baseline) * 100, 6)
  })

  it('damps a day-2 lump sum instead of reading it as a 15x spike', () => {
    vi.useFakeTimers()
    freezeToDay(2)
    const [found] = detectAnomalies([...baselineRows, row(0, 1, 12000)])
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    const undamped = (12000 / 2) * daysInMonth
    expect(found.projectedMonth).toBeLessThan(undamped)
  })

  it('leaves a quiet month alone', () => {
    vi.useFakeTimers()
    freezeToDay(15)
    expect(detectAnomalies([...baselineRows, row(0, 5, 4000)])).toEqual([])
  })

  it('ignores credits', () => {
    vi.useFakeTimers()
    freezeToDay(15)
    const credits = [{ amount: 500000, category: 'Food', date: at(0, 5), merchant: '', type: 'credit' }]
    expect(detectAnomalies([...baselineRows, ...credits])).toEqual([])
  })
})
