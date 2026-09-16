import { describe, expect, it } from 'vitest'
import { SWIPE_DISTANCE_RATIO, SWIPE_VELOCITY, swipeOutcome } from './swipe'

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
})
