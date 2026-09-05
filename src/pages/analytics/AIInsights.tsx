import { Card, EmptyState } from '@/components/ui'
import { BrainCircuit, AlertCircle, Lightbulb } from 'lucide-react'

interface AIInsightsProps {
  aiSource: 'gemini' | 'rule-based' | null
  aiLoading: boolean
  aiAlerts: string[]
  aiInsights: string[]
}

export function AIInsights({
  aiSource,
  aiLoading,
  aiAlerts,
  aiInsights,
}: AIInsightsProps) {
  return (
    <Card className="relative overflow-hidden border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 flex flex-col justify-between h-full before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <BrainCircuit className="w-5 h-5 text-brand-600 shrink-0" />
          <h2 className="text-base font-bold text-sb-ink">Wealth Advisory Recommendations</h2>
          {aiSource && (
            <span className={`ml-auto text-xs uppercase font-bold tracking-widest px-2 py-0.5 rounded-full border shadow-xs ${
              aiSource === 'gemini'
                ? 'text-brand-700 border-brand-200 bg-brand-50'
                : 'text-sb-ink-muted border-sb-hairline bg-surface-2'
            }`}>
              {aiSource === 'gemini' ? '✦ AI' : 'Rule-based'}
            </span>
          )}
        </div>

        {aiLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {aiAlerts.length > 0 && (
              <div className="mb-4 space-y-2">
                {aiAlerts.map((alert, i) => (
                  <div key={i} className="flex gap-2 p-3 text-xs bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] text-[var(--status-danger-text)] rounded-xl items-start">
                    <AlertCircle className="w-4 h-4 text-[var(--status-danger-icon)] shrink-0 mt-0.5" />
                    <span>{alert}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
              {aiInsights.length > 0 ? aiInsights.map((insight, i) => (
                <div key={i} className="p-3.5 bg-surface-2/60 border border-sb-hairline rounded-xl text-xs text-sb-ink leading-relaxed italic relative shadow-xs">
                  <span className="text-sb-ink-muted/30 text-3xl font-serif absolute top-1 right-2 pointer-events-none select-none">"</span>
                  <span>{insight}</span>
                </div>
              )) : (
                <EmptyState
                  icon={<Lightbulb className="w-8 h-8 text-sb-ink-muted" />}
                  title="No advice yet"
                  description="Record income and expenses for the selected month to trigger the wealth advisor."
                />
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

export default AIInsights
