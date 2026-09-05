// ============================================
// Motion vocabulary
//
// One set of durations, curves and variants for the whole app, so a list on
// Expenses and a list on Pending move the same way. Written down because six
// screens restyled separately is six dialects otherwise.
//
// The rule this encodes, from PRODUCT.md: motion reports that something
// changed. A row arrived, a panel replaced another, a value updated. Nothing
// here decorates, drifts, glows or bounces — that was the Glassmorphic Aurora
// era and it was rejected.
//
// Every consumer pairs these with `useReducedMotion()` from framer-motion and
// passes `reduce` in, so a visitor who asked for less motion gets none.
// ============================================

import type { Transition, Variants } from 'framer-motion'

/**
 * Exponential ease-out. Fast to start, settling at the end — the curve that
 * reads as responsive rather than as animation. No bounce, no elastic.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** 180ms for anything the user is waiting on; 240ms for larger surfaces. */
export const DURATION = { fast: 0.14, base: 0.18, slow: 0.24 } as const

/** The spring a travelling indicator uses (an active tab marker, a toggle). */
export const INDICATOR_SPRING: Transition = { type: 'spring', stiffness: 420, damping: 36 }

/** Base transition, collapsed to nothing when reduced motion is requested. */
export const transition = (reduce: boolean | null, duration: number = DURATION.base): Transition =>
  reduce ? { duration: 0 } : { duration, ease: EASE_OUT }

/**
 * A panel replacing another — a tab body, a step in a flow, a route.
 * Rises 6px, which is enough to read as "this is new" and not enough to
 * feel like choreography.
 */
export const panelVariants = (reduce: boolean | null): Variants => ({
  initial: reduce ? { opacity: 1 } : { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: reduce ? { opacity: 1 } : { opacity: 0, y: -6 },
})

/**
 * A row entering or leaving a list. Leaves sideways so a deletion reads as
 * removal rather than as a fade-out that could be a loading state.
 */
export const rowVariants = (reduce: boolean | null): Variants => ({
  initial: reduce ? { opacity: 1 } : { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: reduce ? { opacity: 0 } : { opacity: 0, x: -8 },
})

/**
 * First paint of a list or a section of cards: each child a beat behind the
 * one before. Capped at 0.24s total no matter how many children — a stagger a
 * user waits through is a stagger that has stopped being feedback.
 */
export const staggerParent = (reduce: boolean | null, count = 6): Variants => ({
  initial: {},
  animate: {
    transition: reduce ? { staggerChildren: 0 } : { staggerChildren: Math.min(0.24 / Math.max(count, 1), 0.04) },
  },
})

/** What a staggered child does. Pair with `staggerParent` on the container. */
export const staggerChild = (reduce: boolean | null): Variants => ({
  initial: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { duration: DURATION.slow, ease: EASE_OUT } },
})
