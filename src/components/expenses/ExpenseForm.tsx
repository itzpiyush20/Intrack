// ============================================
// ExpenseForm — add or edit one transaction
//
// Restyle and recompose only: every field, every validation and both save
// paths behave exactly as before.
//
// The form is grouped rather than listed. The old shape was six equal
// two-column rows, which made "what is this and how much" look no more
// important than "tags". Now the amount and its direction lead, the identity
// of the spend follows, and the optional parts (tags, money you expect back,
// remarks) sit below a rule so they read as optional.
//
// Direction is chosen with two real radio-style buttons rather than a
// dropdown of coloured dots: it is a binary with consequences elsewhere on
// the form (the returnable block only exists for expenses), and a control
// that shows both options at once is honest about that.
// ============================================

import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Button, Input, Select } from '@/components/ui'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { createTransaction, updateTransaction } from '@/services'
import { getCards } from '@/services/cards'
import TagPicker from '@/components/tags/TagPicker'
import type { Card, LoanSource } from '@/types'
import { creditCardBillCategoryNames, makeIsCreditCardBill } from '@/utils/creditCardBill'
import type { Database } from '@/types/database'
import { KNOWN_MERCHANTS } from '@/services/merchantNormalizer'
import { toISODateLocal } from '@/utils/dateFilter'
import { cn } from '@/utils'
import { ArrowDownLeft, ArrowUpRight, AlertTriangle } from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

interface ExpenseFormProps {
  /** Pass existing transaction to enable edit mode */
  editingTransaction?: TransactionRow | null
  /** Called after successful save */
  onSaved: () => void
  /** Called to cancel editing */
  onCancel?: () => void
}

const DIRECTIONS = [
  { value: 'debit', label: 'Money out', hint: 'An expense', icon: ArrowUpRight },
  { value: 'credit', label: 'Money in', hint: 'Income', icon: ArrowDownLeft },
] as const

