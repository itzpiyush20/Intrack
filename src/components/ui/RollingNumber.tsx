// ============================================
// RollingNumber
//
// A money figure whose digits roll into place, each in its own slot, like a
// mechanical counter. When the value changes only the digits that differ
// move — ₹42,350 → ₹42,850 rolls one digit, not five.
//
// Screen readers get the exact formatted figure once, from a visually hidden
// span; the rolling slots are aria-hidden. Under reduced motion it is plain
// text. Slots are keyed from the right (see rollingDigits.ts) so a figure
// gaining a digit does not remount the ones that stayed.
// ============================================

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { splitForRolling } from './rollingDigits'

/** Height of one digit row, in em. Slightly above 1 so descenders are not clipped. */
const ROW = 1.15
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export interface RollingNumberProps {
  value: number
  /** Usually `formatCurrency`. The output is what is shown, digit for digit. */
  format: (value: number) => string
  className?: string
  style?: React.CSSProperties
  title?: string
  /** Seconds. Defaults to the figure duration. */
  duration?: number
  /** Curve override, used by the motion lab. */
  ease?: Bezier
  /** Roll up from 0 on first paint. Default true. */
  rollOnMount?: boolean
}

export default function RollingNumber({
  value,
  format,
  className,
  style,
  title,
  duration = GLIDE.figure,
  ease = GLIDE_EASE,
  rollOnMount = true,
}: RollingNumberProps) {
  const reduce = useReducedMotion()
  const text = format(value)

  if (reduce) {
    return (
      <span className={cn('tabular-nums', className)} style={style} title={title}>
        {text}
      </span>
    )
  }

  return (
    <span className={cn('relative inline-flex tabular-nums', className)} style={style} title={title}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        {splitForRolling(text).map((token) =>
          token.digit === null ? (
            <span key={token.key} style={{ lineHeight: `${ROW}em` }}>
              {token.char}
            </span>
          ) : (
            <span
              key={token.key}
              data-roll-slot=""
              className="relative inline-block overflow-hidden"
              style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}
            >
              <motion.span
                className="block"
                initial={rollOnMount ? { y: '0em' } : false}
                animate={{ y: `${-token.digit * ROW}em` }}
                transition={glide(reduce, duration, ease)}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block" style={{ height: `${ROW}em` }}>
                    {d}
                  </span>
                ))}
              </motion.span>
            </span>
          ),
        )}
      </span>
    </span>
  )
}
