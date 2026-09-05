// ============================================
// EmptyState — Friendly zero-data view
// ============================================

import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="bg-brand-50/70 border border-brand-200/60 h-16 w-16 flex items-center justify-center rounded-2xl mx-auto mb-4 text-3xl select-none shadow-xs text-brand-700">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-bold text-sb-ink">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-sb-ink-secondary leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
