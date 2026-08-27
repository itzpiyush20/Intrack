import { Card, Badge } from '@/components/ui'
import { formatCurrency } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import { CategoryIcon } from './CategoryIcon'
import { Flame } from 'lucide-react'

interface AnomalyItem {
  category: string
  thisMonth: number
  projectedMonth: number
  isProjection: boolean
  baseline: number
  spike: number
}

interface AnomalyAlertsProps {
  anomalies: AnomalyItem[]
  onAnomalyClick?: (category: string) => void
}

export function AnomalyAlerts({ anomalies, onAnomalyClick }: AnomalyAlertsProps) {
  const { getStyle } = useCategories()
  if (anomalies.length === 0) return null

  return (
    <Card className="border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-5 h-5 text-[var(--status-warning-icon)] animate-pulse shrink-0" />
        <h2 className="text-base font-bold text-[var(--status-warning-text)]">Spending Anomaly Alerts</h2>
        <Badge variant="warning" className="ml-auto text-xs">AI Detected</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {anomalies.map((anomaly, i) => {
          const cat = getStyle(anomaly.category)
          return (
            <div
              key={i}
              className={`rounded-xl bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] p-4 ${onAnomalyClick ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''}`}
              onClick={onAnomalyClick ? () => onAnomalyClick(anomaly.category) : undefined}
              role={onAnomalyClick ? 'button' : undefined}
              tabIndex={onAnomalyClick ? 0 : undefined}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-sm font-bold text-[var(--status-warning-text)] flex items-center gap-1.5 truncate">
                  <CategoryIcon name={anomaly.category} className="text-sm shrink-0" />
                  {cat.label}
                </span>
                <Badge variant="warning" className="shrink-0">+{anomaly.spike.toFixed(0)}%</Badge>
              </div>
              {/* The percentage is measured on the month-end projection, so the
                  rupee figures next to it have to be the projection too, or the
                  three numbers on this card cannot be reconciled. */}
              <p className="text-xs text-zinc-300">
                <span className="font-semibold text-white">{formatCurrency(anomaly.thisMonth)}</span>
                {anomaly.isProjection ? ' so far — on track for ' : ' this month vs '}
                {anomaly.isProjection && (
                  <span className="font-semibold text-white">{formatCurrency(anomaly.projectedMonth)}</span>
                )}
                {anomaly.isProjection ? ' vs ' : ''}
                <span className="text-[var(--status-warning-text)] font-semibold">{formatCurrency(anomaly.baseline)}</span> baseline
              </p>
              <p className="text-xs text-[var(--status-warning-text)] mt-1 font-mono">
                {formatCurrency(anomaly.projectedMonth - anomaly.baseline)} above average
                {anomaly.isProjection ? ' at this pace' : ''}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default AnomalyAlerts
