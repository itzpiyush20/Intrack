// ============================================
// QuickAddWidget — log a transaction without leaving the Dashboard.
//
// The whole point is that it is faster than the full form on Transactions, so
// it stays one card: amount, an optional note, a category, done. Everything
// else about a transaction has a sensible default and can be corrected later.
//
// Restyled 2026-09-06 (plans/ui-overhaul-2026-09-05.md). Behaviour is
// unchanged — same fields, same validation, same createTransaction call. What
// changed: the hand-rolled inputs became the shared `Input`/`Select` (they had
// their own focus ring, a 1px brand-400 one nothing else in the app uses),
// every tap target reached 44px, the amount got tabular figures, and the
// submit button stopped sharing a wrapping row with the category chips — at
// 360px it was being pushed onto a line of its own at roughly 60px wide.
// ============================================

import { useState, useRef, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Button, Card, Input, Select, transition } from '@/components/ui'
import { useCategories } from '@/context/CategoriesContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { createTransaction } from '@/services/transactions'
import { Plus, ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react'

const FALLBACK_CATEGORIES = ['Food & Dining', 'Transport', 'Shopping', 'Utilities & Bills']

interface QuickAddWidgetProps {
  /** Category codes to show as one-tap chips, most-used first. */
  topCategories: string[]
  /** Called after a transaction is successfully saved. */
  onAdded: () => void
  /**
   * An optional line under the form — the Dashboard uses it for the streak
   * nudge, which used to float as an orphaned sentence between two cards with
   * a negative margin holding it in place.
   */
  footnote?: string
}

/** Chip and segmented-control shell: same height, same radius, same ring. */
const CHIP_BASE =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ' +
  'transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-500/40'

export default function QuickAddWidget({ topCategories, onAdded, footnote }: QuickAddWidgetProps) {
  const { user, currencySymbol } = useAuth()
  const { categories, getStyle } = useCategories()
  const { showToast } = useToast()
  // The wrapper, not the control: the shared `Input` renders its own <div>
  // and does not forward a ref to the <input> inside it. Refocusing the amount
  // after a successful save is existing behaviour and is kept exactly.
  const amountFieldRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [type, setType] = useState<'debit' | 'credit'>('debit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const chips = (topCategories.length > 0 ? topCategories : FALLBACK_CATEGORIES).slice(0, 4)

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
      // Explicitly stamp this rather than relying on the DB column
      // default — a manually entered, self-approved transaction should
      // never resurface in the "awaiting your confirmation" review modal
      // on Pending Alerts.
      category_confirmed_at: new Date().toISOString(),
    })
    setSaving(false)

    if (createError) {
      setError(createError.message)
      return
    }

    showToast('Transaction added')
    setAmount('')
    setDescription('')
    setCategory('')
    setShowMore(false)
    amountFieldRef.current?.querySelector('input')?.focus()
    onAdded()
  }

  /** Whether the chosen category is one the chips are not showing. */
  const pickedFromList = !!category && !chips.includes(category)

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-100">Add it now</h2>
            <p className="mt-1 text-sm text-zinc-400">Dated today, approved straight away.</p>
          </div>

          {/* Direction. Said in words, not by colour alone, and both halves are
              44px tall so a thumb can hit either one. */}
          <div
            role="group"
            aria-label="Money in or out"
            className="flex items-center rounded-xl border border-border-subtle/60 bg-surface-2 p-1"
          >
            <button
              type="button"
              onClick={() => setType('debit')}
              aria-pressed={type === 'debit'}
              className={`${CHIP_BASE} border-transparent ${
                type === 'debit'
                  ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)]'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <ArrowDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Expense
            </button>
            <button
              type="button"
              onClick={() => setType('credit')}
              aria-pressed={type === 'credit'}
              className={`${CHIP_BASE} border-transparent ${
                type === 'credit'
                  ? 'bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Income
            </button>
          </div>
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

        {/* Input renders its own wrapper div and puts className on the <input>,
            so the flex sizing lives on the divs out here. */}
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

        <div>
          <p id="quick-add-category-label" className="mb-2 text-xs font-medium text-zinc-400">
            Category
          </p>
          <div role="group" aria-labelledby="quick-add-category-label" className="flex flex-wrap gap-2">
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
                  className={`${CHIP_BASE} ${
                    selected
                      ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 font-semibold'
                      : 'border-border-subtle/60 bg-surface-2 text-zinc-300 hover:border-border-hover hover:text-zinc-100'
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
              className={`${CHIP_BASE} ${
                showMore || pickedFromList
                  ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 font-semibold'
                  : 'border-border-subtle/60 bg-surface-2 text-zinc-300 hover:border-border-hover hover:text-zinc-100'
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {footnote ? (
            <p className="text-sm text-zinc-400">{footnote}</p>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button
            type="submit"
            loading={saving}
            className="h-11 w-full gap-1.5 sm:w-auto sm:shrink-0"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add transaction
          </Button>
        </div>
      </form>
    </Card>
  )
}
