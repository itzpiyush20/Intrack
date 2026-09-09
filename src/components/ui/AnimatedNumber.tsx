// ============================================
// AnimatedNumber
//
// A figure that counts up to its value instead of appearing at it.
//
// This is motion in the sense motion.ts allows: it reports that a number
// arrived, and it re-runs when the number changes, so switching the period on
// Home or Insights is visibly a recalculation rather than a silent swap. It
// does not drift, glow or loop.
//
// The text is written straight to the DOM node rather than through state, so a
// sixty-frame count-up does not cause sixty React renders of the card around
// it. `prefers-reduced-motion` gets the final value and no animation at all.
// ============================================

import { useLayoutEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'framer-motion'
import { DURATION, EASE_OUT } from './motion'

export interface AnimatedNumberProps {
  /** The figure to land on. Changing it re-runs the count from the old value. */
  value: number
  /** How the figure is rendered at every frame — usually `formatCurrency`. */
  format: (value: number) => string
  className?: string
  style?: React.CSSProperties
  /** Tooltip text; the caller owns it because the full value may be truncated. */
  title?: string
  /** Seconds. Defaults to the shared data-motion duration. */
  duration?: number
}

export default function AnimatedNumber({
  value,
  format,
  className,
  style,
  title,
  duration = DURATION.data,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)

  // Where the next count starts. Zero on first paint; afterwards, whatever the
  // previous value was, so a period change animates between two real figures.
  const from = useRef(0)

  // `format` is nearly always an inline arrow, so it must not be an effect
  // dependency — it would restart the count on every parent render.
  const formatRef = useRef(format)
  formatRef.current = format

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    if (reduce) {
      from.current = value
      node.textContent = formatRef.current(value)
      return
    }

    const start = from.current
    from.current = value

    if (start === value) {
      node.textContent = formatRef.current(value)
      return
    }

    node.textContent = formatRef.current(start)
    const controls = animate(start, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (frame) => {
        node.textContent = formatRef.current(frame)
      },
      // Land exactly on the value; the last frame of an eased tween is close
      // to it, not equal to it, and a rupee figure that is off by one is wrong.
      onComplete: () => {
        node.textContent = formatRef.current(value)
      },
    })

    return () => controls.stop()
  }, [value, reduce, duration])

  // Rendered with the true value so the first commit — and any environment
  // that never runs the effect — shows the real figure rather than zero.
  return (
    <span ref={ref} className={className} style={style} title={title}>
      {format(value)}
    </span>
  )
}
