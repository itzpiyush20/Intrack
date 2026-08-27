import { Card, EmptyState } from '@/components/ui'
import { formatCurrencyCompact } from '@/utils'
import { Store } from 'lucide-react'

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
    <Card className="lg:col-span-5 flex flex-col min-h-[300px] p-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Store className="w-5 h-5 text-brand-400 shrink-0" />
          Top Merchants
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Where most of your spend went this period</p>
      </div>

      <div className="flex-1 flex flex-col justify-center mt-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-2 w-full" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<Store className="w-8 h-8 text-zinc-500" />}
            title="No merchant data"
            description="Record expenses with a merchant name to see who you spend with most."
          />
        ) : (
          <div className="space-y-3.5">
            {data.map((item, index) => (
              <div
                key={item.merchant}
                className={`space-y-1 ${onMerchantClick ? 'cursor-pointer hover:opacity-75' : ''}`}
                onClick={onMerchantClick ? () => onMerchantClick(item.merchant) : undefined}
                role={onMerchantClick ? 'button' : undefined}
                tabIndex={onMerchantClick ? 0 : undefined}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 h-5 w-5 rounded-full bg-surface-2 border border-border-subtle/50 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                      {index + 1}
                    </span>
                    <span className="text-zinc-300 font-medium truncate">{item.merchant}</span>
                    <span className="shrink-0 text-zinc-600">
                      · {item.count} txn{item.count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="shrink-0 font-semibold text-zinc-200">
                    {formatCurrencyCompact(item.amount)}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface-3 rounded-full overflow-hidden ml-7">
                  <div
                    className="h-full bg-brand-400/80 rounded-full transition-all duration-500"
                    style={{ width: `${item.amount > 0 && maxAmount > 0 ? Math.max(3, (item.amount / maxAmount) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

export default MerchantLeaderboard
