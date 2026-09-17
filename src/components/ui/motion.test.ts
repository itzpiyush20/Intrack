import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  DURATION, EASE_OUT, GLIDE, GLIDE_EASE, INDICATOR_SPRING, PRESS_SCALE,
  glide, staggerChild, transition,
} from './motion'

describe('glide tokens', () => {
  it('uses the owner-chosen curve (Softer, picked in the motion lab 2026-09-17)', () => {
    expect([...GLIDE_EASE]).toEqual([0.33, 1, 0.68, 1])
  })

  it('uses the owner-chosen speed (1.1x the first draft)', () => {
    expect(GLIDE).toEqual({ fast: 0.22, base: 0.33, slow: 0.55, figure: 0.88 })
  })

  it('never overshoots: both bezier y control points are at most 1', () => {
    // The owner rejected a bouncy version. A y value above 1 is what makes a
    // cubic-bezier pass its target and come back.
    expect(GLIDE_EASE[1]).toBeLessThanOrEqual(1)
    expect(GLIDE_EASE[3]).toBeLessThanOrEqual(1)
  })

  it('keeps interface feedback within 350ms and figures within 900ms', () => {
    expect(GLIDE.fast).toBeLessThanOrEqual(0.35)
    expect(GLIDE.base).toBeLessThanOrEqual(0.35)
    expect(GLIDE.figure).toBeLessThanOrEqual(0.9)
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

describe('older motion exports follow the owner-chosen feel', () => {
  // Existing screens still import these names. Pointing them at the glide
  // values moves every screen to the chosen feel at once, instead of leaving
  // half the app on the first draft.
  it('uses the chosen curve', () => {
    expect([...EASE_OUT]).toEqual([...GLIDE_EASE])
    expect(transition(false)).toMatchObject({ ease: GLIDE_EASE })
  })

  it('maps durations onto the glide scale', () => {
    expect(DURATION).toEqual({ fast: GLIDE.fast, base: GLIDE.fast, slow: GLIDE.base, data: GLIDE.figure })
  })

  it('moves the tab marker with the glide, not a spring', () => {
    expect(INDICATOR_SPRING).toEqual({ duration: GLIDE.base, ease: GLIDE_EASE })
  })

  it('staggers children with the chosen curve', () => {
    const animate = staggerChild(false).animate as { transition: { ease: unknown } }
    expect(animate.transition.ease).toEqual(GLIDE_EASE)
  })
})

describe('signed-in screens use the shared motion tokens', () => {
  // A hand-typed curve or spring is how screens drift apart again. Public
  // marketing pages (landing, pricing, about) are outside the motion brief.
  const root = join(__dirname, '..', '..')
  const skip = /(landing|pricing|Landing|Pricing|About|MarketingHeader|MotionLabPage|motion\.ts|\.test\.)/

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return files(path)
      return /\.tsx?$/.test(name) && !skip.test(path) ? [path] : []
    })
  }

  it('has no hand-typed first-draft curve or spring left', () => {
    const offenders = files(root).filter((path) => {
      const source = readFileSync(path, 'utf-8')
      return /0\.16,\s*1,\s*0\.3,\s*1|type:\s*'spring'/.test(source)
    })
    expect(offenders).toEqual([])
  })
})
