import { useState } from 'react'
import { Card, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact, cn } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { LineChart } from 'lucide-react'
import {
  NEUTRAL_MARK,
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

export interface CategoryTrendSegment {
  category: string
  amount: number
}

export interface CategoryTrendMonth {
  monthKey: string
  label: string
  total: number
  segments: CategoryTrendSegment[]
}

interface CategoryTrendChartProps {
  data: CategoryTrendMonth[]
  loading: boolean
  hasTransactions: boolean
  /** Called when a named-category bar segment is clicked (never for the "Other" aggregate segment). */
  onSegmentClick?: (category: string, monthKey: string) => void
}

const OTHER_KEY = '__other__'

export function CategoryTrendChart({ data, loading, hasTransactions, onSegmentClick }: CategoryTrendChartProps) {
  const { getStyle } = useCategories()
  const [tappedIndex, setTappedIndex] = useState<number | null>(null)
  const maxTotal = data.length ? Math.max(...data.map((m) => m.total)) : 0

  // Legend covers the union of categories that actually appear across the
  // window, in the order they first show up, so it stays stable month to month.
  const legendCategories: string[] = []
  data.forEach((m) => {
    m.segments.forEach((s) => {
      if (s.amount > 0 && !legendCategories.includes(s.category)) legendCategories.push(s.category)
    })
  })

  // The "Other" roll-up used `var(--zinc-600)`, which the light theme resolves
  // to #dde1e8 — a near-white block on a white card. It was drawn but could
  // not be seen. NEUTRAL_MARK is a real grey in both directions.
  const segmentColor = (category: string) =>
    category === OTHER_KEY ? NEUTRAL_MARK : getStyle(category).color
  const segmentLabel = (category: string) =>
    category === OTHER_KEY ? 'Everything else' : getStyle(category).label

  return (
    <Card className="flex flex-col lg:col-span-7">
      <div>
        <h2 className={CARD_TITLE}>
          <LineChart className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          What you spend on, month by month
        </h2>
        <p className={CARD_SUBTITLE}>
          Your five biggest categories over the last six months, so a habit
          forming is visible before it becomes a surprise.
        </p>
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-end">
        {loading ? (
          <div role="status" aria-label="Loading chart">
            <div className="flex h-48 items-end justify-between gap-3 sm:gap-6">
              {[58, 72, 90, 64, 81, 47].map((h, i) => (
                <div key={i} className="flex h-full flex-1 items-end justify-center">
                  <div aria-hidden="true" className="skeleton w-6 rounded-t-sm sm:w-10" style={{ height: `${h}%` }} />
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
            icon={<LineChart className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="Not enough history yet"
            description="This chart needs expenses across a few months before a trend means anything."
          />
        ) : (
          <div className="space-y-4">
            <div className={CHART_SCROLLER}>
              <div className="relative h-56 min-w-full select-none pt-5 pl-12 sm:min-w-[500px] md:min-w-0">
                <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
                  {[1, 0.75, 0.5, 0.25, 0].map((t) => (
                    <div key={t} className="relative flex items-center">
                      <span className={cn(AXIS_LABEL, 'absolute -top-2 left-0 bg-surface-1 pr-1.5 leading-none')}>
                        {maxTotal > 0 ? formatCurrencyCompact(maxTotal * t) : ''}
                      </span>
                      <div className={GRIDLINE} />
                    </div>
                  ))}
                </div>

                <div className="relative flex h-full items-end justify-between gap-1.5 sm:gap-5 md:gap-7">
                  {data.map((m, index) => {
                    const open = tappedIndex === index
                    const visible = m.segments.filter((s) => s.amount > 0)
                    return (
                      <div key={m.monthKey} className={cn(CHART_COLUMN, 'cursor-default')}>
                        <div
                          aria-hidden="true"
                          className={cn(
                            TOOLTIP,
                            'space-y-1.5 group-hover:opacity-100 group-focus-within:opacity-100',
                            open ? 'opacity-100' : 'opacity-0'
                          )}
                        >
                          <p className="mb-1.5 flex items-center justify-between gap-4 border-b border-border-subtle pb-1.5 text-xs font-semibold text-zinc-50">
                            <span>{m.label}</span>
                            <span className="tnum">{formatCurrencyCompact(m.total)}</span>
                          </p>
                          {visible.map((s) => (
                            <span key={s.category} className="flex items-center justify-between gap-4 text-xs">
                              <span className="flex min-w-0 items-center gap-1.5 text-zinc-300">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: segmentColor(s.category) }}
                                />
                                <span className="truncate">{segmentLabel(s.category)}</span>
                              </span>
                              <span className="shrink-0 font-semibold text-zinc-50 tnum">
                                {formatCurrencyCompact(s.amount)}
                              </span>
                            </span>
                          ))}
                        </div>

                        <div
                          className="flex w-full max-w-[40px] flex-col-reverse overflow-hidden rounded-t-sm"
                          style={{ height: `${m.total > 0 && maxTotal > 0 ? Math.max(3, (m.total / maxTotal) * 100) : 0}%` }}
                          onClick={() => setTappedIndex(open ? null : index)}
                        >
                          {visible.map((s) => {
                            const isOther = s.category === OTHER_KEY
                            const heightPct = m.total > 0 ? (s.amount / m.total) * 100 : 0
                            const clickable = !isOther && !!onSegmentClick
                            const style = { height: `${heightPct}%`, backgroundColor: segmentColor(s.category) }
                            return clickable ? (
                              <button
                                key={s.category}
                                type="button"
                                className="w-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
                                style={style}
                                aria-label={`${segmentLabel(s.category)} in ${m.label}: ${formatCurrency(s.amount)}. Open its transactions.`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSegmentClick!(s.category, m.monthKey)
                                }}
                              />
                            ) : (
                              <div key={s.category} className="w-full" style={style} />
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex min-w-full justify-between gap-1.5 pl-12 sm:min-w-[500px] sm:gap-5 md:min-w-0 md:gap-7">
                {data.map((m) => (
                  <span key={m.monthKey} className={cn(BUCKET_LABEL, 'mt-2 min-w-11 flex-1 text-center')}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>

            <ChartLegend
              className="pt-1"
              items={legendCategories.map((category) => ({
                color: segmentColor(category),
                label: segmentLabel(category),
              }))}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

export default CategoryTrendChart
