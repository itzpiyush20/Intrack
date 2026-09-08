// ============================================
// NewTransactionModal — pop-up wrapper around the Add Transaction form.
//
// Triggered from the "Add Transaction" CTA in app header, mobile bottom nav,
// or page empty states. Includes quick-add defaults plus an expandable
// "More details" section for date, tags, notes, and receivables.
// ============================================

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Input, Select, transition } from '@/components/ui'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import TagPicker from '@/components/tags/TagPicker'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { createTransaction } from '@/services/transactions'
import { getCards } from '@/services/cards'
import { KNOWN_MERCHANTS } from '@/services/merchantNormalizer'
import { toISODateLocal } from '@/utils/dateFilter'
import type { Card as CardRow } from '@/types'
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
  UserCheck,
} from 'lucide-react'

const FALLBACK_CATEGORIES = ['Food & Dining', 'Transport', 'Shopping', 'Utilities & Bills']

interface NewTransactionModalProps {
  open: boolean
  onClose: () => void
  /** Called after a transaction is successfully saved so the parent can refresh data. */
  onAdded?: () => void
}

/** Chip and segmented-control shell. */
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
  const [merchant, setMerchant] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [type, setType] = useState<'debit' | 'credit'>('debit')
  const [date, setDate] = useState(() => toISODateLocal(new Date()))
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [isReturnable, setIsReturnable] = useState(false)
  const [counterparty, setCounterparty] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState(() =>
    toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [userCards, setUserCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState('')

  useEffect(() => {
    getCards().then(({ data }) => {
      if (data) setUserCards(data.filter((c) => !c.is_archived))
    })
  }, [])

  const resetForm = () => {
    setAmount('')
    setMerchant('')
    setDescription('')
    setCategory('')
    setCardId('')
    setShowMore(false)
    setShowDetails(false)
    setError('')
    setType('debit')
    setDate(toISODateLocal(new Date()))
    setTags([])
    setNotes('')
    setIsReturnable(false)
    setCounterparty('')
    setExpectedReturnDate(toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)))
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

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
    const effectiveDesc =
      description.trim() ||
      merchant.trim() ||
      getStyle(category).label ||
      'Transaction'

    const { error: createError } = await createTransaction({
      user_id: user.id,
      type,
      amount: parsedAmount,
      category,
      description: effectiveDesc,
      merchant: merchant.trim() || null,
      date: date || toISODateLocal(new Date()),
      source: 'manual',
      approval_status: 'approved',
      card_id: type === 'debit' && cardId ? cardId : null,
      category_confirmed_at: new Date().toISOString(),
      tags: tags.length > 0 ? tags : null,
      notes: notes.trim() || null,
      is_returnable: type === 'debit' && isReturnable,
      counterparty: type === 'debit' && isReturnable ? counterparty.trim() || null : null,
      expected_return_date: type === 'debit' && isReturnable ? expectedReturnDate : null,
      return_status: type === 'debit' && isReturnable ? 'pending' : null,
    })
    setSaving(false)

    if (createError) {
      setError(createError.message)
      return
    }

    window.dispatchEvent(new CustomEvent('intrack:transaction-added'))
    showToast('Transaction added')
    resetForm()
    onAdded?.()
    onClose()
  }

  /** Whether the chosen category is one the chips are not showing. */
  const pickedFromList = !!category && !chips.includes(category)

  return (
    <Modal isOpen={open} onClose={handleClose} title="Add Transaction" sheet>
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

        {/* Amount + Merchant */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div ref={amountFieldRef} className="sm:w-44 sm:shrink-0">
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder={`Amount (${currencySymbol})`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Amount in ${currencySymbol}`}
              className="tnum"
              required
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              type="text"
              placeholder="Merchant (e.g. Swiggy, Amazon)"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              aria-label="Merchant name"
              list="modal-merchant-suggestions"
            />
            <datalist id="modal-merchant-suggestions">
              {KNOWN_MERCHANTS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Description (Optional) */}
        <div>
          <Input
            type="text"
            placeholder="What was it for? (optional description)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
          />
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

        {/* Card selection (for debit) */}
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

        {/* Expandable "More details" Accordion */}
        <div className="border-t border-sb-hairline pt-3">
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="flex w-full items-center justify-between text-xs font-semibold text-sb-ink-muted hover:text-sb-ink transition-colors py-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-lg"
            aria-expanded={showDetails}
          >
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
              <span>More options (Date, Tags, Notes{type === 'debit' ? ', Split' : ''})</span>
            </span>
            {showDetails ? (
              <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
          </button>

          {showDetails && (
            <motion.div
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={transition(reduce)}
              className="mt-3 space-y-4 overflow-hidden pt-1"
            >
              {/* Custom Date */}
              <div>
                <Input
                  type="date"
                  label="Date"
                  id="ntm-date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="tnum"
                  aria-label="Transaction date"
                />
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sb-ink-muted flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tags</span>
                </label>
                <TagPicker tags={tags} onChange={setTags} />
              </div>

              {/* Notes */}
              <div>
                <Input
                  type="text"
                  label="Notes / Remarks"
                  id="ntm-notes"
                  placeholder="Additional context or remarks"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  aria-label="Notes"
                />
              </div>

              {/* Returnable / Split tracker (debit only) */}
              {type === 'debit' && (
                <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isReturnable}
                      onChange={(e) => setIsReturnable(e.target.checked)}
                      className="h-4 w-4 rounded border-sb-hairline text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-xs font-semibold text-sb-ink flex items-center gap-1.5">
                      <UserCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                      <span>I expect this money back (split or advance)</span>
                    </span>
                  </label>

                  {isReturnable && (
                    <div className="grid gap-3 sm:grid-cols-2 pt-1">
                      <Input
                        type="text"
                        label="Who owes you?"
                        id="ntm-counterparty"
                        placeholder="e.g. Rahul Sharma"
                        value={counterparty}
                        onChange={(e) => setCounterparty(e.target.value)}
                        required={isReturnable}
                      />
                      <Input
                        type="date"
                        label="Expected return date"
                        id="ntm-expected-date"
                        value={expectedReturnDate}
                        onChange={(e) => setExpectedReturnDate(e.target.value)}
                        className="tnum"
                      />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </div>

        <Button
          type="submit"
          loading={saving}
          className="h-11 w-full gap-1.5 mt-2 font-semibold shadow-xs"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add Transaction
        </Button>
      </form>
    </Modal>
  )
}
