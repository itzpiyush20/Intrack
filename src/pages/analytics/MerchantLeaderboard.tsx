import { Card, EmptyState, Skeleton } from '@/components/ui'
import { formatCurrency, formatCurrencyCompact } from '@/utils'
import { Store } from 'lucide-react'
import { SERIES, CARD_TITLE, CARD_SUBTITLE } from './chartTokens'

export interface MerchantLeaderboardItem {
  merchant: string
  amount: number
  count: number
}

interface MerchantLeaderboardProps {
  data: MerchantLeaderboardItem[]
  loading: boolean
  onMerchantClick?: (merchant: string) => void
}

export function MerchantLeaderboard({ data, loading, onMerchantClick }: MerchantLeaderboardProps) {
  const maxAmount = data.length ? Math.max(...data.map((d) => d.amount)) : 0

  return (
    <Card className="flex flex-col lg:col-span-5">
      <div>
        <h2 className={CARD_TITLE}>
          <Store className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          Who you paid most
        </h2>
        <p className={CARD_SUBTITLE}>
          The merchants that took the largest share of your spending in this
          period.
        </p>
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-center">
        {loading ? (
          <ul role="status" aria-label="Loading merchants" className="space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-2 w-full" />
              </li>
            ))}
          </ul>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<Store className="h-8 w-8 text-zinc-400" aria-hidden="true" />}
            title="No merchants to rank"
            description="Expenses need a merchant name before they can be ranked. Scanned transactions usually carry one."
          />
        ) : (
          <ul className="space-y-1">
            {data.map((item, index) => {
              const width = item.amount > 0 && maxAmount > 0 ? Math.max(3, (item.amount / maxAmount) * 100) : 0
              const row = (
                <>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-zinc-400 tnum"
                      >
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-medium text-zinc-100">{item.merchant}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-zinc-50 tnum">
                      {formatCurrencyCompact(item.amount)}
                    </span>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2 pl-7">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${width}%`, backgroundColor: SERIES.expense.color }}
                      />
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400 tnum">
                      {item.count} txn{item.count === 1 ? '' : 's'}
                    </span>
                  </span>
                </>
              )

              return (
                <li key={item.merchant}>
                  {onMerchantClick ? (
                    <button
                      type="button"
                      onClick={() => onMerchantClick(item.merchant)}
                      aria-label={`${item.merchant}: ${formatCurrency(item.amount)} across ${item.count} transaction${item.count === 1 ? '' : 's'}. Open them.`}
                      className="flex min-h-11 w-full flex-col justify-center rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex flex-col justify-center px-2 py-2">{row}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}

export default MerchantLeaderboard
