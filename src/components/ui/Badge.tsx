// ============================================
// Badge — Status & category labels
// ============================================

import { cn } from '@/utils'
import type { ReactNode, HTMLAttributes } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'aurora'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-2 text-sb-ink-secondary border-sb-hairline',
  success: 'bg-brand-50 text-brand-700 border-brand-200/80 shadow-xs',
  warning: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]',
  danger:  'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]',
  info:    'bg-[var(--status-info-subtle)] text-[var(--status-info-text)] border-[var(--status-info-border)]',
  aurora:  'bg-brand-50 text-brand-700 border-brand-200/80 shadow-xs',
}

export default function Badge({ children, variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-xs font-medium',
        'transition-colors duration-200',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
