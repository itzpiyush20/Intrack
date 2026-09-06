import { formatCurrency, cn } from '@/utils'
import { Badge, ACTION_BUTTON_DANGER, transition, rowVariants } from '@/components/ui'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Trash2,
  TrendingDown,
  Sparkles,
} from 'lucide-react'

export interface BudgetCardProps {
  budget: {
    id: string
    category: string
    amount: number
    month?: string
    monthCount?: number
    rows?: Array<{ id: string; month: string }>
  }
  categoryStyle: {
    label: string
    emoji: string
    color: string
  }
  spent: number
  rolloverSurplus?: number
  isCurrentMonth: boolean
  daysElapsed: number
  actionLoading?: boolean
  onDelete?: () => void
  reduceMotion?: boolean
}

export default function BudgetCard({
  budget,
  categoryStyle,
  spent,
  rolloverSurplus,
  isCurrentMonth,
  daysElapsed,
  actionLoading = false,
  onDelete,
  reduceMotion = false,
}: BudgetCardProps) {
  const remaining = budget.amount - spent
  const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
  const monthCount = budget.monthCount ?? 1

  const barColor =
    pct >= 100
      ? 'var(--status-danger-text)'
      : pct >= 70
      ? 'var(--status-warning-text)'
      : 'var(--brand-500)'

  // Projected pace
  const daysInMonth = 30
  const projected = daysElapsed > 0 ? (spent / daysElapsed) * daysInMonth : spent
  const projectedOver = projected - budget.amount
  const showPace = isCurrentMonth && daysElapsed >= 4 && pct < 100 && projectedOver > 0

  return (
    <motion.li
      layout={!reduceMotion}
      variants={rowVariants(reduceMotion)}
      exit="exit"
      transition={transition(reduceMotion)}
      className="space-y-3 py-4 first:pt-0 last:pb-0"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg shadow-xs"
            style={{ backgroundColor: `${categoryStyle.color}15` }}
          >
            {categoryStyle.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-sm font-bold text-sb-ink">
                {categoryStyle.label}
              </h3>
              {pct >= 100 ? (
                <Badge variant="danger">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Over limit
                </Badge>
              ) : pct >= 70 ? (
                <Badge variant="warning">
                  <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Close
                </Badge>
              ) : (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                  On track
                </Badge>
              )}

              {rolloverSurplus && rolloverSurplus > 0 ? (
                <span
                  title={`${formatCurrency(rolloverSurplus)} unspent budget rolled over from last month`}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shadow-xs tnum"
                >
                  <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>{formatCurrency(rolloverSurplus)} rolled over from last month</span>
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs font-medium text-sb-ink-muted">
              Limit <span className="tnum font-bold text-sb-ink-secondary">{formatCurrency(budget.amount)}</span>
              {monthCount > 1 && <span> · across {monthCount} months</span>}
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 sm:justify-end">
          <div className="min-w-0 sm:w-40 sm:text-right">
            <p className="tnum text-sm font-bold text-sb-ink">
              {formatCurrency(spent)}{' '}
              <span className="text-xs font-normal text-sb-ink-muted">spent</span>
            </p>
            <p
              className={cn(
                'tnum mt-0.5 text-xs font-bold',
                remaining >= 0
                  ? 'text-[var(--status-positive-text)]'
                  : 'text-[var(--status-danger-text)]'
              )}
            >
              {remaining >= 0
                ? `${formatCurrency(remaining)} left`
                : `${formatCurrency(Math.abs(remaining))} over`}
            </p>
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={actionLoading}
              aria-label={`Remove the ${categoryStyle.label} limit`}
              title={
                monthCount > 1
                  ? `Remove this limit across ${monthCount} months`
                  : 'Remove this limit'
              }
              className={cn(
                ACTION_BUTTON_DANGER,
                'h-11 w-11 shrink-0 sm:h-9 sm:w-9 disabled:opacity-50'
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, pct))}
        aria-label={`${categoryStyle.label}: ${Math.round(pct)}% of the limit spent`}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2 shadow-inner"
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
        />
      </div>

      {pct > 100 && (
        <p className="tnum text-right text-xs font-bold text-[var(--status-danger-text)]">
          {Math.round(pct - 100)}% past the limit
        </p>
      )}

      {showPace && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--status-warning-text)]">
          <TrendingDown className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
          <span>
            At this pace it ends the month{' '}
            <span className="tnum font-bold">{formatCurrency(projectedOver)}</span> over.
          </span>
        </p>
      )}
    </motion.li>
  )
}
