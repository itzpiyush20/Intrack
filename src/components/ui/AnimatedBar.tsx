// ============================================
// AnimatedBar
//
// The filled part of a bar or column, grown from nothing to its share.
//
// Every bar on Home and Insights used to be a `transition-[width]` div, which
// animates a *change* and therefore never animates on arrival — the chart was
// simply there, fully drawn, the instant the data resolved. This grows the bar
// on mount and on every subsequent value, so a chart reads as being drawn from
// the numbers rather than pasted in.
//
// Always a `<span>`: several callers place it inside a `<span
// role="progressbar">`, where a `<div>` would be invalid HTML.
// ============================================

import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE_OUT } from './motion'

export interface AnimatedBarProps {
  /** 0–100. Clamped, so a caller may pass a raw percentage. */
  percent: number
  /** `horizontal` grows the width, `vertical` grows the height. */
  orientation?: 'horizontal' | 'vertical'
  className?: string
  style?: React.CSSProperties
  /** Seconds. Defaults to the shared data-motion duration. */
  duration?: number
  /** Seconds of head start, for columns that should sweep left to right. */
  delay?: number
}

export default function AnimatedBar({
  percent,
  orientation = 'horizontal',
  className,
  style,
  duration = DURATION.data,
  delay = 0,
}: AnimatedBarProps) {
  const reduce = useReducedMotion()
  const clamped = `${Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))}%`

  // Width and height rather than a transform: these bars have rounded caps,
  // and scaling a rounded rectangle stretches the corners visibly.
  const target = orientation === 'horizontal' ? { width: clamped } : { height: clamped }
  const empty = orientation === 'horizontal' ? { width: '0%' } : { height: '0%' }

  return (
    <motion.span
      aria-hidden="true"
      className={className}
      style={style}
      initial={reduce ? target : empty}
      animate={target}
      transition={reduce ? { duration: 0 } : { duration, delay, ease: EASE_OUT }}
    />
  )
}
