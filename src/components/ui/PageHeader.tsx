// ============================================
// PageHeader — the single title block for an app page
//
// One presentation for every page: an optional status chip, the page
// title, a one-line explanation, and the page's controls on the right.
// The title is also the hand-off point for the sticky top bar: while
// this <h1> is on screen the top bar shows no title, and once it
// scrolls away the top bar fades its own compact title in. The page
// name is therefore never on screen twice.
// ============================================

import { useRef, type ReactNode } from 'react'
import { cn } from '@/utils'
import { usePageHeroHandoff } from '@/layouts/PageHeaderContext'

interface PageHeaderProps {
  /** The page name. Keep it short — it is reused in the sticky top bar. */
  title: ReactNode
  /**
   * What the sticky top bar should say when this heading scrolls away.
   * Defaults to `title` when that is plain text; needed when the heading is
   * personal or composed ("Hello, Priya" → "Home").
   */
  stickyTitle?: string
  /** One line on what the page is for. */
  subtitle?: ReactNode
  /** Status chip above the title, e.g. "Bank Alert Engine Active". */
  eyebrow?: ReactNode
  /** Extra inline detail beside the subtitle, e.g. a streak count. */
  aside?: ReactNode
  /** Page-level controls: date pickers, primary buttons. */
  actions?: ReactNode
  className?: string
}

export default function PageHeader({
  title,
  stickyTitle,
  subtitle,
  eyebrow,
  aside,
  actions,
  className,
}: PageHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  usePageHeroHandoff(titleRef, stickyTitle ?? (typeof title === 'string' ? title : undefined))

  return (
    <header
      className={cn(
        'flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 flex flex-wrap items-center gap-2.5">{eyebrow}</div>}
        <h1
          ref={titleRef}
          className="text-2xl font-extrabold tracking-tight text-sb-ink md:text-3xl"
        >
          {title}
        </h1>
        {(subtitle || aside) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            {subtitle && (
              <p className="max-w-2xl text-sm font-medium leading-relaxed text-sb-ink-secondary">
                {subtitle}
              </p>
            )}
            {aside}
          </div>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}

/** The standard status chip used as a PageHeader eyebrow. */
export function PageHeaderChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wider uppercase bg-brand-50 border border-brand-200/70 text-brand-700 shadow-xs">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
      {children}
    </span>
  )
}
