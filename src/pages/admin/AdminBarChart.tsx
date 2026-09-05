// ============================================
// AdminBarChart — counts over time, no dependency.
// ============================================

interface Props {
  data: { label: string; value: number }[]
  emptyMessage: string
}

export default function AdminBarChart({ data, emptyMessage }: Props) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-sb-ink-muted">{emptyMessage}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {data.map((d) => (
        <div key={d.label} className="flex min-w-[10px] flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-gradient-to-t from-brand-600 to-brand-400 shadow-xs"
            style={{ height: `${(d.value / max) * 100}%` }}
            title={`${d.label}: ${d.value}`}
          />
        </div>
      ))}
    </div>
  )
}
