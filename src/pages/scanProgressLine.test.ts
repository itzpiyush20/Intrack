import { describe, expect, it } from 'vitest'
import { nextScanFraction, scanProgressFraction, splitProgressCount } from './scanProgressLine'

describe('scan progress line', () => {
  it('moves through the phases in order', () => {
    const listing = scanProgressFraction({ phase: 'listing', current: 9, total: 9 })!
    const fetchingHalf = scanProgressFraction({ phase: 'fetching', current: 3, total: 6 })!
    const filteringDone = scanProgressFraction({ phase: 'filtering', current: 6, total: 6 })!
    const analyzingStart = scanProgressFraction({ phase: 'analyzing', current: 0, total: 4 })!
    const analyzingDone = scanProgressFraction({ phase: 'analyzing', current: 4, total: 4 })!
    expect(listing).toBeLessThan(fetchingHalf)
    expect(fetchingHalf).toBeLessThan(filteringDone)
    expect(filteringDone).toBeLessThanOrEqual(analyzingStart)
    expect(analyzingStart).toBeLessThan(analyzingDone)
    expect(analyzingDone).toBeLessThan(1)
  })

  it('treats a phase with nothing to do as finished, and clamps overshoot', () => {
    expect(scanProgressFraction({ phase: 'analyzing', current: 0, total: 0 })).toBe(0.95)
    expect(scanProgressFraction({ phase: 'fetching', current: 12, total: 6 })).toBe(0.4)
  })

  it('never moves backwards, and a saving flush mid-analysis does not move it', () => {
    let f = 0
    f = nextScanFraction(f, { phase: 'analyzing', current: 2, total: 4 })
    const mid = f
    f = nextScanFraction(f, { phase: 'saving', current: 0, total: 3 })
    expect(f).toBe(mid)
    f = nextScanFraction(f, { phase: 'fetching', current: 1, total: 10 })
    expect(f).toBe(mid)
  })

  it('splits the status text around its first number only', () => {
    expect(splitProgressCount('Reading email 12 of 40… (4s)')).toEqual({
      before: 'Reading email ',
      count: 12,
      after: ' of 40… (4s)',
    })
    expect(splitProgressCount('Preparing…')).toBeNull()
  })
})
