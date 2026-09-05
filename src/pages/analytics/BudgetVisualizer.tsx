import { Card, Badge } from '@/components/ui'
import { formatCurrency } from '@/utils'
import { Package, Sparkles, TrendingUp, ShieldCheck } from 'lucide-react'

interface BudgetVisualizerProps {
  needsSpent: number
  needsPct: number
  wantsSpent: number
  wantsPct: number
  savingsSpent: number
  finalSavingsPct: number
  emergencyMonths: number
  isEmergencyFundReady: boolean
  onBucketClick?: (bucket: 'needs' | 'wants' | 'savings') => void
}

export function BudgetVisualizer({
  needsSpent,
  needsPct,
  wantsSpent,
  wantsPct,
  savingsSpent,
  finalSavingsPct,
  emergencyMonths,
  isEmergencyFundReady,
  onBucketClick,
}: BudgetVisualizerProps) {
  return (
    <Card className="relative overflow-hidden md:col-span-2 border-sb-hairline bg-surface-1 shadow-card rounded-2xl flex flex-col justify-between p-5 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
      <div>
        <h2 className="text-base font-bold text-sb-ink mb-4">50/30/20 Cashflow Distribution</h2>
        <div className="space-y-4">
          {/* Needs */}
          <div
            onClick={onBucketClick ? () => onBucketClick('needs') : undefined}
            className={onBucketClick ? 'cursor-pointer hover:opacity-85 transition-opacity' : ''}
            role={onBucketClick ? 'button' : undefined}
            tabIndex={onBucketClick ? 0 : undefined}
          >
            <div className="flex flex-col sm:flex-row sm:justify-between text-xs gap-1 mb-1.5">
              <span className="text-sb-ink-muted font-semibold flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-[var(--status-info-text)] shrink-0" />
                Needs (Target 50%)
              </span>
              <span className="text-sb-ink font-semibold tnum">
                {formatCurrency(needsSpent)} ({needsPct}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-surface-2 border border-sb-hairline/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--status-info-text)] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, needsPct)}%` }}
              />
            </div>
          </div>

          {/* Wants */}
          <div
            onClick={onBucketClick ? () => onBucketClick('wants') : undefined}
            className={onBucketClick ? 'cursor-pointer hover:opacity-85 transition-opacity' : ''}
            role={onBucketClick ? 'button' : undefined}
            tabIndex={onBucketClick ? 0 : undefined}
          >
            <div className="flex flex-col sm:flex-row sm:justify-between text-xs gap-1 mb-1.5">
              <span className="text-sb-ink-muted font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--status-warning-text)] shrink-0" />
                Wants (Target 30%)
              </span>
              <span className="text-sb-ink font-semibold tnum">
                {formatCurrency(wantsSpent)} ({wantsPct}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-surface-2 border border-sb-hairline/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--status-warning-text)] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, wantsPct)}%` }}
              />
            </div>
          </div>

          {/* Savings */}
          <div
            onClick={onBucketClick ? () => onBucketClick('savings') : undefined}
            className={onBucketClick ? 'cursor-pointer hover:opacity-85 transition-opacity' : ''}
            role={onBucketClick ? 'button' : undefined}
            tabIndex={onBucketClick ? 0 : undefined}
          >
            <div className="flex flex-col sm:flex-row sm:justify-between text-xs gap-1 mb-1.5">
              <span className="text-sb-ink-muted font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[var(--status-positive-text)] shrink-0" />
                Savings / Investments (Target 20%)
              </span>
              <span className="text-sb-ink font-semibold tnum">
                {formatCurrency(savingsSpent)} ({finalSavingsPct}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-surface-2 border border-sb-hairline/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--status-positive-text)] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, finalSavingsPct)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Emergency Reserve Check */}
      <div className="mt-6 p-4 rounded-xl bg-surface-2/60 border border-sb-hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs shadow-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-sb-ink flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
            Emergency Reserve Status
          </span>
          <span className="text-sb-ink-muted text-xs">
            Current Reserve covers <strong className="text-sb-ink">{emergencyMonths} months</strong> of average essentials.
          </span>
        </div>
        <div className="shrink-0">
          <Badge variant={isEmergencyFundReady ? 'success' : 'warning'}>
            {isEmergencyFundReady ? 'Funded (6mo+)' : 'Needs Buffering'}
          </Badge>
        </div>
      </div>
    </Card>
  )
}

export default BudgetVisualizer
