// ============================================
// ReceivablesCard — money owed back to the user, due soon or overdue.
//
// Renders nothing at all when there is nothing pending. That is deliberate and
// unchanged: an empty "To receive" card on every dashboard would be a
// permanent piece of furniture reporting the absence of a thing most people
// never use. The same reasoning covers the loading pass — a skeleton that
// resolves to nothing is worse than nothing.
//
// Restyled 2026-09-06 (plans/ui-overhaul-2026-09-05.md); no behaviour change.
// The rows are a real list now, amounts use tabular figures, overdue is said
// in a word as well as in red, and "Mark received" clears 44px.
// ============================================

import { useEffect, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Card, Button, staggerParent, rowVariants, transition } from '@/components/ui'
import { useToast } from '@/context'
import { formatCurrency, formatDate } from '@/utils'
import { getActiveReceivables, settleReceivable } from '@/services/transactions'
import { HandCoins, AlertTriangle, Clock } from 'lucide-react'
import type { Database } from '@/types/database'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

interface ReceivablesCardProps {
  /** Called after a receivable is successfully settled. */
  onSettled?: () => void
}

export default function ReceivablesCard({ onSettled }: ReceivablesCardProps) {
  const { showToast } = useToast()
  const [receivables, setReceivables] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const reduce = useReducedMotion()

  const fetchReceivables = useCallback(async () => {
    const { data } = await getActiveReceivables()
    setReceivables(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchReceivables()
  }, [fetchReceivables])

  const handleSettle = async (id: string) => {
    setSettlingId(id)
    const { error } = await settleReceivable(id)
    await fetchReceivables()
    setSettlingId(null)

    if (error) {
      showToast(error.message || 'Could not mark as received. Please try again.', 'error')
      return
    }

    onSettled?.()
  }

  if (loading || receivables.length === 0) return null

  const today = new Date().toISOString().split('T')[0]

  return (
    <Card>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
        >
          <HandCoins className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-100">Owed back to you</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Spending you fronted for someone else. Marking it received files the repayment.
          </p>
        </div>
      </div>

      <motion.ul
        variants={staggerParent(reduce, receivables.length)}
        initial="initial"
        animate="animate"
        className="mt-5 space-y-2"
      >
        {receivables.map((r) => {
          const isOverdue = !!r.expected_return_date && r.expected_return_date < today
          const isDueSoon =
            !!r.expected_return_date &&
            !isOverdue &&
            new Date(r.expected_return_date).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000

          // Status is never colour alone: overdue and due-soon each carry their
          // own icon and their own word.
          const statusInk = isOverdue
            ? 'text-[var(--status-danger-text)]'
            : isDueSoon
            ? 'text-[var(--status-warning-text)]'
            : 'text-zinc-400'
          const StatusIcon = isOverdue ? AlertTriangle : Clock

          return (
            <motion.li
              key={r.id}
              variants={rowVariants(reduce)}
              transition={transition(reduce)}
              className="flex flex-col gap-3 rounded-xl border border-border-subtle/50 bg-surface-2/50 p-3.5 transition-colors hover:border-border-hover sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-100">
                  <span className="font-semibold">{r.counterparty || 'Someone'}</span> owes you{' '}
                  <span className="font-semibold tnum">{formatCurrency(Number(r.amount))}</span>
                </p>
                <p className={`mt-1 flex items-start gap-1.5 text-xs ${statusInk}`}>
                  <StatusIcon className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
                  <span>
                    {isOverdue ? 'Overdue since ' : isDueSoon ? 'Due soon — ' : 'Due '}
                    <span className="tnum">
                      {r.expected_return_date ? formatDate(r.expected_return_date) : 'no date set'}
                    </span>
                    {r.notes ? ` · ${r.notes}` : ''}
                  </span>
                </p>
              </div>
              <Button
                variant="secondary"
                loading={settlingId === r.id}
                onClick={() => handleSettle(r.id)}
                aria-label={`Mark ${formatCurrency(Number(r.amount))} from ${r.counterparty || 'someone'} as received`}
                className="h-11 w-full shrink-0 sm:w-auto"
              >
                Mark received
              </Button>
            </motion.li>
          )
        })}
      </motion.ul>
    </Card>
  )
}
