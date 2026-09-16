// ============================================
// MorphSurface
//
// Two elements sharing a `morphId` — the Add button and the form it opens —
// morph into each other: size, position and corner radius glide instead of
// one popping in. Mount exactly one of the pair at a time.
//
// Put inner content in `motion.div layout="position"` so text is not
// stretched while the surface resizes.
//
// It renders a plain div. For an interactive surface (the collapsed Add
// button) put a real `<button type="button">` inside it rather than giving
// the div `role="button"`/`tabIndex` — a div gets no Enter/Space activation.
//
// `morphId`-derived props (`layoutId`, `transition`) are spread after `...rest`
// so a caller cannot override them by passing its own `layoutId`/`transition` —
// the type already excludes those keys from `rest`, this is belt and suspenders
// against anyone widening the props type later. Corner radius only glides as
// part of the morph when it is set via `style` (an inline `borderRadius`); a
// Tailwind rounded-* class is not tracked by layout animation and will snap.
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
  return <motion.div {...rest} layoutId={morphId} transition={glide(reduce, duration, ease)} />
}
