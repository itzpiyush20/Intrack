// ============================================
// NewTransactionModal — pop-up wrapper around the quick-add form.
//
// Triggered from the compact "+ New Transaction" button in the app header.
// Keeps the same fields and validation as the old QuickAddWidget; the only
// difference is that the form now lives in a Modal instead of a Card on the
// Dashboard body.
// ============================================

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Input, Select, transition } from '@/components/ui'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { createTransaction } from '@/services/transactions'
import { getCards } from '@/services/cards'
import type { Card as CardRow } from '@/types'
import { Plus, ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react'

const FALLBACK_CATEGORIES = ['Food & Dining', 'Transport', 'Shopping', 'Utilities & Bills']

interface NewTransactionModalProps {
  open: boolean
  onClose: () => void
  /** Called after a transaction is successfully saved so the parent can refresh data. */
  onAdded: () => void
}

/** Chip and segmented-control shell — matches QuickAddWidget exactly. */
const CHIP_BASE =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ' +
  'transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-500/40'

export default function NewTransactionModal({ open, onClose, onAdded }: NewTransactionModalProps) {
  const { user, currencySymbol } = useAuth()
  const { categories, getStyle } = useCategories()
  const { showToast } = useToast()
  const amountFieldRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [type, setType] = useState<'debit' | 'credit'>('debit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [userCards, setUserCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState('')

  useEffect(() => {
    getCards().then(({ data }) => {
      if (data) setUserCards(data.filter((c) => !c.is_archived))
    })
  }, [])

  // Reset form state whenever the modal opens
  useEffect(() => {
    if (open) {
      setAmount('')
      setDescription('')
      setCategory('')
      setCardId('')
      setShowMore(false)
      setError('')
      setType('debit')
    }
  }, [open])

  // Top 4 most-used categories shown as chips (fallback if categories not yet loaded)
  const chips = (
    categories.length > 0
      ? categories.slice(0, 4).map((c) => c.name)
      : FALLBACK_CATEGORIES
  ).slice(0, 4)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError('')

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (!category) {
      setError('Pick a category so this lands in the right place.')
      return
    }

    setSaving(true)
    const { error: createError } = await createTransaction({
      user_id: user.id,
      type,
      amount: parsedAmount,
      category,
      description: description || getStyle(category).label || 'Transaction',
      date: new Date().toISOString().split('T')[0],
      source: 'manual',
      approval_status: 'approved',
      card_id: type === 'debit' && cardId ? cardId : null,
      category_confirmed_at: new Date().toISOString(),
    })
    setSaving(false)

    if (createError) {
      setError(createError.message)
      return
    }

    window.dispatchEvent(new CustomEvent('intrack:transaction-added'))
    showToast('Transaction added')
    onAdded()
    onClose()
  }

  /** Whether the chosen category is one the chips are not showing. */
  const pickedFromList = !!category && !chips.includes(category)

  return (
    <Modal isOpen={open} onClose={onClose} title="New Transaction" sheet>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Expense / Income toggle */}
        <div
          role="group"
          aria-label="Money in or out"
          className="flex items-center rounded-xl border border-sb-hairline bg-surface-2/70 p-1 shadow-xs w-fit"
        >
          <button
            type="button"
            onClick={() => setType('debit')}
            aria-pressed={type === 'debit'}
            className={`${CHIP_BASE} border-transparent transition-colors ${
              type === 'debit'
                ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)] font-semibold shadow-xs'
                : 'text-sb-ink-muted hover:text-sb-ink'
            }`}
          >
            <ArrowDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Expense
          </button>
          <button
            type="button"
            onClick={() => setType('credit')}
            aria-pressed={type === 'credit'}
            className={`${CHIP_BASE} border-transparent transition-colors ${
              type === 'credit'
                ? 'bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)] font-semibold shadow-xs'
                : 'text-sb-ink-muted hover:text-sb-ink'
            }`}
          >
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Income
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 py-2.5 text-sm text-[var(--status-danger-text)]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            {error}
          </p>
        )}

        {/* Amount + description */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div ref={amountFieldRef} className="sm:w-44 sm:shrink-0">
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder={`Amount in ${currencySymbol}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Amount in ${currencySymbol}`}
              className="tnum"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              type="text"
              placeholder="What was it for? (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="What was it for"
            />
          </div>
        </div>

        {/* Category chips */}
        <div>
          <p id="ntm-category-label" className="mb-2 text-xs font-semibold uppercase tracking-wider text-sb-ink-muted">
            Category
          </p>
          <div role="group" aria-labelledby="ntm-category-label" className="flex flex-wrap gap-2">
            {chips.map((code) => {
              const cat = categories.find((c) => c.name === code)
              if (!cat) return null
              const selected = category === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => { setCategory(code); setShowMore(false) }}
                  aria-pressed={selected}
                  className={`${CHIP_BASE} transition-all ${
                    selected
                      ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 font-bold shadow-xs'
                      : 'border-sb-hairline bg-surface-1 text-sb-ink-secondary hover:border-brand-500/30 hover:text-sb-ink'
                  }`}
                >
                  <span aria-hidden="true">{cat.emoji}</span> {cat.name}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-pressed={showMore || pickedFromList}
              aria-expanded={showMore}
              className={`${CHIP_BASE} transition-all ${
                showMore || pickedFromList
                  ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 font-bold shadow-xs'
                  : 'border-sb-hairline bg-surface-1 text-sb-ink-secondary hover:border-brand-500/30 hover:text-sb-ink'
              }`}
            >
              {pickedFromList && !showMore ? `${getStyle(category).emoji} ${getStyle(category).label}` : 'Something else'}
            </button>
          </div>
        </div>

        {showMore && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition(reduce)}
          >
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
              placeholder="Choose a category"
              options={categories.map((cat) => ({
                value: cat.name,
                label: `${cat.emoji} ${cat.name}`,
              }))}
            />
          </motion.div>
        )}

        {userCards.length > 0 && type === 'debit' && (
          <div className="pt-1">
            <Select
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              aria-label="Payment account or card"
              options={[
                { value: '', label: 'Cash in hand & Bank balance' },
                ...userCards.map((c) => ({
                  value: c.id,
                  label: `Credit Card — ${c.name} (•••• ${c.last4})`,
                })),
              ]}
            />
          </div>
        )}

        <Button
          type="submit"
          loading={saving}
          className="h-11 w-full gap-1.5 mt-2"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add transaction
        </Button>
      </form>
    </Modal>
  )
}
