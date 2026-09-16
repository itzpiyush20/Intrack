// ============================================
// TransactionForm — the one Add / Edit Transaction form.
//
// Owner decision 2026-09-16: adding or editing a transaction looks the same
// everywhere. The layout is the home-page popup's (amount + merchant, category
// chips, extras folded under "More options"); it is used by the app-wide
// NewTransactionModal, the Expenses page add/edit sheet and the Insights
// drill-down edit. It also carries everything the old Expenses-page form did:
// editing, the card a credit card bill settles, and where a loan came from.
// Do not add a second form — new fields go here.
// ============================================

import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Input, Select, transition } from '@/components/ui'
import Button from '@/components/ui/Button'
import TagPicker from '@/components/tags/TagPicker'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { createTransaction, updateTransaction } from '@/services/transactions'
import { getCards } from '@/services/cards'
import MerchantPicker from '@/components/merchants/MerchantPicker'
import { toISODateLocal } from '@/utils/dateFilter'
import { creditCardBillCategoryNames, makeIsCreditCardBill } from '@/utils/creditCardBill'
import type { Card as CardRow, LoanSource } from '@/types'
import type { Database } from '@/types/database'
import {
  Plus,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
  UserCheck,
} from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

const FALLBACK_CATEGORIES = ['Food & Dining', 'Transport', 'Shopping', 'Utilities & Bills']

const inThirtyDays = () => toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

export interface TransactionFormProps {
  /** Pass a full row to edit it; omit to add a new transaction. */
  editingTransaction?: TransactionRow | null
  /** Called after a successful save. `created` is false for an edit. */
  onSaved: (result: { created: boolean }) => void
  /** Shows a Cancel button when given (inline and sheet uses). */
  onCancel?: () => void
}

/** Chip and segmented-control shell. */
const CHIP_BASE =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ' +
  'transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-500/40'

