import { Card, Badge, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { Gauge, AlertTriangle, Eye, Check } from 'lucide-react'
import { NEUTRAL_MARK, CARD_TITLE, CARD_SUBTITLE } from './chartTokens'

export interface BudgetBurndownItem {
  category: string
  budgetAmount: number
  cumulative: number[]
  daysInMonth: number
  daysElapsed: number
  spentSoFar: number
  projectedTotal: number
  projectedOverBy: number
  projectedOverDate: string | null
  isPastOvershoot?: boolean
}

interface BudgetBurndownProps {
  data: BudgetBurndownItem[]
  loading: boolean
  onCategoryClick?: (category: string) => void
}

function buildPoints(values: number[], maxY: number, width: number, height: number, maxX: number) {
  return values
    .map((v, i) => {
      const x = maxX > 0 ? (i / maxX) * width : 0
      const y = maxY > 0 ? height - (v / maxY) * height : height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function BudgetBurndown({ data, loading, onCategoryClick }: BudgetBurndownProps) {
  const { getStyle } = useCategories()
  const WIDTH = 100
  const HEIGHT = 40

  return (
    <Card className="flex flex-col">
      <div>
        <h2 className={CARD_TITLE}>
          <Gauge className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          Are your budgets on pace?
        </h2>
        <p className={CARD_SUBTITLE}>
          Each line is what you have actually spent so far this month against an
          even daily pace, carried forward at your current rate.
        </p>
      </div>

      <div className="mt-6">
        {loading ? (
          <div role="status" aria-label="Loading budgets" className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border-subtle p-3.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton shape="block" className="h-20 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<Gauge className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="No budgets set"
            description="Set a monthly limit on the Budgets page and this shows whether you are ahead of it or behind it."
          />
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {data.map((item) => {
                const cat = getStyle(item.category)
                const maxY = Math.max(item.budgetAmount, item.projectedTotal, ...item.cumulative, 1)
                const actualPoints = buildPoints(
                  item.cumulative.slice(0, item.daysElapsed),
                  maxY,
                  WIDTH,
                  HEIGHT,
                  item.daysInMonth - 1
                )
                // Day 1 of the ideal line is one day's allowance, not zero. The
                // actual line's first point is day 1's spend (money already out),
                // so anchoring the ideal at zero offset the two by a day.
                const idealPoints = buildPoints(
                  [item.daysInMonth > 0 ? item.budgetAmount / item.daysInMonth : 0, item.budgetAmount],
                  maxY,
                  WIDTH,
                  HEIGHT,
                  1
                )
                const lastActualX = item.daysInMonth > 1 ? ((item.daysElapsed - 1) / (item.daysInMonth - 1)) * WIDTH : 0
                const lastActualY = HEIGHT - (item.spentSoFar / maxY) * HEIGHT
                const projectedEndY = HEIGHT - (item.projectedTotal / maxY) * HEIGHT

                const isOver = item.projectedOverBy > 0
                const pctUsed = item.budgetAmount > 0 ? (item.spentSoFar / item.budgetAmount) * 100 : 0
                // Status is a word and an icon first; the badge colour only
                // repeats what they already say.
                const status = isOver
                  ? { variant: 'danger' as const, label: 'Over pace', Icon: AlertTriangle }
                  : pctUsed >= 70
                    ? { variant: 'warning' as const, label: 'Watch', Icon: Eye }
                    : { variant: 'success' as const, label: 'On track', Icon: Check }

                const body = (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-100">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="truncate">{cat.label}</span>
                      </span>
                      <Badge variant={status.variant} className="shrink-0 gap-1">
                        <status.Icon className="h-3 w-3" aria-hidden="true" />
                        {status.label}
                      </Badge>
                    </div>

                    <svg
                      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                      className="h-20 w-full"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {/* Ideal even-pace line. This used to be stroked in
                          `var(--zinc-600)`, which the light theme resolves to
                          #dde1e8 — the reference line was invisible against the
                          card, so the actual line had nothing to be read
                          against. */}
                      <polyline
                        points={idealPoints}
                        fill="none"
                        stroke={NEUTRAL_MARK}
                        strokeWidth="1"
                        strokeDasharray="3,2"
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Actual cumulative spend so far */}
                      <polyline
                        points={actualPoints}
                        fill="none"
                        stroke={cat.color}
                        strokeWidth="1.75"
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Projected trajectory to month end */}
                      {item.daysElapsed < item.daysInMonth && (
                        <line
                          x1={lastActualX}
                          y1={lastActualY}
                          x2={WIDTH}
                          y2={projectedEndY}
                          stroke={cat.color}
                          strokeWidth="1.25"
                          strokeDasharray="2,2"
                          opacity="0.6"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </svg>

                    <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-zinc-300 tnum">
                        {formatCurrencyCompact(item.spentSoFar)}
                        <span className="text-zinc-400"> of {formatCurrencyCompact(item.budgetAmount)}</span>
                      </span>
                      <span className="font-semibold text-zinc-50 tnum">{Math.round(pctUsed)}%</span>
                    </div>

                    {isOver && item.projectedOverDate && (
                      <p className="mt-1.5 text-xs font-medium text-[var(--status-warning-text)]">
                        {item.isPastOvershoot ? 'Crossed' : 'At this pace, crosses'} the limit around{' '}
                        {item.projectedOverDate} — about {formatCurrency(item.projectedOverBy)} over by month end.
                      </p>
                    )}
                  </>
                )

                return (
                  <li key={item.category}>
                    {onCategoryClick ? (
                      <button
                        type="button"
                        onClick={() => onCategoryClick(item.category)}
                        aria-label={`${cat.label}: ${formatCurrency(item.spentSoFar)} of ${formatCurrency(item.budgetAmount)} spent, ${status.label}. Open its transactions.`}
                        className="w-full rounded-xl border border-border-subtle bg-surface-2/40 p-3.5 text-left transition-colors hover:border-border-hover hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="rounded-xl border border-border-subtle bg-surface-2/40 p-3.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>

            <p className="mt-4 text-xs text-zinc-400">
              Dashed grey is an even daily pace; the solid line is what you have
              actually spent, and the faded dashes ahead of it are where that
              pace lands by month end.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

export default BudgetBurndown
