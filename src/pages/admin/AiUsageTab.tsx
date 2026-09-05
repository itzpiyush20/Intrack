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

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Heaviest users</h2>
        {rows.length === 0 ? (
          <EmptyState icon="🤖" title="No AI calls recorded today" />
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 py-1 text-sm text-zinc-300">
                <span className="min-w-0 truncate">{r.email}</span>
                <span className="shrink-0 tnum text-zinc-500">{r.ai_calls_count} insight · {r.ai_scan_calls_count} scan</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-zinc-500 leading-relaxed">
        Counts reset daily. Percentages against the daily cap are not shown: the caps are
        constants inside the AI proxy, and duplicating them here would drift from the real
        limit.
      </p>
    </div>
  )
}
