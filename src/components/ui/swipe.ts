/** Fraction of the card's width a drag must travel to count. */
export const SWIPE_DISTANCE_RATIO = 0.35
/** px/s. A flick this fast counts even when short. */
export const SWIPE_VELOCITY = 500

export type SwipeOutcome = 'right' | 'left' | 'return'

export function swipeOutcome(offsetX: number, velocityX: number, width: number): SwipeOutcome {
  const distance = width * SWIPE_DISTANCE_RATIO
  if (offsetX > distance || (offsetX > 0 && velocityX > SWIPE_VELOCITY)) return 'right'
  if (offsetX < -distance || (offsetX < 0 && velocityX < -SWIPE_VELOCITY)) return 'left'
  return 'return'
}
