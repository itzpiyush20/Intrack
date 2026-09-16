import { describe, expect, it } from 'vitest'
import { GLIDE, GLIDE_EASE, PRESS_SCALE, glide } from './motion'

describe('glide tokens', () => {
  it('uses the owner-approved curve', () => {
    expect([...GLIDE_EASE]).toEqual([0.22, 1, 0.36, 1])
  })

  it('never overshoots: both bezier y control points are at most 1', () => {
    // The owner rejected a bouncy version. A y value above 1 is what makes a
    // cubic-bezier pass its target and come back.
    expect(GLIDE_EASE[1]).toBeLessThanOrEqual(1)
    expect(GLIDE_EASE[3]).toBeLessThanOrEqual(1)
  })

  it('keeps interface feedback within 350ms and figures within 800ms', () => {
    expect(GLIDE.fast).toBeLessThanOrEqual(0.35)
    expect(GLIDE.base).toBeLessThanOrEqual(0.35)
    expect(GLIDE.figure).toBeLessThanOrEqual(0.8)
  })

  it('collapses to nothing under reduced motion', () => {
    expect(glide(true)).toEqual({ duration: 0 })
  })

  it('returns duration and curve when motion is allowed', () => {
    expect(glide(false, 0.5)).toEqual({ duration: 0.5, ease: GLIDE_EASE })
  })

  it('accepts a different curve for the motion lab', () => {
    const softer = [0.33, 1, 0.68, 1] as const
    expect(glide(false, 0.3, softer)).toEqual({ duration: 0.3, ease: softer })
  })

  it('presses gently', () => {
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.95)
    expect(PRESS_SCALE).toBeLessThan(1)
  })
})
