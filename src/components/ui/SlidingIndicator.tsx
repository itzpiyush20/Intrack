// ============================================
// SlidingIndicator
//
// The highlight behind the active nav item or tab. Render it inside whichever
// item is active, with the same `layoutId` for the whole group; framer-motion
// glides it from the old item to the new one. The item needs `relative` and
// its label needs `relative z-10` to sit above it.
// ============================================

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'

export interface SlidingIndicatorProps {
  layoutId: string
  className?: string
  duration?: number
  ease?: Bezier
}

export default function SlidingIndicator({
  layoutId,
  className,
  duration = GLIDE.base,
  ease = GLIDE_EASE,
}: SlidingIndicatorProps) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className={cn('absolute inset-0', className)}
      transition={glide(reduce, duration, ease)}
    />
  )
}
