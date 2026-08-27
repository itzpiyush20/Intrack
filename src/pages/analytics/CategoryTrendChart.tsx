import { useState } from 'react'
import { Card, EmptyState } from '@/components/ui'
import { formatCurrencyCompact } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { LineChart } from 'lucide-react'

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

  return (
    <Card className="lg:col-span-7 flex flex-col min-h-[300px] p-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <LineChart className="w-5 h-5 text-brand-400 shrink-0" />
          Category Trend
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Top spending categories over the last 6 months</p>
      </div>

      <div className="flex-1 flex flex-col justify-end mt-6">
        {loading ? (
          <div className="flex items-end justify-between gap-6 h-40 pt-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex-1 flex items-end h-full justify-center">
                <div className="skeleton w-6 h-2/3" />
              </div>
            ))}
          </div>
        ) : !hasTransactions ? (
          <EmptyState
            icon={<LineChart className="w-8 h-8 text-zinc-500" />}
            title="Insufficient history"
            description="Record expenses over consecutive months to see category trends."
          />
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto scrollbar-none w-full pb-2">
              <div className="flex items-end justify-between gap-2.5 sm:gap-6 md:gap-8 h-48 pt-4 relative select-none min-w-full sm:min-w-[500px] md:min-w-0">
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-full border-t border-dashed border-zinc-400 h-0" />
                  ))}
                </div>

                {data.map((m, index) => (
                  <div
                    key={m.monthKey}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                    onClick={() => setTappedIndex(tappedIndex === index ? null : index)}
                  >
                    <div
                      className={`absolute bottom-full mb-2 bg-zinc-950 border border-zinc-800 text-xs p-2.5 rounded-xl shadow-xl space-y-1 pointer-events-none transition-opacity z-10 min-w-[140px] text-left group-hover:opacity-100 ${tappedIndex === index ? 'opacity-100' : 'opacity-0'}`}
                    >
                      <p className="font-semibold text-zinc-300 border-b border-border-subtle/50 pb-1 mb-1">
                        {m.label} · {formatCurrencyCompact(m.total)}
                      </p>
                      {m.segments.filter((s) => s.amount > 0).map((s) => {
                        const isOther = s.category === OTHER_KEY
                        const cat = isOther ? null : getStyle(s.category)
                        return (
                          <div key={s.category} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-1.5 text-zinc-400">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: isOther ? 'var(--zinc-600)' : cat!.color }}
                              />
                              {isOther ? 'Other' : cat!.label}
                            </span>
                            <span className="font-bold text-zinc-200">{formatCurrencyCompact(s.amount)}</span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex flex-col-reverse w-full max-w-[40px] rounded-t-md overflow-hidden min-h-11" style={{ height: `${m.total > 0 && maxTotal > 0 ? Math.max(3, (m.total / maxTotal) * 100) : 0}%` }}>
                      {m.segments.filter((s) => s.amount > 0).map((s) => {
                        const isOther = s.category === OTHER_KEY
                        const cat = isOther ? null : getStyle(s.category)
                        const heightPct = m.total > 0 ? (s.amount / m.total) * 100 : 0
                        const clickable = !isOther && !!onSegmentClick
                        return (
                          <div
                            key={s.category}
                            className={`w-full transition-all duration-500 ease-out hover:opacity-80 ${clickable ? 'cursor-pointer' : ''}`}
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: isOther ? 'var(--zinc-600)' : cat!.color,
                            }}
                            onClick={clickable ? (e) => { e.stopPropagation(); onSegmentClick!(s.category, m.monthKey) } : undefined}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                          />
                        )
                      })}
                    </div>

                    <span className="text-xs text-zinc-500 font-semibold mt-2.5 group-hover:text-zinc-200 transition-colors shrink-0">
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2 text-[11px] font-medium text-zinc-500">
              {legendCategories.map((category) => {
                const isOther = category === OTHER_KEY
                const cat = isOther ? null : getStyle(category)
                return (
                  <div key={category} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: isOther ? 'var(--zinc-600)' : cat!.color }}
                    />
                    <span>{isOther ? 'Other' : cat!.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export default CategoryTrendChart
