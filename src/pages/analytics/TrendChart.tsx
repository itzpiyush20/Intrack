import { useState } from 'react'
import { Card, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact, cn } from '@/utils'
import type { RangeType } from './PeriodSelector'
import { BarChart3 } from 'lucide-react'
import {
  SERIES,
  AXIS_LABEL,
  BUCKET_LABEL,
  GRIDLINE,
  TOOLTIP,
  CHART_COLUMN,
  CHART_SCROLLER,
  CARD_TITLE,
  CARD_SUBTITLE,
} from './chartTokens'
import ChartLegend from './ChartLegend'

interface TrendItem {
  label: string
  income: number
  expenses: number
  savings: number
  /** Present on day-bucketed ranges (this-week, last-week, last-15-days). */
  dateStr?: string
  /** Present on the last-month range (week buckets). */
  startStr?: string
  endStr?: string
  /** Present on the last-6-months range. */
  monthKey?: string
}

interface TrendChartProps {
  range: RangeType
  trendData: TrendItem[]
  loading: boolean
  hasTransactions: boolean
  /** Called when a period bar/column is clicked, with that period's own item (carrying whichever of dateStr/startStr+endStr/monthKey applies) and its display label. */
  onPeriodClick?: (item: TrendItem, label: string) => void
}

const getTrendDescription = (trendData: TrendItem[], range: RangeType) => {
  if (range === 'this-week') {
    return 'What came in and what went out, day by day, this week.'
  }
  if (range === 'last-week') {
    return 'What came in and what went out, day by day, last week.'
  }
  if (range === 'last-15-days') {
    return 'What came in and what went out, day by day, over the last 15 days.'
  }
  if (range === 'this-month') {
    return 'What came in and what went out, week by week, this month.'
  }
  if (range === 'last-month') {
    return 'What came in and what went out, week by week, last calendar month.'
  }
  if (range === 'last-6-months') {
    return `What came in and what went out, month by month, over the last ${trendData.length} months.`
  }
  return 'What came in and what went out over this period.'
}

/**
 * Five evenly spaced gridlines with their values written on them.
 *
 * The chart used to draw the lines at 10% opacity and label none of them, so a
 * bar's height carried no readable magnitude at all — you could see that
 * Tuesday was taller than Monday and nothing more. This is the smallest fix
 * that makes the shape mean rupees.
 */
function ValueAxis({ maxVal }: { maxVal: number }) {
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  return (
    <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
      {ticks.map((t) => (
        <div key={t} className="relative flex items-center">
          <span className={cn(AXIS_LABEL, 'absolute -top-2 left-0 bg-surface-1 pr-1.5 leading-none')}>
            {maxVal > 0 ? formatCurrencyCompact(maxVal * t) : ''}
          </span>
          <div className={GRIDLINE} />
        </div>
      ))}
    </div>
  )
}

