import { Card, Badge, EmptyState } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { Gauge } from 'lucide-react'

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
    <Card className="flex flex-col min-h-[260px] p-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Gauge className="w-5 h-5 text-brand-400 shrink-0" />
          Budget Burn-down
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Actual spend vs. an even daily pace, with a projected month-end outcome
        </p>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-24 w-full" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<Gauge className="w-8 h-8 text-zinc-500" />}
            title="No budgets to track"
            description="Set a monthly limit on the Budgets page to see a burn-down projection here."
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
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

              return (
                <div
                  key={item.category}
                  className={`rounded-xl border border-border-subtle/40 bg-surface-2/30 p-3.5 ${onCategoryClick ? 'cursor-pointer hover:opacity-75' : ''}`}
                  onClick={onCategoryClick ? () => onCategoryClick(item.category) : undefined}
                  role={onCategoryClick ? 'button' : undefined}
                  tabIndex={onCategoryClick ? 0 : undefined}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 truncate">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="truncate">{cat.label}</span>
                    </div>
                    <Badge variant={isOver ? 'danger' : pctUsed >= 70 ? 'warning' : 'success'}>
                      {isOver ? 'Over pace' : pctUsed >= 70 ? 'Watch' : 'On track'}
                    </Badge>
                  </div>

                  <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="w-full h-20"
                    preserveAspectRatio="none"
                  >
                    {/* Ideal even-pace line */}
                    <polyline
                      points={idealPoints}
                      fill="none"
                      stroke="var(--zinc-600)"
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

                  <div className="flex items-center justify-between text-xs mt-2">
                    <span className="text-zinc-400">
                      {formatCurrencyCompact(item.spentSoFar)}{' '}
                      <span className="text-zinc-600">of {formatCurrencyCompact(item.budgetAmount)}</span>
                    </span>
                    <span className="font-semibold text-zinc-300">{Math.round(pctUsed)}%</span>
                  </div>

                  {isOver && item.projectedOverDate && (
                    <p className="text-[11px] text-[var(--status-warning-text)] font-medium mt-1.5">
                      {item.isPastOvershoot ? 'Crossed' : 'At this pace, crosses'} the limit around {item.projectedOverDate} — projected{' '}
                      {formatCurrency(item.projectedOverBy)} over by month end.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

export default BudgetBurndown
