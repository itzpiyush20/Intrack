// ============================================
// SwipeCard
//
// A card the user can drag sideways. Past the threshold (or on a fast flick)
// it glides off that side and the matching callback runs; otherwise it glides
// back. The drag has resistance so it reads as a physical card.
//
// Swiping is a shortcut, never the only way: every screen using this keeps
// visible buttons for the same actions, for keyboard and screen-reader users.
// `touch-pan-y` keeps vertical page scrolling working on the card.
//
// Double-fire guard: `onSwipeRight`/`onSwipeLeft` decide money. A `createSwipeGuard`
// (see swipe.ts) latches as soon as an exit starts, dragging is disabled for the
// ~half-second the card takes to leave (`drag={leaving ? false : 'x'}`), and a
// drag-end that arrives anyway is ignored — so a second release, or the exit
// animation racing a fresh gesture, cannot call the callback twice. Callers that
// pair the swipe with their own buttons (see MotionLabPage) are outside this
// guard and should disable those buttons while the row is leaving.
//
// `onSwipeRight`/`onSwipeLeft` may return `false` (or a promise that resolves to
// `false`, or reject) to signal the action failed — the card glides back to
// centre (x: 0, opacity: 1) and the guard resets so the card is swipeable again.
// Returning `void`/`true` (or resolving to it) is treated as success and the
// card stays gone.
// ============================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useAnimationControls, useReducedMotion, type PanInfo } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { createSwipeGuard, swipeOutcome } from './swipe'

/** `false` (or a promise resolving to it) means the action failed and the card should return. */
export type SwipeResult = void | boolean

export interface SwipeCardProps {
  children: ReactNode
  onSwipeRight: () => SwipeResult | Promise<SwipeResult>
  onSwipeLeft: () => SwipeResult | Promise<SwipeResult>
  className?: string
  /** Seconds for the card to leave. */
  duration?: number
  ease?: Bezier
}

export default function SwipeCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  className,
  duration = GLIDE.slow,
  ease = GLIDE_EASE,
}: SwipeCardProps) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const controls = useAnimationControls()
  const guardRef = useRef(createSwipeGuard())
  const mountedRef = useRef(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  async function returnToCentre() {
    guardRef.current.reset()
    if (!mountedRef.current) return
    setLeaving(false)
    await controls.start({ x: 0, opacity: 1, transition: glide(reduce, GLIDE.base, ease) })
  }

  async function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (guardRef.current.isLeaving()) return
    const width = ref.current?.offsetWidth ?? 320
    const outcome = swipeOutcome(info.offset.x, info.velocity.x, width)
    if (outcome === 'return') {
      void controls.start({ x: 0, transition: glide(reduce, GLIDE.base, ease) })
      return
    }
    if (!guardRef.current.beginLeaving()) return
    setLeaving(true)
    const direction = outcome === 'right' ? 1 : -1
    await controls.start({ x: direction * width * 1.1, opacity: 0, transition: glide(reduce, duration, ease) })
    if (!mountedRef.current) return

    const callback = outcome === 'right' ? onSwipeRight : onSwipeLeft
    try {
      const result = await callback()
      if (result === false) await returnToCentre()
    } catch (error) {
      // A rejected action is treated the same as `false`: the card returns
      // rather than vanishing on a transaction that was never approved. The
      // error itself is the caller's to handle (e.g. a toast); this handler
      // only owns the card's own animation state, so it is logged, not thrown.
      console.error('SwipeCard action failed', error)
      await returnToCentre()
    }
  }

  return (
    <motion.div
      ref={ref}
      drag={leaving ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      dragMomentum={false}
      animate={controls}
      onDragEnd={handleDragEnd}
      className={cn('touch-pan-y', className)}
    >
      {children}
    </motion.div>
  )
}
