// ============================================
// Skeleton — placeholder shapes while content loads
//
// A spinner in the middle of an empty page says "wait" and nothing else. A
// skeleton says what is about to arrive and holds its space, so nothing jumps
// when it does. Product UI wants the second one.
//
// The shimmer lives in `.skeleton` in index.css and already honours
// prefers-reduced-motion there.
// ============================================

import { cn } from '@/utils'

interface SkeletonProps {
  /** Tailwind sizing for this shape, e.g. "h-4 w-32". */
  className?: string
  /** Pill for text lines, circle for avatars, xl for cards. */
  shape?: 'line' | 'circle' | 'block'
}

export default function Skeleton({ className, shape = 'line' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'skeleton',
        shape === 'circle' && 'rounded-full',
        shape === 'line' && 'rounded-md h-4',
        shape === 'block' && 'rounded-xl',
        className
      )}
    />
  )
}

/**
 * The shape of a page while its code chunk downloads: a title, a line of
 * description, and three cards. Deliberately generic — it stands in for any
 * route, and a skeleton that promised a specific layout would be wrong on
 * most of them.
 *
 * `role="status"` with a label is what a screen reader announces; the shapes
 * themselves are hidden from it.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="w-full max-w-5xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
      <Skeleton className="h-8 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} shape="block" className="h-32" />)}
      </div>
      <Skeleton shape="block" className="mt-4 h-56" />
    </div>
  )
}