export function TrendChart({
  range,
  trendData,
  loading,
  hasTransactions,
  onPeriodClick,
}: TrendChartProps) {
  const maxVal = trendData.length
    ? Math.max(...trendData.map((h) => Math.max(h.income, h.expenses)))
    : 0

  const [tappedIndex, setTappedIndex] = useState<number | null>(null)

  return (
    <Card className="flex flex-col">
      <div>
        <h2 className={CARD_TITLE}>
          <BarChart3 className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          Money in vs money out
        </h2>
        <p className={CARD_SUBTITLE}>{getTrendDescription(trendData, range)}</p>
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-end">
        {loading ? (
          // Shaped like the chart it replaces: six paired columns of unequal
          // height, a label under each. Nothing moves position when the real
          // bars arrive.
          <div role="status" aria-label="Loading chart">
            <div className="flex h-48 items-end justify-between gap-3 sm:gap-6">
              {[62, 88, 40, 74, 55, 92].map((h, i) => (
                <div key={i} className="flex h-full flex-1 items-end justify-center gap-1.5 sm:gap-2">
                  <div aria-hidden="true" className="skeleton w-2.5 rounded-t-sm sm:w-4" style={{ height: `${h}%` }} />
                  <div aria-hidden="true" className="skeleton w-2.5 rounded-t-sm sm:w-4" style={{ height: `${h * 0.6}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-3 flex-1" />
              ))}
            </div>
          </div>
        ) : !hasTransactions ? (
          <EmptyState
            icon={<BarChart3 className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="Nothing to chart yet"
            description="Once a few transactions are recorded in this period, this chart shows what came in against what went out."
          />
        ) : (
          <div className="space-y-4">
            <div className={CHART_SCROLLER}>
              {/* pl-12 leaves room for the axis values, which are drawn inside
                  the plot area rather than in a separate column so the bars
                  keep the full width on a 360px phone. */}
              <div className="relative h-56 min-w-full select-none pt-5 pl-12 sm:min-w-[500px] md:min-w-0">
                <ValueAxis maxVal={maxVal} />
                <div className="relative flex h-full items-end justify-between gap-1.5 sm:gap-5 md:gap-7">
                  {trendData.map((h, index) => {
                    // A zero bar must render as nothing. Flooring every bar at 3%
                    // drew a stub for days with no activity, which reads as spend
                    // that did not happen.
                    const barHeight = (v: number) => (v > 0 && maxVal > 0 ? Math.max(3, (v / maxVal) * 100) : 0)
                    const incHeight = barHeight(h.income)
                    const expHeight = barHeight(h.expenses)
                    const open = tappedIndex === index

                    return (
                      <button
                        key={index}
                        type="button"
                        className={CHART_COLUMN}
                        aria-label={`${h.label}: ${formatCurrency(h.income)} in, ${formatCurrency(h.expenses)} out. Open the transactions behind it.`}
                        onClick={() => {
                          setTappedIndex(open ? null : index)
                          onPeriodClick?.(h, h.label)
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className={cn(
                            TOOLTIP,
                            'space-y-1.5 group-hover:opacity-100 group-focus-visible:opacity-100',
                            open ? 'opacity-100' : 'opacity-0'
                          )}
                        >
                          <p className="mb-1.5 border-b border-border-subtle pb-1.5 text-xs font-semibold text-zinc-50">
                            {h.label}
                          </p>
                          <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="flex items-center gap-1.5 text-zinc-300">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SERIES.income.color }} />
                              {SERIES.income.label}
                            </span>
                            <span className="font-semibold text-zinc-50 tnum">{formatCurrencyCompact(h.income)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="flex items-center gap-1.5 text-zinc-300">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SERIES.expense.color }} />
                              {SERIES.expense.label}
                            </span>
                            <span className="font-semibold text-zinc-50 tnum">{formatCurrencyCompact(h.expenses)}</span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-border-subtle pt-1.5 text-xs">
                            <span className="font-medium text-zinc-300">Left over</span>
                            <span
                              className="font-semibold tnum"
                              style={{ color: h.savings >= 0 ? SERIES.income.color : 'var(--status-danger-text)' }}
                            >
                              {formatCurrencyCompact(h.savings)}
                            </span>
                          </div>
                        </div>

                        <div className="flex h-full w-full max-w-[64px] items-end justify-center gap-1 px-1 sm:gap-2">
                          <div
                            className="w-2.5 rounded-t-sm transition-[height] duration-500 ease-out sm:w-4"
                            style={{ height: `${incHeight}%`, backgroundColor: SERIES.income.color }}
                          />
                          <div
                            className="w-2.5 rounded-t-sm transition-[height] duration-500 ease-out sm:w-4"
                            style={{ height: `${expHeight}%`, backgroundColor: SERIES.expense.color }}
                          />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Bucket labels ride below the plot area on the same grid, so a
                  long label ("Mon 31") cannot push the bars around. */}
              <div className="flex min-w-full justify-between gap-1.5 pl-12 sm:min-w-[500px] sm:gap-5 md:min-w-0 md:gap-7">
                {trendData.map((h, index) => (
                  <span key={index} className={cn(BUCKET_LABEL, 'mt-2 min-w-11 flex-1 text-center')}>
                    {h.label}
                  </span>
                ))}
              </div>
            </div>

            <ChartLegend
              className="pt-1"
              items={[
                { color: SERIES.income.color, label: SERIES.income.label },
                { color: SERIES.expense.color, label: SERIES.expense.label },
              ]}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

export default TrendChart
