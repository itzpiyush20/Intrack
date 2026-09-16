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
// ============================================

import { useRef, type ReactNode } from 'react'
import { motion, useAnimationControls, useReducedMotion, type PanInfo } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { swipeOutcome } from './swipe'

export interface SwipeCardProps {
  children: ReactNode
  onSwipeRight: () => void
  onSwipeLeft: () => void
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

  async function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const width = ref.current?.offsetWidth ?? 320
    const outcome = swipeOutcome(info.offset.x, info.velocity.x, width)
    if (outcome === 'return') {
      void controls.start({ x: 0, transition: glide(reduce, GLIDE.base, ease) })
      return
    }
    const direction = outcome === 'right' ? 1 : -1
    await controls.start({ x: direction * width * 1.1, opacity: 0, transition: glide(reduce, duration, ease) })
    if (outcome === 'right') onSwipeRight()
    else onSwipeLeft()
  }

  return (
    <motion.div
      ref={ref}
      drag="x"
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
