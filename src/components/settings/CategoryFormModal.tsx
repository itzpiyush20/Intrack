// ============================================
// CategoryFormModal — shared create/edit form for user categories
// ============================================

import { useState, type FormEvent } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { CATEGORY_EMOJI_CHOICES, CATEGORY_COLOR_CHOICES, ANALYTICS_TAG_CHOICES } from '@/constants'
import { useCategories, useAuth } from '@/context'
import { createCategory, renameCategory, updateCategoryStyle } from '@/services/categories'
import {
  getPlannedCategorySchedule,
  savePlannedCategorySchedule,
  isPlannedCategory,
} from '@/services/plannedPayments'
import { cn } from '@/utils'
import type { AnalyticsTag, Category, CategoryType } from '@/types'

interface CategoryFormModalProps {
  editing: Category | null
  onClose: () => void
  onSaved: () => void
  initialPlannedPayment?: boolean
}

export default function CategoryFormModal({
  editing,
  onClose,
  onSaved,
  initialPlannedPayment = false,
}: CategoryFormModalProps) {
  const { categories } = useCategories()
  const { user } = useAuth()
  const isEditing = !!editing

  const initialSchedule = editing
    ? getPlannedCategorySchedule(editing.name, user?.id)
    : { categoryName: '', dueDay: 1, expectedAmount: undefined }

  const [name, setName] = useState(editing?.name || '')
  const [emoji, setEmoji] = useState(editing?.emoji || CATEGORY_EMOJI_CHOICES[0])
  const [color, setColor] = useState(editing?.color || CATEGORY_COLOR_CHOICES[0])
  const [type, setType] = useState<CategoryType>(editing?.type || 'expense')
  const [budgetEligible, setBudgetEligible] = useState(editing?.budget_eligible ?? true)
  const [isPlannedPayment, setIsPlannedPayment] = useState<boolean>(
    editing ? isPlannedCategory(editing) : initialPlannedPayment
  )
  const [dueDay, setDueDay] = useState<number>(initialSchedule.dueDay || 1)
  const [expectedAmount, setExpectedAmount] = useState<string>(
    initialSchedule.expectedAmount ? String(initialSchedule.expectedAmount) : ''
  )
  const [analyticsTags, setAnalyticsTags] = useState<AnalyticsTag[]>(() => {
    const existing = editing?.analytics_tags ?? []
    if (initialPlannedPayment && !existing.includes('subscription')) {
      return [...existing, 'subscription']
    }
    return existing
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Needs / Wants / Savings are the three buckets of the 50/30/20 split, so a
  // category belongs to exactly one of them. Letting two be ticked at once
  // counted that category's spend in both bars and pushed the split past 100%.
  // The remaining tags (income, subscription, credit card bill) describe
  // different things and stay independently tickable.
  const BUDGET_SPLIT_TAGS: AnalyticsTag[] = ['needs', 'wants', 'savings']

  const toggleTag = (tag: AnalyticsTag) => {
    setAnalyticsTags((prev) => {
      let next: AnalyticsTag[]
      if (prev.includes(tag)) {
        next = prev.filter((t) => t !== tag)
      } else if (BUDGET_SPLIT_TAGS.includes(tag)) {
        next = [...prev.filter((t) => !BUDGET_SPLIT_TAGS.includes(t)), tag]
      } else {
        next = [...prev, tag]
      }
      if (tag === 'subscription') {
        setIsPlannedPayment(next.includes('subscription'))
      }
      return next
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please enter a category name')
      return
    }

    const duplicate = categories.some(
      (c) => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== editing?.id
    )
    if (duplicate) {
      setError('A category with this name already exists')
      return
    }

    setLoading(true)

    let finalTags = [...analyticsTags]
    if (type === 'expense' && isPlannedPayment) {
      if (!finalTags.includes('subscription')) {
        finalTags.push('subscription')
      }
    } else {
      finalTags = finalTags.filter((t) => t !== 'subscription' && (t as string) !== 'planned_payment')
    }

    if (isEditing && editing) {
      if (trimmedName !== editing.name) {
        const { error: renameError } = await renameCategory(editing.name, trimmedName)
        if (renameError) {
          setError(renameError.message)
          setLoading(false)
          return
        }
      }

      const { error: styleError } = await updateCategoryStyle(editing.id, {
        emoji,
        color,
        type,
        budget_eligible: type === 'expense' ? budgetEligible : false,
        analytics_tags: finalTags,
      })
      if (styleError) {
        setError(styleError.message)
        setLoading(false)
        return
      }
    } else {
      const { error: createError } = await createCategory({
        name: trimmedName,
        emoji,
        color,
        type,
        budget_eligible: type === 'expense' ? budgetEligible : false,
        analytics_tags: finalTags,
      })
      if (createError) {
        setError(createError.message)
        setLoading(false)
        return
      }
    }

    if (user?.id && type === 'expense' && isPlannedPayment) {
      savePlannedCategorySchedule(
        trimmedName,
        {
          categoryName: trimmedName,
          dueDay: Number(dueDay) || 1,
          expectedAmount: expectedAmount ? Number(expectedAmount) : undefined,
        },
        user.id
      )
    }

    setLoading(false)
    onSaved()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEditing ? 'Edit Category' : 'New Category'}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="category-form-modal" size="md" loading={loading}>
            {isEditing ? 'Save Changes' : 'Create Category'}
          </Button>
        </>
      }
    >
      <form id="category-form-modal" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div role="alert" className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 text-sm text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        <Input
          label="Name"
          placeholder="e.g. Gym Membership"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-2">Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('expense')}
              className={cn(
                'h-11 rounded-xl border text-sm font-semibold transition-all cursor-pointer shadow-xs',
                type === 'expense'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-sb-hairline bg-surface-1 text-sb-ink-muted hover:text-sb-ink hover:border-brand-500/30'
              )}
            >
              🔴 Expense
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
              className={cn(
                'h-11 rounded-xl border text-sm font-semibold transition-all cursor-pointer shadow-xs',
                type === 'income'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-sb-hairline bg-surface-1 text-sb-ink-muted hover:text-sb-ink hover:border-brand-500/30'
              )}
            >
              🟢 Income
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-2">Emoji</label>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {CATEGORY_EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-label={`Choose emoji ${e}`}
                aria-pressed={emoji === e}
                className={cn(
                  'h-11 w-11 sm:h-9 sm:w-9 rounded-xl border text-base flex items-center justify-center transition-all cursor-pointer shadow-xs',
                  emoji === e
                    ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20'
                    : 'border-sb-hairline bg-surface-1 hover:border-brand-500/30'
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-2">Color</label>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-12">
            {CATEGORY_COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Choose color ${c}`}
                aria-pressed={color === c}
                className={cn(
                  'h-11 w-11 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-transform cursor-pointer',
                  color === c ? 'scale-110' : 'hover:scale-105'
                )}
              >
                <span
                  className={cn(
                    'h-7 w-7 rounded-full border-2 block shadow-xs',
                    color === c ? 'border-brand-700 ring-2 ring-brand-500/30' : 'border-white/50'
                  )}
                  style={{ backgroundColor: c }}
                />
              </button>
            ))}
          </div>
        </div>

        {type === 'expense' && (
          <>
            <label className="flex items-center gap-2 text-sm font-medium text-sb-ink cursor-pointer select-none">
              <input
                type="checkbox"
                checked={budgetEligible}
                onChange={(e) => setBudgetEligible(e.target.checked)}
                className="rounded border-sb-hairline bg-surface-1 text-brand-600 focus:ring-brand-500/25 h-4 w-4 cursor-pointer"
              />
              Allow budget limits for this category
            </label>

            <div className="rounded-xl border border-sb-hairline bg-surface-2/60 p-3.5 space-y-3">
              <label className="flex items-start gap-2.5 text-sm font-medium text-sb-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isPlannedPayment}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsPlannedPayment(checked)
                    if (checked) {
                      setAnalyticsTags((prev) => (prev.includes('subscription') ? prev : [...prev, 'subscription']))
                    } else {
                      setAnalyticsTags((prev) => prev.filter((t) => t !== 'subscription' && (t as string) !== 'planned_payment'))
                    }
                  }}
                  className="mt-0.5 rounded border-sb-hairline bg-surface-1 text-brand-600 focus:ring-brand-500/25 h-4 w-4 cursor-pointer"
                />
                <div>
                  <span className="font-semibold text-sb-ink">Mark as Planned Payment</span>
                  <p className="text-xs text-sb-ink-muted mt-0.5 leading-relaxed">
                    Track this recurring commitment (e.g., Rent, Electricity, Netflix, SIP, or EMIs) in your Planned Payments command center with due dates and monthly clearance.
                  </p>
                </div>
              </label>

              {isPlannedPayment && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-sb-hairline">
                  <div>
                    <label htmlFor="cat-due-day" className="block text-xs font-semibold text-sb-ink mb-1">
                      Due day of month
                    </label>
                    <select
                      id="cat-due-day"
                      value={dueDay}
                      onChange={(e) => setDueDay(Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          Day {d} of the month
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cat-expected-amount" className="block text-xs font-semibold text-sb-ink mb-1">
                      Typical / Expected amount (₹)
                    </label>
                    <Input
                      id="cat-expected-amount"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="e.g. 15000"
                      value={expectedAmount}
                      onChange={(e) => setExpectedAmount(e.target.value)}
                      className="tnum"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-1">Analytics tags (optional)</label>
          <p className="text-xs text-sb-ink-muted mb-2">
            Controls how this category counts toward the Insights page — the 50/30/20 breakdown, income total, and subscription/credit-card-bill tracking.
            Pick only one of Needs, Wants, or Savings per category — Subscription can be added alongside Wants if it's also a recurring bill.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ANALYTICS_TAG_CHOICES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleTag(value)}
                aria-pressed={analyticsTags.includes(value)}
                className={cn(
                  'px-3 h-8 rounded-full border text-xs font-semibold transition-all cursor-pointer shadow-xs',
                  analyticsTags.includes(value)
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-sb-hairline bg-surface-1 text-sb-ink-muted hover:text-sb-ink hover:border-brand-500/30'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}
