import { useMemo, useState } from 'react'
import { Modal, Button, EmptyState, TransactionIdentity } from '@/components/ui'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import { getTransactionById } from '@/services'
import { formatCurrency, formatDate, resolveTransactionIdentity } from '@/utils'
import { useDrillDown, filterTransactionsForDrillDown } from '@/context/DrillDownContext'
import type { Database } from '@/types/database'
import { Pencil, Inbox } from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

/** Narrow shape DrillDownModal needs for the list view — matches what InsightsPage's chart-data query already selects, so no new fetch is needed just to populate the list. */
interface DrillDownListItem {
  id: string
  amount: number
  type: string
  category: string
  date: string
  merchant?: string | null
  description?: string | null
}

/** Pure: given the currently visible rows and an id that was just saved, return the new visible list with that row removed. Extracted from the component so it's testable without rendering. */
export function removeSavedRow<T extends { id: string }>(visible: T[], savedId: string): T[] {
  return visible.filter((t) => t.id !== savedId)
}

interface DrillDownModalProps {
  /** The full pool of already-loaded transactions to filter against — e.g. InsightsPage's trailing-window `transactions` state. */
  transactions: DrillDownListItem[]
}

export function DrillDownModal({ transactions }: DrillDownModalProps) {
  const { isOpen, filter, label, closeDrillDown } = useDrillDown()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<TransactionRow | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const matches = useMemo(
    () => (filter ? filterTransactionsForDrillDown(transactions, filter) : []),
    [transactions, filter]
  )
  const visible = removeSavedRow(matches, '__none__').filter((t) => !removedIds.has(t.id))

  const handleClose = () => {
    closeDrillDown(dirty)
    setRemovedIds(new Set())
    setDirty(false)
    setEditingId(null)
    setEditingRow(null)
    setEditError(null)
  }

  const handleEditClick = async (id: string) => {
    setEditingId(id)
    setEditError(null)
    setEditLoading(true)
    const { data, error } = await getTransactionById(id)
    if (error || !data) {
      setEditError('Could not load this transaction. Please try again.')
      setEditLoading(false)
      return
    }
    setEditingRow(data)
    setEditLoading(false)
  }

  const handleSaved = () => {
    if (editingId) {
      setRemovedIds((prev) => new Set(prev).add(editingId))
      setDirty(true)
    }
    setEditingId(null)
    setEditingRow(null)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={label} sheet>
      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-8 h-8 text-brand-600" />}
          title="No transactions here anymore"
          description="Everything behind this number has been reviewed."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((txn) =>
            editingId === txn.id ? (
              editError ? (
                <div key={txn.id} className="p-4 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-sm text-[var(--status-danger-text)] flex items-center justify-between gap-3">
                  <span>{editError}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => handleEditClick(txn.id)}>Retry</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditError(null) }}>Cancel</Button>
                  </div>
                </div>
              ) : editLoading || !editingRow ? (
                <div key={txn.id} className="p-4 text-sm text-sb-ink-muted">Loading…</div>
              ) : (
                <ExpenseForm
                  key={txn.id}
                  editingTransaction={editingRow}
                  onSaved={handleSaved}
                  onCancel={() => { setEditingId(null); setEditingRow(null) }}
                />
              )
            ) : (
              <div key={txn.id} className="flex items-center justify-between gap-3 rounded-xl border border-sb-hairline bg-surface-1 shadow-xs p-3">
                <div className="min-w-0 flex-1">
                  <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" />
                  <p className="text-xs text-sb-ink-muted mt-0.5">{formatDate(txn.date)} · {txn.category}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-bold ${txn.type === 'credit' ? 'text-[var(--status-positive-text)]' : 'text-sb-ink'}`}>
                    {formatCurrency(txn.amount)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => handleEditClick(txn.id)} aria-label={`Edit ${resolveTransactionIdentity(txn).title}`} className="text-sb-ink-muted hover:text-sb-ink">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

export default DrillDownModal
