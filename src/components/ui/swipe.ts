/** Fraction of the card's width the pointer must travel (PanInfo.offset, not the card's own translation) to count. */
export const SWIPE_DISTANCE_RATIO = 0.35
/** px/s. A flick this fast counts even when short. */
export const SWIPE_VELOCITY = 500
/** px. A flick below this distance never counts, no matter how fast — guards against a stationary tap read as a flick. */
export const SWIPE_FLICK_MIN_DISTANCE = 28

export type SwipeOutcome = 'right' | 'left' | 'return'

export function swipeOutcome(offsetX: number, velocityX: number, width: number): SwipeOutcome {
  const distance = width * SWIPE_DISTANCE_RATIO
  // Past the threshold but thrown back hard towards centre on release: the
  // user changed their mind mid-gesture, so distance alone must not decide.
  if ((offsetX > 0 && velocityX < -SWIPE_VELOCITY) || (offsetX < 0 && velocityX > SWIPE_VELOCITY)) return 'return'
  if (offsetX > distance || (offsetX >= SWIPE_FLICK_MIN_DISTANCE && velocityX > SWIPE_VELOCITY)) return 'right'
  if (offsetX < -distance || (offsetX <= -SWIPE_FLICK_MIN_DISTANCE && velocityX < -SWIPE_VELOCITY)) return 'left'
  return 'return'
}

/**
 * Guards a swipe card's exit so its action fires once — whichever of a drag
 * release or the card's own Approve/Reject button gets there first. A second
 * drag-end while the card is gliding off, a button tap after a swipe, or a
 * swipe after a button tap all find the guard latched. It is reset only when
 * the action reports failure or the card is brought back (see SwipeCard.tsx).
 * `beginLeaving` returns `false` (and does nothing) if the card is already
 * leaving, so callers bail out of the duplicate.
 */
export interface SwipeGuard {
  isLeaving(): boolean
  /** Returns true the first time it is called while idle; false on any repeat until `reset`. */
  beginLeaving(): boolean
  reset(): void
  /**
   * Changes on every successful `beginLeaving` and every `reset`. An async
   * result compares the value it started with, so a late failure from an old
   * action cannot pull back a card that has since been reset or acted again.
   */
  attempt(): number
}

export function createSwipeGuard(): SwipeGuard {
  let leaving = false
  let attempt = 0
  return {
    isLeaving: () => leaving,
    beginLeaving: () => {
      if (leaving) return false
      leaving = true
      attempt += 1
      return true
    },
    reset: () => {
      leaving = false
      attempt += 1
    },
    attempt: () => attempt,
  }
}
