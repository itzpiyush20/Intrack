// ============================================
// TransactionIdentity — merchant title + remark,
// two-line stack. Never renders raw narration as
// a merchant name; remark is omitted when empty.
// ============================================

import { cn } from '@/utils'

interface TransactionIdentityProps {
  title: string
  remark: string
  size?: 'sm' | 'md'
  className?: string
}

const titleStyles: Record<'sm' | 'md', string> = {
  sm: 'text-xs font-semibold',
  md: 'text-sm font-bold',
}

const remarkStyles: Record<'sm' | 'md', string> = {
  sm: 'text-xs',
  md: 'text-xs',
}

export default function TransactionIdentity({ title, remark, size = 'md', className }: TransactionIdentityProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn(titleStyles[size], 'text-sb-ink truncate')} title={title}>
        {title}
      </p>
      {remark && (
        <p className={cn(remarkStyles[size], 'text-sb-ink-muted truncate mt-0.5')} title={remark}>
          {remark}
        </p>
      )}
    </div>
  )
}
