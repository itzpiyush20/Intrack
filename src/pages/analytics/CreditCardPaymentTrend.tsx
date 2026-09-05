import { useState } from 'react'
import { Card, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact, cn } from '@/utils'
import { CreditCard } from 'lucide-react'
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

export interface CreditCardPaymentTrendItem {
  monthKey: string
  label: string
  amount: number
}

interface CreditCardPaymentTrendProps {
  data: CreditCardPaymentTrendItem[]
  loading: boolean
  onMonthClick?: (monthKey: string, label: string) => void
}

export function CreditCardPaymentTrend({ data, loading, onMonthClick }: CreditCardPaymentTrendProps) {
  const hasPayments = data.some((d) => d.amount > 0)
  const maxVal = data.length ? Math.max(...data.map((d) => d.amount)) : 0
  const [tappedIndex, setTappedIndex] = useState<number | null>(null)

  return (
    <Card className="flex flex-col">
      <div>
        <h2 className={CARD_TITLE}>
          <CreditCard className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          Credit card bills you paid
        </h2>
        <p className={CARD_SUBTITLE}>
          Kept out of your expense totals on purpose — the purchases these bills
          cover were already counted on the day you made them. Counting the bill
          as well would book the same spending twice.
        </p>
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-end">
        {loading ? (
          <div role="status" aria-label="Loading chart">
            <div className="flex h-40 items-end justify-between gap-3 sm:gap-6">
              {[70, 45, 88, 52, 76, 38].map((h, i) => (
                <div key={i} className="flex h-full flex-1 items-end justify-center">
                  <div aria-hidden="true" className="skeleton w-4 rounded-t-sm sm:w-6" style={{ height: `${h}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-3 flex-1" />
              ))}
            </div>
          </div>
        ) : !hasPayments ? (
          <EmptyState
            icon={<CreditCard className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="No card bill payments recorded"
            description="Categorise a payment as a credit card bill and it appears here, separate from your spending."
          />
        ) : (
          <div className={CHART_SCROLLER}>
            <div className="relative h-48 min-w-full select-none pt-5 pl-12 sm:min-w-[400px] md:min-w-0">
              <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
                {[1, 0.75, 0.5, 0.25, 0].map((t) => (
                  <div key={t} className="relative flex items-center">
                    <span className={cn(AXIS_LABEL, 'absolute -top-2 left-0 bg-surface-1 pr-1.5 leading-none')}>
                      {maxVal > 0 ? formatCurrencyCompact(maxVal * t) : ''}
                    </span>
                    <div className={GRIDLINE} />
                  </div>
                ))}
              </div>

              <div className="relative flex h-full items-end justify-between gap-1.5 sm:gap-5 md:gap-7">
                {data.map((d, index) => {
                  // Zero months render flat rather than as a 3% stub.
                  const height = d.amount > 0 && maxVal > 0 ? Math.max(3, (d.amount / maxVal) * 100) : 0
                  const open = tappedIndex === index
                  return (
                    <button
                      key={index}
                      type="button"
                      className={CHART_COLUMN}
                      aria-label={`${d.label}: ${formatCurrency(d.amount)} paid towards card bills. Open the payments behind it.`}
                      onClick={() => {
                        setTappedIndex(open ? null : index)
                        onMonthClick?.(d.monthKey, d.label)
                      }}
                    >
                      <div
                        aria-hidden="true"
                        className={cn(
                          TOOLTIP,
                          'group-hover:opacity-100 group-focus-visible:opacity-100',
                          open ? 'opacity-100' : 'opacity-0'
                        )}
                      >
                        <p className="text-xs font-semibold text-zinc-50">{d.label}</p>
                        <p className="mt-0.5 text-sm font-semibold text-zinc-50 tnum">
                          {formatCurrencyCompact(d.amount)}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-400">paid towards card bills</p>
                      </div>

                      <div className="flex h-full w-full max-w-[64px] items-end justify-center px-1">
                        <div
                          className="w-4 rounded-t-sm transition-[height] duration-500 ease-out sm:w-6"
                          style={{ height: `${height}%`, backgroundColor: NEUTRAL_MARK }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex min-w-full justify-between gap-1.5 pl-12 sm:min-w-[400px] sm:gap-5 md:min-w-0 md:gap-7">
              {data.map((d, index) => (
                <span key={index} className={cn(BUCKET_LABEL, 'mt-2 min-w-11 flex-1 text-center')}>
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export default CreditCardPaymentTrend
