// ============================================
// MorphSurface
//
// Two elements sharing a `morphId` — the Add button and the form it opens —
// morph into each other: size, position and corner radius glide instead of
// one popping in. Mount exactly one of the pair at a time.
//
// Put inner content in `motion.div layout="position"` so text is not
// stretched while the surface resizes.
// ============================================

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'

export interface MorphSurfaceProps extends Omit<HTMLMotionProps<'div'>, 'layoutId' | 'transition'> {
  morphId: string
  duration?: number
  ease?: Bezier
}

export default function MorphSurface({
  morphId,
  duration = GLIDE.slow,
  ease = GLIDE_EASE,
  ...rest
}: MorphSurfaceProps) {
  const reduce = useReducedMotion()
  return <motion.div layoutId={morphId} transition={glide(reduce, duration, ease)} {...rest} />
}
