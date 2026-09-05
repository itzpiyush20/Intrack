// ============================================
// Input — Styled form input
// ============================================

import { cn } from '@/utils'
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export default function Input({
  label,
  error,
  icon,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sb-ink-muted">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(
            'h-11 w-full rounded-xl border bg-surface-1 px-4 text-sm text-sb-ink font-medium shadow-xs',
            'placeholder:text-sb-ink-muted/70',
            'transition-[border-color,box-shadow] duration-150',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500',
            error
              ? 'border-[var(--status-danger-border)] focus:ring-[var(--status-danger-subtle)] focus:border-[var(--status-danger-text)]'
              : 'border-sb-hairline hover:border-brand-500/40',
            icon ? 'pl-10' : '',
            className
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" aria-live="assertive" className="text-xs text-[var(--status-danger-text)]">{error}</p>
      )}
    </div>
  )
}
