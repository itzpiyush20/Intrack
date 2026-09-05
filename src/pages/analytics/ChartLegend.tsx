// ============================================
// ChartLegend — the key that makes a colour mean something
//
// Every coloured mark on the Insights page has to be readable by someone who
// cannot tell the colours apart, so every chart that uses more than one colour
// renders this underneath it: swatch plus the word, never a swatch alone.
//
// It is a `<ul>` because that is what it is — and because a `<p>` inside a
// `<ul>` was one of the accessibility defects on this page before.
// ============================================

import { cn } from '@/utils'

export interface ChartLegendItem {
  /** CSS colour of the swatch. */
  color: string
  /** The word. Required — a swatch with no label is the failure this exists to prevent. */
  label: string
}

interface ChartLegendProps {
  items: ChartLegendItem[]
  className?: string
}

export function ChartLegend({ items, className }: ChartLegendProps) {
  if (items.length === 0) return null
  return (
    <ul className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-2', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

export default ChartLegend
