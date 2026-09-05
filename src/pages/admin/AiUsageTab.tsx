import { Card, EmptyState } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'
import { StatCard, StatGridSkeleton, AdminError } from './adminUi'

interface AiRow {
  email: string
  ai_calls_count: number
  ai_scan_calls_count: number
}

export default function AiUsageTab() {
  const { data, loading, error, reload } = useAdminQuery<AiRow[]>('admin_ai_usage')

  if (loading) return <StatGridSkeleton count={2} />
  if (error) {
    return <AdminError message={`Could not load AI usage: ${error}`} onRetry={reload} />
  }

  const rows = data ?? []
  const totalInsight = rows.reduce((sum, r) => sum + r.ai_calls_count, 0)
  const totalScan = rows.reduce((sum, r) => sum + r.ai_scan_calls_count, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Insight calls today" value={String(totalInsight)} />
        <StatCard label="Scan calls today" value={String(totalScan)} />
      </div>

      <Card className="relative overflow-hidden p-5 border-sb-hairline shadow-card before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/25 before:to-transparent">
        <h2 className="mb-3 text-sm font-semibold text-sb-ink">Heaviest users</h2>
        {rows.length === 0 ? (
          <EmptyState icon="🤖" title="No AI calls recorded today" />
        ) : (
          <ul className="space-y-1 divide-y divide-sb-hairline/60">
            {rows.map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 py-2 text-sm text-sb-ink font-medium">
                <span className="min-w-0 truncate">{r.email}</span>
                <span className="shrink-0 tnum text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-2 text-sb-ink-muted border border-sb-hairline">{r.ai_calls_count} insight · {r.ai_scan_calls_count} scan</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-sb-ink-muted leading-relaxed border-t border-sb-hairline pt-4">
        Counts reset daily. Percentages against the daily cap are not shown: the caps are
        constants inside the AI proxy, and duplicating them here would drift from the real
        limit.
      </p>
    </div>
  )
}
