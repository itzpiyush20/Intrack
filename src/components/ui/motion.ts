// ============================================
// Motion vocabulary
//
// One set of durations and curves for the whole app, so every screen moves
// the same way.
//
// Direction (owner, 2026-09-16 — docs/superpowers/specs/2026-09-16-app-motion-design.md):
// subtle, smooth glide, no bounce, fitted to what each screen is for, and
// never slower. Animate transform and opacity; no blur or filters.
//
// The `GLIDE*` tokens below are the new system. The older exports further
// down are still used by existing screens and are migrated to glide one
// rollout round at a time — do not add new uses of them.
//
// Every consumer passes `useReducedMotion()` in, so a visitor who asked for
// less motion gets none.
// ============================================

import type { Transition, Variants } from 'framer-motion'

/** A cubic-bezier as framer-motion accepts it. */
export type Bezier = readonly [number, number, number, number]

/**
 * The owner-approved curve: quick start, long soft settle, no overshoot.
 * Chosen from clickable demos on 2026-09-16 after a springy version was
 * rejected as too bouncy. Keep both y values at or below 1.
 */
export const GLIDE_EASE: Bezier = [0.22, 1, 0.36, 1]

/**
 * Seconds. `fast` and `base` are feedback the user may be waiting on;
 * `slow` is a surface moving (a card leaving, a form opening); `figure` is a
 * number or chart arriving, which needs long enough to be seen.
 */
export const GLIDE = { fast: 0.2, base: 0.3, slow: 0.5, figure: 0.8 } as const

/** Scale a pressed button or tappable card sinks to. */
export const PRESS_SCALE = 0.97

/** Glide transition, collapsed to nothing when reduced motion is requested. */
export const glide = (
  reduce: boolean | null,
  duration: number = GLIDE.base,
  ease: Bezier = GLIDE_EASE,
): Transition => (reduce ? { duration: 0 } : { duration, ease })

/**
 * Exponential ease-out. Fast to start, settling at the end — the curve that
 * reads as responsive rather than as animation. No bounce, no elastic.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/**
 * 180ms for anything the user is waiting on; 240ms for larger surfaces.
 *
 * `data` is the outlier and deliberately so: a figure counting up or a bar
 * growing is not interface feedback the user is blocked on, it is the value
 * itself being reported, and it needs long enough to be read as arriving.
 */
export const DURATION = { fast: 0.14, base: 0.18, slow: 0.24, data: 0.65 } as const

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
