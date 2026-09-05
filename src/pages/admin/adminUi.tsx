// ============================================
// adminUi — small shared pieces for the admin tabs.
//
// Six tabs were each retyping the same stat tile, the same error-with-retry
// block, and the same raw Tailwind status colours (red-400, emerald-400,
// amber-400) instead of the app's semantic status tokens. One definition here
// stops that drift, the same way ACTION_BUTTON and ROW_TILE do for the rest
// of the app. Local to admin/ because these shapes (a dense stat tile, an
// RPC-error-with-retry block) are specific to this screen; if another screen
// needs them later they can move to components/ui.
// ============================================

import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/utils'

/** A dense metric tile: label, big tabular-figure value, optional hint. */
export function StatCard({ label, value, hint, emphasis }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-bold tnum tracking-tight', emphasis ? 'text-brand-500' : 'text-zinc-100')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  )
}

/** An RPC came back with an error. Says so, and offers the one way out. */
export function AdminError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-4">
      <p className="flex items-start gap-2 text-sm text-[var(--status-danger-text)]">
        <XCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{message}</span>
      </p>
      <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  )
}

type PillTone = 'positive' | 'danger' | 'warning' | 'neutral'

const PILL_TONE: Record<PillTone, string> = {
  positive: 'bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)] border-[var(--status-positive-border)]',
  danger: 'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]',
  warning: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]',
  neutral: 'bg-surface-2 text-zinc-400 border-border-default',
}

const PILL_ICON: Record<PillTone, ReactNode> = {
  positive: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  danger: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  neutral: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
}

/** Status shown as an icon plus a word — never colour alone. */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap', PILL_TONE[tone])}>
      {PILL_ICON[tone]}
      {children}
    </span>
  )
}

/** Loading placeholder for a grid of stat tiles — holds the layout so nothing jumps. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton mt-3 h-7 w-14 rounded" />
        </Card>
      ))}
    </div>
  )
}

/** Loading placeholder for a data table: header stays, rows shimmer. */
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton h-4 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Two-line loading placeholder for feed-style lists (feedback, tickets). */
export function FeedCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="skeleton h-4 w-40 rounded" />
      <div className="skeleton mt-2 h-3 w-64 max-w-full rounded" />
      <div className="skeleton mt-4 h-3 w-full rounded" />
      <div className="skeleton mt-1.5 h-3 w-3/4 rounded" />
    </Card>
  )
}

export const TABLE_WRAP = 'overflow-x-auto'
export const TABLE = 'w-full text-left text-sm'
export const TABLE_HEAD = 'border-b border-border-subtle text-xs uppercase tracking-wider text-zinc-500'
export const TABLE_HEAD_CELL = 'px-4 py-3 font-medium'
export const TABLE_HEAD_CELL_NUM = 'px-4 py-3 font-medium text-right'
export const TABLE_ROW = 'border-b border-border-subtle/50 transition-colors hover:bg-surface-2/40'
export const TABLE_CELL = 'px-4 py-3 text-zinc-300'
export const TABLE_CELL_NUM = 'px-4 py-3 text-right text-zinc-300 tnum'
export const TABLE_CELL_STRONG = 'px-4 py-3 text-zinc-100 font-medium'

/** Prev/Next pager shared by every paginated admin table. */
export function Pager({ page, pages, total, noun, onPrev, onNext }: {
  page: number; pages: number; total: number; noun: string; onPrev: () => void; onNext: () => void
}) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-zinc-400">
      <Button size="sm" variant="ghost" disabled={page === 0} onClick={onPrev}>Previous</Button>
      <span className="tnum text-xs">
        Page {page + 1} of {pages} · {total} {noun}
      </span>
      <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={onNext}>Next</Button>
    </div>
  )
}