export default function TransactionForm({ editingTransaction, onSaved, onCancel }: TransactionFormProps) {
  const { user, currencySymbol } = useAuth()
  const { categories, getStyle } = useCategories()
  const amountFieldRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const editing = editingTransaction ?? null
  const isEditing = !!editing

  const [amount, setAmount] = useState(editing?.amount != null ? String(editing.amount) : '')
  const [merchant, setMerchant] = useState(editing?.merchant || '')
  const [merchantId, setMerchantId] = useState<string | null>(editing?.merchant_id ?? null)
  const [description, setDescription] = useState(editing?.description || '')
  const [category, setCategory] = useState(editing?.category || '')
  const [showMore, setShowMore] = useState(false)
  // An edit opens the fold so the saved date, tags and notes are in view.
  const [showDetails, setShowDetails] = useState(isEditing)
  const [type, setType] = useState<'debit' | 'credit'>(editing?.type === 'credit' ? 'credit' : 'debit')
  const [date, setDate] = useState(() => editing?.date || toISODateLocal(new Date()))
  const [tags, setTags] = useState<string[]>(editing?.tags?.filter(Boolean) || [])
  const [notes, setNotes] = useState(editing?.notes || '')
  const [isReturnable, setIsReturnable] = useState(editing?.is_returnable || false)
  const [counterparty, setCounterparty] = useState(editing?.counterparty || '')
  const [expectedReturnDate, setExpectedReturnDate] = useState(() => editing?.expected_return_date || inThirtyDays())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [userCards, setUserCards] = useState<CardRow[]>([])
  const [cardId, setCardId] = useState(editing?.card_id || '')
  const [settlesCardId, setSettlesCardId] = useState(editing?.settles_card_id || '')
  const [loanSource, setLoanSource] = useState<LoanSource | ''>((editing?.loan_source as LoanSource) || '')
  const [loanSourceNote, setLoanSourceNote] = useState(editing?.loan_source_note || '')

  useEffect(() => {
    let alive = true
    getCards().then(({ data }) => {
      if (alive && data) setUserCards(data.filter((c) => !c.is_archived))
    })
    return () => {
      alive = false
    }
  }, [])

  const isCreditCardBill = useMemo(
    () => makeIsCreditCardBill(creditCardBillCategoryNames(categories)),
    [categories]
  )
  const isCardBill = isCreditCardBill(category)
  const isLoan = category.toLowerCase() === 'loan'

  // Top 4 categories shown as chips (fallback if categories not yet loaded)
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
    const returnable = type === 'debit' && isReturnable
    if (returnable && (!counterparty.trim() || !expectedReturnDate)) {
      setShowDetails(true)
      setError('Say who owes this and when you expect it back.')
      return
    }
    if (isLoan && !loanSource) {
      setError('Select the source of this loan.')
      return
    }
    if (isLoan && loanSource === 'credit_card' && userCards.length > 0 && !cardId) {
      setError('Select which credit card provided this advance.')
      return
    }
    if (isLoan && loanSource === 'other' && !loanSourceNote.trim()) {
      setError('Specify who provided the loan.')
      return
    }

    setSaving(true)
    const effectiveDesc =
      description.trim() ||
      merchant.trim() ||
      getStyle(category).label ||
      'Transaction'

    // Same routing rules the old Expenses form applied: a card bill records the
    // card it settles, never a paying card; a loan keeps its card only when the
    // advance came from one.
    const effectiveCardId = isCardBill ? null : (cardId || null)
    const fields = {
      type,
      amount: parsedAmount,
      category,
      description: effectiveDesc,
      merchant: merchant.trim() || null,
      merchant_id: merchantId,
      date: date || toISODateLocal(new Date()),
      card_id: isLoan && loanSource !== 'credit_card' ? null : effectiveCardId,
      settles_card_id: isCardBill ? (settlesCardId || null) : null,
      loan_source: isLoan ? (loanSource as LoanSource) : null,
      loan_source_note: isLoan && loanSource === 'other' ? loanSourceNote.trim() : null,
      tags: tags.length > 0 ? tags : null,
      notes: notes.trim() || null,
      is_returnable: returnable,
      counterparty: returnable ? counterparty.trim() || null : null,
      expected_return_date: returnable ? expectedReturnDate : null,
      // A manual add or edit is an explicit human confirmation of the category.
      category_confirmed_at: new Date().toISOString(),
    }

    const { error: saveError } = editing
      ? await updateTransaction(editing.id, {
          ...fields,
          return_status: returnable ? (editing.return_status || 'pending') : null,
        })
      : await createTransaction({
          ...fields,
          user_id: user.id,
          source: 'manual',
          approval_status: 'approved',
          return_status: returnable ? 'pending' : null,
        })
    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved({ created: !editing })
  }

  /** Whether the chosen category is one the chips are not showing. */
  const pickedFromList = !!category && !chips.includes(category)

  return (
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
          <MerchantPicker
            id="ntm-merchant"
            label="Merchant"
            hideLabel
            placeholder="Merchant (e.g. Swiggy, Amazon)"
            value={{ text: merchant, merchantId }}
            onChange={({ text, merchantId: id, defaultCategory }) => {
              setMerchant(text)
              setMerchantId(id)
              // Fill only an empty category — never overwrite the user's pick.
              if (defaultCategory && !category) setCategory(defaultCategory)
            }}
          />
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

      {/* Paying account. Hidden for a card bill (it settles a card instead) and
          a loan (its card, if any, is chosen in the loan section). */}
      {userCards.length > 0 && !isCardBill && !isLoan && (
        <div className="pt-1">
          <Select
            label="Account / Card"
            id="ntm-card"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
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

      {isCardBill && userCards.length > 0 && (
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3.5 space-y-1.5">
          <Select
            label="Card settled by this payment"
            id="ntm-settles-card"
            options={[
              { value: '', label: 'Select card being settled' },
              ...userCards.map((c) => ({
                value: c.id,
                label: `${c.name} (•••• ${c.last4})`,
              })),
            ]}
            value={settlesCardId}
            onChange={(e) => setSettlesCardId(e.target.value)}
          />
          <p className="text-xs text-sb-ink-muted">
            Paying this bill reduces what you owe on this card and is excluded from duplicate expenses.
          </p>
        </div>
      )}

      {isLoan && (
        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5 space-y-3">
          <Select
            label="Source of loan"
            id="ntm-loan-source"
            options={[
              { value: '', label: 'Select loan source' },
              { value: 'bank', label: 'Bank (personal loan, overdraft)' },
              { value: 'credit_card', label: 'Credit card (cash advance / wallet transfer)' },
              { value: 'family_friend', label: 'Family or friend' },
              { value: 'other', label: 'Other source' },
            ]}
            value={loanSource}
            onChange={(e) => setLoanSource(e.target.value as LoanSource)}
            required
          />

          {loanSource === 'credit_card' && userCards.length > 0 && (
            <Select
              label="Which credit card"
              id="ntm-loan-card"
              options={[
                { value: '', label: 'Select card used for advance' },
                ...userCards.map((c) => ({
                  value: c.id,
                  label: `${c.name} (•••• ${c.last4})`,
                })),
              ]}
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              required
            />
          )}

          {loanSource === 'other' && (
            <Input
              label="Lender details"
              id="ntm-loan-note"
              placeholder="Who lent this money?"
              value={loanSourceNote}
              onChange={(e) => setLoanSourceNote(e.target.value)}
              required
            />
          )}
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
                      min={date}
                      className="tnum"
                    />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button
          type="submit"
          loading={saving}
          className="h-11 w-full gap-1.5 mt-2 font-semibold shadow-xs sm:flex-1"
        >
          {isEditing ? (
            <><Check className="h-4 w-4 shrink-0" aria-hidden="true" /> Save changes</>
          ) : (
            <><Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add Transaction</>
          )}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full justify-center sm:mt-2 sm:w-auto"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
