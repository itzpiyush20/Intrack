// ============================================
// ScrollHint — shows that a horizontal strip has more content off-screen.
//
// A row of nav links or tabs that overflows just ends at the edge, with no
// sign anything was cut off. This fades the overflowing edge and puts a chevron
// there, so the row reads as scrollable rather than complete.
//
// The indicators appear only when there is genuinely more to see, and only on
// the side that has it.
//
// Note on the measurement: state is set from the ref callback and from scroll
// and resize handlers, never synchronously inside an effect body. Doing it in
// an effect would trip react-hooks/set-state-in-effect and cause a cascading
// render on every layout pass.
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils'
import type { ReactNode } from 'react'

interface ScrollHintProps {
  children: ReactNode
  /** Classes for the outer wrapper — put visibility utilities like `hidden lg:block` here. */
  wrapperClassName?: string
  /** Classes for the scrolling strip itself — layout, gap, font. */
  className?: string
  /** Rendered as a <nav> when given, so landmarks survive. */
  ariaLabel?: string
}

// A few pixels of slack: sub-pixel layout means scrollLeft rarely hits exactly 0
// or exactly the maximum, and a chevron that never goes away is worse than none.
const EDGE_SLACK = 4

const SCROLL_STEP = 160

export default function ScrollHint({ children, wrapperClassName, className, ariaLabel }: ScrollHintProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const left = el.scrollLeft > EDGE_SLACK
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  const attach = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    measure(el)
  }, [measure])

  useEffect(() => {
    const onResize = () => measure(scrollerRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  const nudge = (direction: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }

  // Fading the content itself, rather than laying a coloured gradient over it,
  // means this works on any background — light nav, dark nav, admin tabs.
  const mask =
    edges.left && edges.right
      ? 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)'
      : edges.left
        ? 'linear-gradient(to right, transparent, black 24px)'
        : edges.right
          ? 'linear-gradient(to right, black calc(100% - 24px), transparent)'
          : undefined

  const Scroller = (
    <div
      ref={attach}
      onScroll={(e) => measure(e.currentTarget)}
      className={cn('overflow-x-auto scrollbar-none', className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  )

  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      {ariaLabel ? <nav aria-label={ariaLabel}>{Scroller}</nav> : Scroller}

      {edges.left && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Scroll left for more"
          className="absolute left-0 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-sb-ink-muted hover:text-sb-ink transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {edges.right && (
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Scroll right for more"
          className="absolute right-0 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-sb-ink-muted hover:text-sb-ink transition-colors cursor-pointer"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
