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

import { useState, type FormEvent } from 'react'
import { Button, Input, Select } from '@/components/ui'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { createTransaction, updateTransaction } from '@/services'
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
  const [tagsInput, setTagsInput] = useState(
    editingTransaction?.tags?.join(', ') || ''
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

    setLoading(true)

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)

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
      setTagsInput('')
      setCategory(defaultCategory)
      setDate(toISODateLocal(new Date()))
      setIsReturnable(false)
      setCounterparty('')
      setExpectedReturnDate(toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)))
      setNotes('')
    }

    setLoading(false)
    onSaved()
  }

  const parsedTags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

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
            <span id="direction-label" className="block text-sm font-medium text-zinc-300">
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
                      'flex h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium',
                      'cursor-pointer transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                      active
                        ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                        : 'border-border-default bg-surface-1 text-zinc-400 hover:border-border-hover hover:text-zinc-100'
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

          <Input
            label={`Amount (${currencySymbol})`}
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
              options={categoryOptions}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Description"
              placeholder="What was this for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />

            <Input
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="tnum"
              required
            />
          </div>
        </fieldset>

        {/* Optional detail, below a rule so it reads as optional. */}
        <fieldset className="space-y-4 border-t border-border-subtle pt-5">
          <legend className="sr-only">Optional detail</legend>

          <div className="space-y-2">
            <Input
              label="Tags"
              placeholder="e.g. food, vacation, work"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
            {parsedTags.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {parsedTags.map((t, idx) => (
                  <li
                    key={idx}
                    className="inline-flex items-center rounded-lg border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-400"
                  >
                    #{t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400">
                Separate with commas. Tags let you group spending across categories.
              </p>
            )}
          </div>

          {type === 'debit' && (
            <div className="rounded-xl border border-border-subtle bg-surface-2/50 p-3.5">
              <label className="flex cursor-pointer select-none items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={isReturnable}
                  onChange={(e) => setIsReturnable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-default bg-surface-1 text-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-200">
                    I expect this money back
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    Money you lent or fronted for someone. Intrack tracks it until it returns.
                  </span>
                </span>
              </label>

              {isReturnable && (
                <div className="mt-4 grid gap-4 border-t border-border-subtle/60 pt-4 sm:grid-cols-2">
                  <Input
                    label="Who owes it"
                    placeholder="e.g. Rahul"
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    required={isReturnable}
                  />
                  <Input
                    label="Expected back by"
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
