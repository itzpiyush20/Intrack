// ============================================
// Card — Clean surface container
// ============================================

import { cn } from '@/utils'
import type { ReactNode, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  noPadding?: boolean
  hoverable?: boolean
}

export default function Card({
  children,
  noPadding = false,
  hoverable = false,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        // Base — solid surface, hairline border, soft neutral elevation
        'rounded-2xl border bg-surface-1 border-border-subtle shadow-[var(--shadow-sm)]',
        'transition-[box-shadow,border-color,transform] duration-[220ms] ease-[cubic-bezier(0.33,1,0.68,1)]',
        !noPadding && 'p-5 md:p-6',
        // Hoverable — border + elevation shift, no colored glow
        hoverable && 'cursor-pointer active:scale-[0.99] active:border-border-hover hover:border-border-hover hover:shadow-[var(--shadow-md)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
