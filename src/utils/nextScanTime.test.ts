import { describe, it, expect } from 'vitest'
import { formatNextScanTime } from './index'

/**
 * The day label is the part worth testing. The 24-hour allowance routinely puts
 * the next scan on the following calendar day, and "at 9:00 AM" with no day
 * reads as this morning — a wait the user has already sat through.
 */
describe('formatNextScanTime', () => {
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min, 0, 0)

  it('omits the day when the target is later today', () => {
    const now = at(2026, 7, 27, 9, 0)
    const target = at(2026, 7, 27, 15, 45)
    expect(formatNextScanTime(target, now)).toBe('at 3:45 pm')
  })

  it('says tomorrow when the target is the next calendar day', () => {
    const now = at(2026, 7, 27, 9, 0)
    const target = at(2026, 7, 28, 9, 0)
    expect(formatNextScanTime(target, now)).toBe('tomorrow at 9:00 am')
  })

  it('treats a few hours across midnight as tomorrow, not today', () => {
    // 11pm to 1am is two hours but two days. Users think in days.
    const now = at(2026, 7, 27, 23, 0)
    const target = at(2026, 7, 28, 1, 0)
    expect(formatNextScanTime(target, now)).toBe('tomorrow at 1:00 am')
  })

  it('names the date when the target is further out', () => {
    const now = at(2026, 7, 27, 9, 0)
    const target = at(2026, 7, 29, 9, 0)
    expect(formatNextScanTime(target, now)).toContain('29 Aug')
    expect(formatNextScanTime(target, now)).toContain('9:00 am')
  })

  it('does not label a target already in the past', () => {
    const now = at(2026, 7, 27, 15, 0)
    const target = at(2026, 7, 27, 9, 0)
    expect(formatNextScanTime(target, now)).toBe('at 9:00 am')
  })
})
