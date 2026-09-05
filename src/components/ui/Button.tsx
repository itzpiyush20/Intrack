// ============================================
// Button — Multi-variant action button
// ============================================

import { cn } from '@/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] font-semibold',
    'shadow-[var(--shadow-sm)]',
    'hover:bg-[var(--btn-primary-bg-hover)]',
    'active:bg-[var(--btn-primary-bg-active)] active:scale-[0.98]',
    'transition-[background-color,transform,box-shadow] duration-200',
  ].join(' '),
  secondary: [
    'bg-surface-1 border border-sb-hairline',
    'text-sb-ink font-medium shadow-xs',
    'hover:bg-surface-2 hover:border-border-default',
    'active:scale-[0.98]',
    'transition-[background-color,border-color,transform,box-shadow] duration-200',
  ].join(' '),
  ghost: [
    'text-sb-ink-muted font-medium',
    'hover:text-sb-ink hover:bg-surface-2',
    'active:bg-surface-3 active:scale-[0.98]',
    'transition-[color,background-color,transform] duration-200',
  ].join(' '),
  danger: [
    'bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)]',
    'text-[var(--status-danger-text)]',
    'hover:bg-[var(--status-danger-border)] hover:border-[var(--status-danger-text)]/40',
    'active:opacity-80 active:scale-[0.98]',
    'transition-[background-color,border-color,opacity,transform] duration-200',
  ].join(' '),
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-10 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2.5',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium select-none',
        'focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2',
        'disabled:opacity-45 disabled:pointer-events-none disabled:saturate-50',
        variantStyles[variant],
        sizeStyles[size],
        block && 'w-full',
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
