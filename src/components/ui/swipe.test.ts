import { describe, expect, it } from 'vitest'
import {
  SWIPE_DISTANCE_RATIO,
  SWIPE_FLICK_MIN_DISTANCE,
  SWIPE_VELOCITY,
  createSwipeGuard,
  swipeOutcome,
} from './swipe'

const WIDTH = 400
const past = WIDTH * SWIPE_DISTANCE_RATIO + 1
const short = WIDTH * SWIPE_DISTANCE_RATIO - 1

describe('swipeOutcome', () => {
  it('goes right when dragged past the threshold to the right', () => {
    expect(swipeOutcome(past, 0, WIDTH)).toBe('right')
  })

  it('goes left when dragged past the threshold to the left', () => {
    expect(swipeOutcome(-past, 0, WIDTH)).toBe('left')
  })

  it('returns when the drag stops short, slowly', () => {
    expect(swipeOutcome(short, 0, WIDTH)).toBe('return')
    expect(swipeOutcome(-short, 0, WIDTH)).toBe('return')
  })

  it('accepts a short fast flick', () => {
    expect(swipeOutcome(40, SWIPE_VELOCITY + 1, WIDTH)).toBe('right')
    expect(swipeOutcome(-40, -(SWIPE_VELOCITY + 1), WIDTH)).toBe('left')
  })

  it('does not approve a flick that moves against its own velocity', () => {
    // Dragged left, then flicked right on release: the card is still left of
    // centre. Acting on velocity alone would approve something the user was
    // pulling towards reject.
    expect(swipeOutcome(-40, SWIPE_VELOCITY + 1, WIDTH)).toBe('return')
  })

  it('returns when a drag past the threshold is flicked back the other way on release', () => {
    // Pulled well past the approve threshold, then thrown back towards
    // centre: the user changed their mind mid-gesture. Distance alone would
    // still approve it.
    expect(swipeOutcome(past, -(SWIPE_VELOCITY + 1), WIDTH)).toBe('return')
    expect(swipeOutcome(-past, SWIPE_VELOCITY + 1, WIDTH)).toBe('return')
  })

  it('still goes when past the threshold with a slow drift back', () => {
    expect(swipeOutcome(past, -SWIPE_VELOCITY, WIDTH)).toBe('right')
    expect(swipeOutcome(-past, SWIPE_VELOCITY, WIDTH)).toBe('left')
  })

  it('ignores a fast flick that barely moved', () => {
    const tooShort = SWIPE_FLICK_MIN_DISTANCE - 1
    expect(swipeOutcome(tooShort, SWIPE_VELOCITY + 1, WIDTH)).toBe('return')
    expect(swipeOutcome(-tooShort, -(SWIPE_VELOCITY + 1), WIDTH)).toBe('return')
  })

  it('accepts a fast flick right at the minimum distance', () => {
    expect(swipeOutcome(SWIPE_FLICK_MIN_DISTANCE, SWIPE_VELOCITY + 1, WIDTH)).toBe('right')
    expect(swipeOutcome(-SWIPE_FLICK_MIN_DISTANCE, -(SWIPE_VELOCITY + 1), WIDTH)).toBe('left')
  })
})

describe('createSwipeGuard', () => {
  it('lets the first beginLeaving through and blocks repeats until reset', () => {
    const guard = createSwipeGuard()
    expect(guard.isLeaving()).toBe(false)
    expect(guard.beginLeaving()).toBe(true)
    expect(guard.isLeaving()).toBe(true)
    expect(guard.beginLeaving()).toBe(false)
    expect(guard.beginLeaving()).toBe(false)
    guard.reset()
    expect(guard.isLeaving()).toBe(false)
    expect(guard.beginLeaving()).toBe(true)
  })

  it('moves the attempt on each new action and each reset, not on a blocked repeat', () => {
    const guard = createSwipeGuard()
    const idle = guard.attempt()
    guard.beginLeaving()
    const first = guard.attempt()
    expect(first).not.toBe(idle)
    guard.beginLeaving()
    expect(guard.attempt()).toBe(first)
    guard.reset()
    expect(guard.attempt()).not.toBe(first)
  })
})
