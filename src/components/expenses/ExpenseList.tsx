// ============================================
// ExpenseList — the ledger: every transaction in the selected range
//
// Restyle and recompose only. Every handler, every service call and the
// selection model behave exactly as before.
//
// The old list was a row of loose flex blocks, so the amounts landed wherever
// the merchant name left off and no two rows agreed on a right edge. A list of
// money that cannot be read down a column is not a ledger, it is a pile. From
// `md` up this is a real grid with a fixed template shared by the column
// header, the skeleton and every row — merchant, category, amount, date —
// so the figures line up and the eye can run down them. Below `md` the same
// row folds into a card: identity and meta on the left, amount and actions on
// the right, nothing clipped at 360px.
//
// Direction is never colour alone: the figure carries an arrow and the word
// "out" or "in", the same idiom PendingPage uses for the same fact.
// ============================================

import {
  Card, Badge, EmptyState, ConfirmDialog, TransactionIdentity, Select, Skeleton,
  ACTION_BUTTON, ACTION_BUTTON_DANGER, transition, rowVariants, staggerParent,
} from '@/components/ui'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useCategories } from '@/context/CategoriesContext'
import { cn, formatCurrency, formatDate, resolveTransactionIdentity } from '@/utils'
import { deleteTransaction, bulkDeleteTransactions, bulkUpdateTransactionsCategory } from '@/services/transactions'
import type { Database } from '@/types/database'
import { useState, useEffect, type ReactNode } from 'react'
import { Pencil, Trash2, ArrowDown, ArrowUp } from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

interface ExpenseListProps {
  transactions: TransactionRow[]
  loading: boolean
  onEdit: (transaction: TransactionRow) => void
  onRefresh: () => void
  /**
   * True when a search or filter is narrowing the list. Changes only the copy
   * of the empty state — "nothing matches" and "nothing here yet" are
   * different problems and deserve different sentences.
   */
  isFiltered?: boolean
  /** Optional call-to-action rendered in the genuinely-empty state. */
  emptyAction?: ReactNode
}

/**
 * The one column template. The header, the skeleton and every row use this
 * string, which is the whole point — three copies of a grid definition is how
 * a column header stops lining up with the column under it.
 *
 * Mobile is three columns (tick / everything / amount+actions) and the inner
 * wrappers switch to `contents` at `md` so their children become real cells.
 */
const ROW_GRID = cn(
  'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0',
  'md:grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_6.5rem_8rem_5.25rem_5rem] md:items-center md:gap-x-3',
  'lg:grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_9rem_9rem_6rem_5rem] lg:gap-x-4'
)

const ROW_PADDING = 'px-4 py-3.5 sm:px-5'