export default function ExpenseForm({ editingTransaction, onSaved, onCancel }: ExpenseFormProps) {
  const { user, currencySymbol } = useAuth()
  const { categories, fallbackCategory } = useCategories()
  const isEditing = !!editingTransaction
  const defaultCategory = fallbackCategory?.name || 'Other'

  const categoryOptions = categories.map((c) => ({
    value: c.name,
    label: `${c.emoji} ${c.name}`,
  }))

  const [type, setType] = useState<string>(editingTransaction?.type || 'debit')
  const [amount, setAmount] = useState(editingTransaction?.amount?.toString() || '')
  const [category, setCategory] = useState(editingTransaction?.category || defaultCategory)
  const [description, setDescription] = useState(editingTransaction?.description || '')
  const [merchant, setMerchant] = useState(editingTransaction?.merchant || '')
  const [tags, setTags] = useState<string[]>(
    editingTransaction?.tags?.filter(Boolean) || []
  )
  const [date, setDate] = useState(
    editingTransaction?.date || toISODateLocal(new Date())
  )
  const [isReturnable, setIsReturnable] = useState(editingTransaction?.is_returnable || false)
  const [counterparty, setCounterparty] = useState(editingTransaction?.counterparty || '')
  const [expectedReturnDate, setExpectedReturnDate] = useState(
    editingTransaction?.expected_return_date ||
    toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  )
  const [notes, setNotes] = useState(editingTransaction?.notes || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [userCards, setUserCards] = useState<Card[]>([])
  const [cardId, setCardId] = useState(editingTransaction?.card_id || '')
  const [settlesCardId, setSettlesCardId] = useState(editingTransaction?.settles_card_id || '')
  const [loanSource, setLoanSource] = useState<LoanSource | ''>(
    (editingTransaction?.loan_source as LoanSource) || ''
  )
  const [loanSourceNote, setLoanSourceNote] = useState(editingTransaction?.loan_source_note || '')

  useEffect(() => {
    getCards().then(({ data }) => {
      if (data) setUserCards(data.filter((c) => !c.is_archived))
    })
  }, [])

  const isCreditCardBill = useMemo(
    () => makeIsCreditCardBill(creditCardBillCategoryNames(categories)),
    [categories]
  )
  const isCardBill = isCreditCardBill(category)
  const isLoan = category.toLowerCase() === 'loan'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError('')

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    if (isReturnable && (!counterparty.trim() || !expectedReturnDate)) {
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

    setLoading(true)

    const effectiveCardId = isCardBill ? null : (cardId || null)
    const effectiveSettlesCardId = isCardBill ? (settlesCardId || null) : null
    const effectiveLoanSource = isLoan ? (loanSource as LoanSource) : null
    const effectiveLoanSourceNote = isLoan && loanSource === 'other' ? loanSourceNote.trim() : null

    if (isEditing && editingTransaction) {
      const { error } = await updateTransaction(editingTransaction.id, {
        type: type as 'debit' | 'credit',
        amount: parsedAmount,
        category,
        description,
        merchant: merchant.trim() || null,
        date,
        tags,
        is_returnable: type === 'debit' && isReturnable,
        counterparty: type === 'debit' && isReturnable ? counterparty : null,
        expected_return_date: type === 'debit' && isReturnable ? expectedReturnDate : null,
        return_status: type === 'debit' && isReturnable ? (editingTransaction.return_status || 'pending') : null,
        notes: notes || null,
        card_id: effectiveCardId,
        settles_card_id: effectiveSettlesCardId,
        loan_source: effectiveLoanSource,
        loan_source_note: effectiveLoanSourceNote,
        // A manual edit is an explicit human confirmation — mark it so this transaction
        // stops resurfacing in the Auto-Categorization Review modal on Pending.
        category_confirmed_at: new Date().toISOString(),
      })

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    } else {
      const { error } = await createTransaction({
        user_id: user.id,
        type: type as 'debit' | 'credit',
        amount: parsedAmount,
        category,
        description,
        merchant: merchant.trim() || null,
        date,
        source: 'manual',
        approval_status: 'approved',
        tags,
        is_returnable: type === 'debit' && isReturnable,
        counterparty: type === 'debit' && isReturnable ? counterparty : null,
        expected_return_date: type === 'debit' && isReturnable ? expectedReturnDate : null,
        return_status: type === 'debit' && isReturnable ? 'pending' : null,
        notes: notes || null,
        card_id: effectiveCardId,
        settles_card_id: effectiveSettlesCardId,
        loan_source: effectiveLoanSource,
        loan_source_note: effectiveLoanSourceNote,
      })

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    }

    // Reset form
    if (!isEditing) {
      setAmount('')
      setDescription('')
      setMerchant('')
      setTags([])
      setCategory(defaultCategory)
      setDate(toISODateLocal(new Date()))
      setIsReturnable(false)
      setCounterparty('')
      setExpectedReturnDate(toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)))
      setNotes('')
      setCardId('')
      setSettlesCardId('')
      setLoanSource('')
      setLoanSourceNote('')
    }

    setLoading(false)
    onSaved()
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3 text-sm text-[var(--status-danger-text)]"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* What moved, and which way. */}
        <fieldset className="space-y-4">
          <legend className="sr-only">Amount and direction</legend>

          <div className="space-y-1.5">
            <span id="direction-label" className="block text-sm font-semibold text-sb-ink">
              Direction
            </span>
            <div
              role="radiogroup"
              aria-labelledby="direction-label"
              className="grid grid-cols-2 gap-2"
            >
              {DIRECTIONS.map((d) => {
                const Icon = d.icon
                const active = type === d.value
                return (
                  <button
                    key={d.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setType(d.value)}
                    className={cn(
                      'flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold',
                      'cursor-pointer transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                      active
                        ? 'border-brand-600 bg-brand-500/10 text-brand-700 shadow-xs'
                        : 'border-sb-hairline bg-surface-1 text-sb-ink-secondary hover:border-brand-500/30 hover:text-sb-ink'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{d.label}</span>
                    <span className="sr-only">— {d.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Explicit id: Input derives one from the label otherwise, and
              "Amount (₹)" makes an id with a currency symbol in it. */}
          <Input
            label={`Amount (${currencySymbol})`}
            id="txn-amount"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="tnum text-base"
            required
          />
        </fieldset>

        {/* Who, what, when. */}
        <fieldset className="space-y-4">
          <legend className="sr-only">What this was</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input
                label="Merchant"
                id="txn-merchant"
                placeholder="e.g. Swiggy"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                list="merchant-suggestions"
              />
              <datalist id="merchant-suggestions">
                {KNOWN_MERCHANTS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <Select
              label="Category"
              id="txn-category"
              options={categoryOptions}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Description"
              id="txn-description"
              placeholder="What was this for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />

            <Input
              label="Date"
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="tnum"
              required
            />
          </div>

          {/* Card & Loan Routing */}
          {userCards.length > 0 && !isCardBill && !isLoan && (
            <Select
              label="Account / Card"
              id="txn-card"
              options={[
                { value: '', label: 'Cash in hand & Bank balance' },
                ...userCards.map((c) => ({
                  value: c.id,
                  label: `Credit Card — ${c.name} (•••• ${c.last4})`,
                })),
              ]}
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
            />
          )}

          {isCardBill && userCards.length > 0 && (
            <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-3.5 space-y-1.5">
              <Select
                label="Card settled by this payment"
                id="txn-settles-card"
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
                id="txn-loan-source"
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
                  id="txn-loan-card"
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
                  id="txn-loan-note"
                  placeholder="Who lent this money?"
                  value={loanSourceNote}
                  onChange={(e) => setLoanSourceNote(e.target.value)}
                  required
                />
              )}
            </div>
          )}
        </fieldset>

        {/* Optional detail, below a rule so it reads as optional. */}
        <fieldset className="space-y-4 border-t border-border-subtle pt-5">
          <legend className="sr-only">Optional detail</legend>

          <TagPicker
            tags={tags}
            onChange={setTags}
            id="txn-tags"
          />

          {type === 'debit' && (
            <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-3.5">
              <label className="flex cursor-pointer select-none items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={isReturnable}
                  onChange={(e) => setIsReturnable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-sb-hairline bg-surface-1 accent-[var(--brand-600)] focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
                <span>
                  <span className="block text-sm font-semibold text-sb-ink">
                    I expect this money back
                  </span>
                  <span className="mt-0.5 block text-xs text-sb-ink-muted">
                    Money you lent or fronted for someone. Intrack tracks it until it returns.
                  </span>
                </span>
              </label>

              {isReturnable && (
                <div className="mt-4 grid gap-4 border-t border-border-subtle/60 pt-4 sm:grid-cols-2">
                  <Input
                    label="Who owes it"
                    id="txn-counterparty"
                    placeholder="e.g. Rahul"
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    required={isReturnable}
                  />
                  <Input
                    label="Expected back by"
                    id="txn-expected-return"
                    type="date"
                    value={expectedReturnDate}
                    onChange={(e) => setExpectedReturnDate(e.target.value)}
                    min={date}
                    className="tnum"
                    required={isReturnable}
                  />
                </div>
              )}
            </div>
          )}

          {(isReturnable || notes) && (
            <Input
              label="Remarks"
              id="txn-notes"
              placeholder="Anything worth remembering about this one"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </fieldset>

        {/* Actions. Primary first on desktop; both full width on a phone so
            neither is a small target at the bottom of a sheet. */}
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-5 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" loading={loading} className="w-full justify-center sm:w-auto">
            {isEditing ? 'Save changes' : 'Add transaction'}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center sm:w-auto"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </>
  )
}
