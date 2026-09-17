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
// One card, one action. `onSwipeRight`/`onSwipeLeft` decide money, so the
// drag and the card's own buttons share a single guard. `children` is a
// render prop handed `swipeRight`, `swipeLeft` and `leaving`: buttons call
// `swipeRight`/`swipeLeft` (which glide the card off exactly as a swipe does)
// and should be disabled while `leaving`. Whichever path gets there first
// latches the `createSwipeGuard` (swipe.ts); every later attempt — a second
// release, a tap after a swipe, a swipe after a tap — is a no-op. Dragging is
// also switched off while leaving.
//
// The callback runs the moment the outcome is decided (drag release or tap),
// at the same time as the exit glide — not after it — so navigating away
// mid-glide cannot lose the action, and the parent may remove the card at
// once. SwipeCard owns the sideways exit; a parent AnimatePresence should only
// collapse the gap the card leaves, not slide it again.
//
// `onSwipeRight`/`onSwipeLeft` may return `false` (or a promise that resolves
// to `false`, or throw/reject) to signal the action failed — the card glides
// back to centre (x: 0, opacity: 1) and the guard resets so it can act again.
// Returning `void`/`true` (or resolving to it) is success and the card stays
// gone.
//
// If the parent brings a card back under the same key while its
// AnimatePresence exit is still running, framer reuses this instance; the
// `useIsPresent` effect resets it so it does not come back stuck invisible.
//
// `swipeEnabled={false}` turns the drag off while keeping the buttons' glide
// and guard — for pointers where dragging a card would fight text selection.
// Drag never starts from interactive content inside the card — a field,
// select, button, link, label, a listbox or its options (the merchant
// picker's suggestions), contenteditable, or anything marked `data-no-swipe`
// (`shouldStartSwipe`, swipe.ts). Framer's own listener only skipped text
// fields and selects, so a press on a suggestion that drifted sideways could
// approve or reject the transaction. The drag is started by hand from
// `onPointerDown` for that reason (`dragListener={false}`).
// ============================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useAnimationControls, useDragControls, useIsPresent, useReducedMotion, type PanInfo } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { createSwipeGuard, shouldStartSwipe, swipeOutcome } from './swipe'

/** `false` (or a promise resolving to it) means the action failed and the card should return. */
export type SwipeResult = void | boolean

export interface SwipeCardActions {
  /** Take the right-hand action (approve) and glide the card off to the right. No-op while leaving. */
  swipeRight: () => void
  /** Take the left-hand action (reject) and glide the card off to the left. No-op while leaving. */
  swipeLeft: () => void
  /** True from the moment an action is taken until it fails or the card is brought back. */
  leaving: boolean
}

export interface SwipeCardProps {
  children: (actions: SwipeCardActions) => ReactNode
  onSwipeRight: () => SwipeResult | Promise<SwipeResult>
  onSwipeLeft: () => SwipeResult | Promise<SwipeResult>
  className?: string
  /** Seconds for the card to leave. */
  duration?: number
  ease?: Bezier
  /** Allow dragging the card. Buttons keep working either way. Default true. */
  swipeEnabled?: boolean
}

/** Used when the card has no measured width yet (e.g. jsdom). */
const FALLBACK_WIDTH = 320

export default function SwipeCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  className,
  duration = GLIDE.slow,
  ease = GLIDE_EASE,
  swipeEnabled = true,
}: SwipeCardProps) {
  const reduce = useReducedMotion()
  const isPresent = useIsPresent()
  // Held in state rather than refs: the render prop hands closures over
  // these to children, and the React Compiler lint treats ref reads inside
  // them as reads during render. The guard object itself never changes.
  const [card, setCard] = useState<HTMLDivElement | null>(null)
  const [guard] = useState(createSwipeGuard)
  const controls = useAnimationControls()
  const dragControls = useDragControls()
  const [leaving, setLeaving] = useState(false)

  function returnToCentre() {
    guard.reset()
    setLeaving(false)
    void controls.start({ x: 0, opacity: 1, transition: glide(reduce, GLIDE.base, ease) })
  }

  function act(direction: 'right' | 'left') {
    if (!guard.beginLeaving()) return
    const attempt = guard.attempt()
    setLeaving(true)

    const sign = direction === 'right' ? 1 : -1
    const width = card?.offsetWidth || FALLBACK_WIDTH
    void controls.start({ x: sign * width * 1.1, opacity: 0, transition: glide(reduce, duration, ease) })

    const failed = (error?: unknown) => {
      if (attempt !== guard.attempt()) return
      if (error !== undefined) {
        // A rejected action is treated the same as `false`: the card returns
        // rather than vanishing on a transaction that was never approved. The
        // error itself is the caller's to handle (e.g. a toast); this only
        // owns the card's own animation state, so it is logged, not thrown.
        console.error('SwipeCard action failed', error)
      }
      returnToCentre()
    }

    const callback = direction === 'right' ? onSwipeRight : onSwipeLeft
    let result: SwipeResult | Promise<SwipeResult>
    try {
      result = callback()
    } catch (error) {
      failed(error ?? new Error('SwipeCard action threw'))
      return
    }
    if (result === false) {
      failed()
      return
    }
    if (result && typeof (result as Promise<SwipeResult>).then === 'function') {
      ;(result as Promise<SwipeResult>).then(
        (value) => {
          if (value === false) failed()
        },
        (error: unknown) => failed(error ?? new Error('SwipeCard action rejected')),
      )
    }
  }

  // Brought back under the same key mid-exit: framer reuses this instance,
  // which would otherwise stay off-screen at opacity 0 with the guard latched.
  // Only a false → true presence flip resets; a re-run for any other
  // dependency (a new curve, say) must not pull back a card that left.
  const wasPresentRef = useRef(isPresent)
  useEffect(() => {
    const cameBack = isPresent && !wasPresentRef.current
    wasPresentRef.current = isPresent
    if (!cameBack || !guard.isLeaving()) return
    guard.reset()
    setLeaving(false)
    void controls.start({ x: 0, opacity: 1, transition: glide(reduce, GLIDE.base, ease) })
  }, [isPresent, guard, controls, reduce, ease])

  function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (guard.isLeaving()) return
    const width = card?.offsetWidth || FALLBACK_WIDTH
    const outcome = swipeOutcome(info.offset.x, info.velocity.x, width)
    if (outcome === 'return') {
      void controls.start({ x: 0, transition: glide(reduce, GLIDE.base, ease) })
      return
    }
    act(outcome)
  }

  const canDrag = !leaving && swipeEnabled

  return (
    <motion.div
      ref={setCard}
      drag={canDrag ? 'x' : false}
      dragControls={dragControls}
      dragListener={false}
      onPointerDown={(event) => {
        if (canDrag && shouldStartSwipe(event.target)) dragControls.start(event)
      }}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      dragMomentum={false}
      animate={controls}
      onDragEnd={handleDragEnd}
      className={cn('touch-pan-y', className)}
    >
      {children({ swipeRight: () => act('right'), swipeLeft: () => act('left'), leaving })}
    </motion.div>
  )
}
