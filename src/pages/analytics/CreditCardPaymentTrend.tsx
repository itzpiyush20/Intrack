import { useState } from 'react'
import { Card, EmptyState } from '@/components/ui'
import { formatCurrencyCompact } from '@/utils'
import { CreditCard } from 'lucide-react'

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
    <Card className="flex flex-col min-h-[260px] p-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-400 shrink-0" />
          Credit Card Bill Payments
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Tracked separately from Total Expenses — the purchases behind these
          bills were already counted when they happened.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-end mt-6">
        {loading ? (
          <div className="flex items-end justify-between gap-6 h-32 pt-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex-1 flex items-end h-full justify-center">
                <div className="skeleton w-6 h-1/2" />
              </div>
            ))}
          </div>
        ) : !hasPayments ? (
          <EmptyState
            icon={<CreditCard className="w-8 h-8 text-zinc-500" />}
            title="No credit card bill payments yet"
            description="Categorize a transaction as Credit Card Bill Payment to see its trend here."
          />
        ) : (
          <div className="overflow-x-auto scrollbar-none w-full pb-2">
            <div className="flex items-end justify-between gap-2.5 sm:gap-6 md:gap-8 h-40 pt-4 relative select-none min-w-full sm:min-w-[400px] md:min-w-0">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-full border-t border-dashed border-zinc-400 h-0" />
                ))}
              </div>

              {data.map((d, index) => {
                // Zero months render flat rather than as a 3% stub.
                const height = d.amount > 0 && maxVal > 0 ? Math.max(3, (d.amount / maxVal) * 100) : 0
                return (
                  <div
                    key={index}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                    onClick={() => setTappedIndex(tappedIndex === index ? null : index)}
                  >
                    <div className={`absolute bottom-full mb-2 bg-zinc-950 border border-zinc-800 text-xs p-2.5 rounded-xl shadow-xl pointer-events-none transition-opacity z-10 min-w-[110px] text-left group-hover:opacity-100 ${tappedIndex === index ? 'opacity-100' : 'opacity-0'}`}>
                      <p className="font-semibold text-zinc-300">{d.label}</p>
                      <p className="text-zinc-400 font-bold">{formatCurrencyCompact(d.amount)}</p>
                    </div>

                    <div className="flex items-end h-full w-full max-w-[64px] justify-center px-1 min-h-11">
                      <div
                        onClick={onMonthClick ? () => onMonthClick(d.monthKey, d.label) : undefined}
                        className={`w-4 sm:w-6 bg-slate-500/80 rounded-t-md hover:bg-slate-400 transition-all duration-500 ease-out ${onMonthClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                        style={{ height: `${height}%` }}
                      />
                    </div>

                    <span className="text-xs text-zinc-500 font-semibold mt-2.5 group-hover:text-zinc-200 transition-colors shrink-0">
                      {d.label}
                    </span>
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

export default CreditCardPaymentTrend
