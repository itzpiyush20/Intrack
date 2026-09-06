// ============================================
// Badge — Status & category labels
// ============================================

import { cn } from '@/utils'
import type { ReactNode, HTMLAttributes } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'aurora'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  variant?: BadgeVariant
  size?: 'sm' | 'md'
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-2 text-sb-ink-secondary border-sb-hairline',
  success: 'bg-brand-50 text-brand-700 border-brand-200/80 shadow-xs',
  warning: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]',
  danger:  'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]',
  info:    'bg-[var(--status-info-subtle)] text-[var(--status-info-text)] border-[var(--status-info-border)]',
  aurora:  'bg-brand-50 text-brand-700 border-brand-200/80 shadow-xs',
}

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-0.5 text-xs',
}

export default function Badge({ children, variant = 'default', size = 'md', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border font-medium',
        'transition-colors duration-200',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
