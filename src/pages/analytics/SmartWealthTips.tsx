import { Card, EmptyState } from '@/components/ui'
import { formatCurrency } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { CategoryIcon } from './CategoryIcon'
import {
  Lightbulb,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  Target
} from 'lucide-react'

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

interface TrendData {
  diff: number
  pct: number
  increased: boolean
  prevLabel: string
}

interface SmartWealthTipsProps {
  loading: boolean
  summary: SummaryData | null
  trend: TrendData | null
  savingsRate: number
}

export function SmartWealthTips({
  loading,
  summary,
  trend,
  savingsRate,
}: SmartWealthTipsProps) {
  const { getStyle } = useCategories()
  return (
    <Card className="lg:col-span-6 flex flex-col min-h-[400px] p-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-brand-400 shrink-0" />
          Smart Wealth Insights
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Automated cashflow tips and intelligence</p>
      </div>

      <div className="flex-1 flex flex-col justify-center space-y-4 mt-6">
        {loading ? (
          [1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full rounded-xl" />
          ))
        ) : !summary || (summary.total_income === 0 && summary.total_expenses === 0) ? (
          <EmptyState
            icon={<Lightbulb className="w-8 h-8 text-zinc-500" />}
            title="No advice yet"
            description="Record income and expenses for this period to trigger our personal wealth advisor."
          />
        ) : (
          <>
            {trend && (
              <div
                className={`rounded-2xl border p-4 flex gap-3.5 animate-slide-up ${
                  trend.increased
                    ? 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)]'
                    : 'bg-[var(--status-positive-subtle)] border-[var(--status-positive-border)]'
                }`}
              >
                {trend.increased ? (
                  <AlertTriangle className="w-6 h-6 text-[var(--status-danger-icon)] shrink-0 mt-0.5" />
                ) : (
                  <Sparkles className="w-6 h-6 text-[var(--status-positive-icon)] shrink-0 mt-0.5" />
                )}
                <div className="text-xs leading-relaxed">
                  <h4 className={`font-bold ${trend.increased ? 'text-[var(--status-danger-text)]' : 'text-[var(--status-positive-text)]'}`}>
                    {trend.increased ? 'Discretionary Outflow Surge' : 'Excellent Budget Control'}
                  </h4>
                  <p className="text-zinc-400 mt-1">
                    {trend.increased
                      ? `Your outflow expanded by ${trend.pct.toFixed(0)}% (+${formatCurrency(
                          Math.abs(trend.diff)
                        )}) compared to ${trend.prevLabel}. Check your category limits stack in budgets to establish tighter caps.`
                      : `Outstanding discipline! Your expenses decreased by ${Math.abs(
                          trend.pct
                        ).toFixed(0)}% compared to ${trend.prevLabel}.`}
                  </p>
                </div>
              </div>
            )}

            {summary.total_income === 0 ? (
              <div className="rounded-2xl border border-border-default bg-surface-2/20 p-4 flex gap-3.5 animate-slide-up stagger-1">
                <TrendingUp className="w-6 h-6 text-[var(--status-info-icon)] shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <h4 className="font-bold text-zinc-200">No income recorded this period</h4>
                  <p className="text-zinc-400 mt-1">
                    We can't work out a savings rate without income to measure it against. Add
                    your salary or other credits for this period to unlock this reading.
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={`rounded-2xl border p-4 flex gap-3.5 animate-slide-up stagger-1 ${
                  savingsRate >= 30
                    ? 'bg-[var(--status-positive-subtle)] border-[var(--status-positive-border)]'
                    : savingsRate >= 10
                    ? 'bg-zinc-800/20 border-border-subtle/50'
                    : 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)]'
                }`}
              >
                {savingsRate >= 30 ? (
                  <ShieldCheck className="w-6 h-6 text-[var(--status-positive-icon)] shrink-0 mt-0.5" />
                ) : savingsRate >= 10 ? (
                  <TrendingUp className="w-6 h-6 text-[var(--status-info-icon)] shrink-0 mt-0.5" />
                ) : (
                  <Lightbulb className="w-6 h-6 text-[var(--status-warning-icon)] shrink-0 mt-0.5" />
                )}
                <div className="text-xs leading-relaxed">
                  <h4
                    className={`font-bold ${
                      savingsRate >= 30
                        ? 'text-[var(--status-positive-text)]'
                        : savingsRate >= 10
                        ? 'text-zinc-200'
                        : 'text-[var(--status-warning-text)]'
                    }`}
                  >
                    {savingsRate >= 30
                      ? 'High Wealth Accumulation'
                      : savingsRate >= 10
                      ? 'Healthy Saving Pattern'
                      : 'Aggressive Outflow Impact'}
                  </h4>
                  <p className="text-zinc-400 mt-1">
                    {savingsRate >= 30
                      ? `You secured a magnificent ${savingsRate.toFixed(
                          0
                        )}% savings rate (${formatCurrency(
                          summary.savings
                        )}) of your total earnings in this period! Highly effective wealth retention.`
                      : savingsRate >= 10
                      ? `Your savings rate sits at ${savingsRate.toFixed(
                          0
                        )}% in this period. A very stable pattern. Keep mapping discretionary purchases to maintain this line.`
                      : `You saved only ${Math.max(0, savingsRate).toFixed(
                          0
                        )}% of your income in this period. Discretionary debit leaks are absorbing your cash flow. Establish category limits immediately.`}
                  </p>
                </div>
              </div>
            )}

            {summary.category_breakdown.length > 0 && (
              <div className="rounded-2xl border border-border-default bg-surface-2/20 p-4 flex gap-3.5 animate-slide-up stagger-2">
                <Target className="w-6 h-6 text-brand-400 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <h4 className="font-bold text-zinc-200">Discretionary Focus Target</h4>
                  <p className="text-zinc-400 mt-1">
                    {(() => {
                      const top = summary.category_breakdown[0]
                      const cat = getStyle(top.category)
                      const savingsTarget = top.amount * 0.15
                      return (
                        <span className="flex items-center flex-wrap gap-x-1 gap-y-0.5">
                          <CategoryIcon name={top.category} className="text-sm shrink-0 inline" />
                          <strong>{cat.label}</strong>
                          <span>was your largest outflow absorb, eating</span>
                          <strong>{top.percentage.toFixed(0)}%</strong>
                          <span>of your total expenses. Trimming this category limit by just 15% would secure an extra</span>
                          <strong>{formatCurrency(savingsTarget)}</strong>
                          <span>next period!</span>
                        </span>
                      )
                    })()}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default SmartWealthTips
