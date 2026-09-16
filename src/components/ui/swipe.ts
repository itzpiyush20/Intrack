/** Fraction of the card's width the pointer must travel (PanInfo.offset, not the card's own translation) to count. */
export const SWIPE_DISTANCE_RATIO = 0.35
/** px/s. A flick this fast counts even when short. */
export const SWIPE_VELOCITY = 500
/** px. A flick below this distance never counts, no matter how fast — guards against a stationary tap read as a flick. */
export const SWIPE_FLICK_MIN_DISTANCE = 28

export type SwipeOutcome = 'right' | 'left' | 'return'

export function swipeOutcome(offsetX: number, velocityX: number, width: number): SwipeOutcome {
  const distance = width * SWIPE_DISTANCE_RATIO
  if (offsetX > distance || (offsetX >= SWIPE_FLICK_MIN_DISTANCE && velocityX > SWIPE_VELOCITY)) return 'right'
  if (offsetX < -distance || (offsetX <= -SWIPE_FLICK_MIN_DISTANCE && velocityX < -SWIPE_VELOCITY)) return 'left'
  return 'return'
}

/**
 * Guards a swipe card's exit against firing its callback twice — a second
 * drag-end event arriving while the card is already gliding off-screen, or a
 * retry after the guard was reset by a failed action (see item 2 in
 * SwipeCard.tsx). `beginLeaving` returns `false` (and does nothing) if the
 * card is already leaving, so callers can bail out of a duplicate drag-end.
 */
export interface SwipeGuard {
  isLeaving(): boolean
  /** Returns true the first time it is called while idle; false on any repeat until `reset`. */
  beginLeaving(): boolean
  reset(): void
}

export function createSwipeGuard(): SwipeGuard {
  let leaving = false
  return {
    isLeaving: () => leaving,
    beginLeaving: () => {
      if (leaving) return false
      leaving = true
      return true
    },
    reset: () => {
      leaving = false
    },
  }
}
