import { Card, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { PieChart } from 'lucide-react'
import { NEUTRAL_MARK, CARD_TITLE, CARD_SUBTITLE } from './chartTokens'

interface CategoryBreakdownItem {
  category: string
  amount: number
  count: number
  percentage: number
}

interface SummaryData {
  total_income: number
  total_expenses: number
  savings: number
  category_breakdown: CategoryBreakdownItem[]
}

interface ExpenseBreakdownProps {
  summary: SummaryData | null
  loading: boolean
  /** Called when a legend row is clicked, with the category name. Omit to render the chart non-interactively (e.g. while data is loading). */
  onCategoryClick?: (category: string) => void
}

/** Rows shown individually; the rest roll into one "more categories" line. */
const VISIBLE_ROWS = 5

export function ExpenseBreakdown({
  summary,
  loading,
  onCategoryClick,
}: ExpenseBreakdownProps) {
  const { getStyle } = useCategories()
  // Conic Gradient for doughnut
  const getConicGradientString = () => {
    if (!summary || summary.category_breakdown.length === 0) {
      return 'conic-gradient(var(--surface-3) 0% 100%)'
    }
    let currentAngle = 0
    const slices = summary.category_breakdown.map((item) => {
      const cat = getStyle(item.category)
      const start = currentAngle
      const end = currentAngle + item.percentage
      currentAngle = end
      return `${cat.color} ${start.toFixed(1)}% ${end.toFixed(1)}%`
    })
    return `conic-gradient(${slices.join(', ')})`
  }

  const rows = summary?.category_breakdown.slice(0, VISIBLE_ROWS) ?? []
  const restAmount = (summary?.category_breakdown ?? [])
    .slice(VISIBLE_ROWS)
    .reduce((sum, item) => sum + item.amount, 0)
  const restCount = Math.max(0, (summary?.category_breakdown.length ?? 0) - VISIBLE_ROWS)

  return (
    <Card className="flex flex-col lg:col-span-6">
      <div>
        <h2 className={CARD_TITLE}>
          <PieChart className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          Where the money went
        </h2>
        <p className={CARD_SUBTITLE}>
          Your spending in this period, split by category. Open a row to see the
          transactions behind it.
        </p>
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-center">
        {loading ? (
          <div role="status" aria-label="Loading breakdown" className="flex flex-col items-center gap-8 sm:flex-row sm:justify-around">
            <Skeleton shape="circle" className="h-36 w-36 shrink-0 sm:h-40 sm:w-40" />
            <div className="w-full max-w-xs space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        ) : !summary || summary.total_expenses === 0 ? (
          <EmptyState
            icon={<PieChart className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="No spending in this period"
            description="Record an expense in this range and the split by category appears here."
          />
        ) : (
          <div className="flex w-full flex-col items-center gap-8 sm:flex-row sm:justify-around">
            {/* The donut is a summary of the rows beside it, not a separate
                fact. It is hidden from assistive tech because every slice it
                draws is also a labelled row — which is what a reader who
                cannot separate the colours uses. */}
            <div
              aria-hidden="true"
              className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full sm:h-40 sm:w-40"
              style={{ backgroundImage: getConicGradientString() }}
            >
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-surface-1 sm:h-28 sm:w-28">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Total out</p>
                <p className="mt-0.5 text-base font-semibold text-zinc-50 tnum">
                  {formatCurrencyCompact(summary.total_expenses)}
                </p>
              </div>
            </div>

            <ul className="w-full max-w-sm flex-1 space-y-1">
              {rows.map((item) => {
                const cat = getStyle(item.category)
                const amount = formatCurrency(item.amount)
                return (
                  <li key={item.category}>
                    <button
                      type="button"
                      disabled={!onCategoryClick}
                      onClick={onCategoryClick ? () => onCategoryClick(item.category) : undefined}
                      aria-label={`${cat.label}: ${amount}, ${item.percentage.toFixed(0)} percent of spending. Open its transactions.`}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="truncate text-sm font-medium text-zinc-100">{cat.label}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-zinc-50 tnum">
                        {formatCurrencyCompact(item.amount)}
                        <span className="ml-1 font-normal text-zinc-400">
                          {item.percentage.toFixed(0)}%
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {restCount > 0 && (
                <li className="flex items-center justify-between gap-3 border-t border-border-subtle px-2 pt-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5 text-zinc-400">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: NEUTRAL_MARK }}
                    />
                    <span className="truncate">
                      {restCount} more categor{restCount === 1 ? 'y' : 'ies'}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-zinc-300 tnum">
                    {formatCurrencyCompact(restAmount)}
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

export default ExpenseBreakdown