export default function ExpenseList({
  transactions,
  loading,
  onEdit,
  onRefresh,
  isFiltered = false,
  emptyAction,
}: ExpenseListProps) {
  const { categories, getStyle } = useCategories()
  const reduceMotion = useReducedMotion()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Reset selection when transactions change
  useEffect(() => {
    setSelectedIds([])
  }, [transactions])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await deleteTransaction(id)
    setDeletingId(null)
    onRefresh()
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleToggleAll = () => {
    if (selectedIds.length === transactions.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(transactions.map((t) => t.id))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    setIsBulkDeleting(true)
    try {
      await bulkDeleteTransactions(selectedIds)
      setSelectedIds([])
      onRefresh()
    } catch (err) {
      console.error('Bulk delete failed:', err)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const handleBulkCategoryUpdate = async (category: string) => {
    if (selectedIds.length === 0 || !category) return
    try {
      await bulkUpdateTransactionsCategory(selectedIds, category)
      setSelectedIds([])
      onRefresh()
    } catch (err) {
      console.error('Bulk category update failed:', err)
    }
  }

  if (loading) {
    return (
      <Card noPadding>
        <div
          role="status"
          aria-label="Loading your transactions"
          className="divide-y divide-border-subtle"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={cn(ROW_GRID, ROW_PADDING)}>
              <Skeleton shape="block" className="h-[1.125rem] w-[1.125rem] rounded-md" />
              <div className="min-w-0 md:contents">
                <div className="flex items-start gap-3 md:contents">
                  <Skeleton shape="block" className="h-9 w-9 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-3 w-24 max-w-full" />
                  </div>
                </div>
                <Skeleton className="mt-2 h-3 w-32 max-w-full md:mt-0 md:w-20" />
              </div>
              <div className="shrink-0 md:contents">
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="ml-auto hidden h-3 w-14 md:block" />
                <Skeleton className="mt-2 ml-auto h-9 w-[4.75rem] md:mt-0" shape="block" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (transactions.length === 0) {
    return (
      <Card>
        {isFiltered ? (
          <EmptyState
            icon="🔍"
            title="Nothing matches those filters"
            description="No transaction in this range matches your search. Try a shorter search term, or clear the filters to see everything again."
          />
        ) : (
          <EmptyState
            icon="💸"
            title="Nothing recorded in this range"
            description="Add a transaction by hand, or connect Gmail so bank alerts arrive here on their own."
            action={emptyAction}
          />
        )}
      </Card>
    )
  }

  const allSelected = transactions.length > 0 && selectedIds.length === transactions.length

  return (
    <>
      <Card noPadding>
        {/* Bulk action bar. Present on every size; the actions only appear once
            something is ticked, so the bar stays quiet for anyone working one
            row at a time. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-2xl border-b border-border-subtle bg-surface-2/60 px-4 py-2 sm:px-5">
          <label className="inline-flex h-11 cursor-pointer select-none items-center gap-2.5 focus-within:outline-none">
            <input
              type="checkbox"
              className="h-[1.125rem] w-[1.125rem] shrink-0 cursor-pointer rounded border-border-hover accent-[var(--brand-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              checked={allSelected}
              onChange={handleToggleAll}
              aria-label={allSelected ? 'Clear selection' : 'Select every transaction shown'}
            />
            <span className="text-xs font-medium text-zinc-400">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select all'}
            </span>
          </label>

          {selectedIds.length > 0 && (
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                <label htmlFor="bulk-category" className="sr-only">
                  Set a category for the selected transactions
                </label>
                <Select
                  id="bulk-category"
                  value=""
                  onChange={(e) => {
                    handleBulkCategoryUpdate(e.target.value)
                    e.target.value = ''
                  }}
                >
                  <option value="">Set category…</option>
                  {categories.map((cat) => (
                    <option key={cat.name} value={cat.name}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </Select>
              </div>

              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={isBulkDeleting}
                className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 text-sm font-medium text-[var(--status-danger-text)] transition-colors hover:bg-[var(--status-danger-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger-border)] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {isBulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>

        {/* Column header — only where the columns actually exist. It is what
            makes the alignment below read as deliberate rather than lucky. */}
        <div
          aria-hidden="true"
          className={cn(
            ROW_GRID,
            'hidden border-b border-border-subtle px-4 py-2 text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-5 md:grid'
          )}
        >
          <span />
          <span />
          <span>Transaction</span>
          <span>Category</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Date</span>
          <span className="text-right">Actions</span>
        </div>

        <motion.ul
          className="divide-y divide-border-subtle"
          variants={staggerParent(reduceMotion, Math.min(transactions.length, 12))}
          initial="initial"
          animate="animate"
        >
          <AnimatePresence initial={false}>
            {transactions.map((txn) => {
              const cat = getStyle(txn.category)
              const isDebit = txn.type === 'debit'
              const identity = resolveTransactionIdentity(txn)
              const isSelected = selectedIds.includes(txn.id)

              return (
                <motion.li
                  key={txn.id}
                  layout={!reduceMotion}
                  variants={rowVariants(reduceMotion)}
                  exit="exit"
                  transition={transition(reduceMotion)}
                  className={cn(
                    ROW_GRID,
                    ROW_PADDING,
                    'transition-colors',
                    isSelected ? 'bg-brand-500/[0.05]' : 'hover:bg-surface-2/50'
                  )}
                >
                  {/* Tick. The 44px target is the padded label around it, so the
                      grid column stays as narrow as the box itself. */}
                  <label className="-mt-2 flex h-11 w-5 cursor-pointer items-center justify-center md:-my-3">
                    <input
                      type="checkbox"
                      className="h-[1.125rem] w-[1.125rem] shrink-0 cursor-pointer rounded border-border-hover accent-[var(--brand-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(txn.id)}
                      aria-label={`Select ${identity.title}`}
                    />
                  </label>

                  {/* Identity block. `md:contents` dissolves these wrappers so
                      the tile, the name and the category become real columns
                      once there is room for them. */}
                  <div className="min-w-0 md:contents">
                    <div className="flex items-start gap-3 md:contents">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
                        style={{ backgroundColor: `${cat.color}15` }}
                      >
                        {cat.emoji}
                      </span>

                      <div className="min-w-0 flex-1">
                        <TransactionIdentity {...identity} size="md" />
                        {txn.tags && txn.tags.length > 0 && (
                          <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                            {txn.tags.map((tag, idx) => (
                              <li key={idx} className="text-xs font-medium text-zinc-400">
                                #{tag}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* Below md the date and category live here, under the
                        name, because there are no columns to put them in. */}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 md:hidden">
                      <span className="tnum">{formatDate(txn.date)}</span>
                      <span aria-hidden="true" className="text-zinc-500">·</span>
                      <span className="truncate">{cat.emoji} {cat.label}</span>
                    </p>

                    <div className="hidden min-w-0 md:block">
                      <Badge className="max-w-full truncate" title={cat.label}>
                        {cat.label}
                      </Badge>
                    </div>
                  </div>

                  {/* Amount, date and actions. Same trick: one right-hand stack
                      on a phone, three aligned columns on a desk. */}
                  <div className="shrink-0 md:contents">
                    <div className="text-right">
                      <p
                        className={cn(
                          'tnum text-sm font-semibold tracking-tight',
                          isDebit ? 'text-zinc-50' : 'text-[var(--status-positive-text)]'
                        )}
                      >
                        {formatCurrency(Number(txn.amount))}
                      </p>
                      {/* Never colour alone: an arrow and a word carry the
                          direction for anyone who cannot separate the two
                          greens and reds. */}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-zinc-400">
                        {isDebit ? (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        {isDebit ? 'out' : 'in'}
                      </p>
                    </div>

                    <p className="tnum hidden text-right text-xs text-zinc-400 md:block">
                      {formatDate(txn.date)}
                    </p>

                    <div className="mt-2 flex items-center justify-end gap-0.5 md:mt-0">
                      <button
                        type="button"
                        onClick={() => onEdit(txn)}
                        aria-label={`Edit ${identity.title}`}
                        title="Edit"
                        className={cn(ACTION_BUTTON, 'h-11 w-11 md:h-9 md:w-9')}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(txn.id)}
                        disabled={deletingId === txn.id}
                        aria-label={`Delete ${identity.title}`}
                        title="Delete"
                        className={cn(
                          ACTION_BUTTON_DANGER,
                          'h-11 w-11 md:h-9 md:w-9 disabled:opacity-50'
                        )}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </motion.ul>
      </Card>

      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          if (confirmDeleteId) await handleDelete(confirmDeleteId)
          setConfirmDeleteId(null)
        }}
        title="Delete this transaction?"
        message="It will be removed from your history, and from every total and budget it counted towards. This cannot be undone."
        confirmLabel="Delete"
      />

      <ConfirmDialog
        isOpen={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={async () => {
          await handleBulkDelete()
          setConfirmBulkDelete(false)
        }}
        title={`Delete ${selectedIds.length} transaction${selectedIds.length === 1 ? '' : 's'}?`}
        message="They will be removed from your history, and from every total and budget they counted towards. This cannot be undone."
        confirmLabel="Delete"
      />
    </>
  )
}
