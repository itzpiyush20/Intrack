// ============================================
// CategoryFormModal — shared create/edit form for user categories
// ============================================

import { useState, type FormEvent } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { CATEGORY_EMOJI_CHOICES, CATEGORY_COLOR_CHOICES, ANALYTICS_TAG_CHOICES } from '@/constants'
import { useCategories } from '@/context'
import { createCategory, renameCategory, updateCategoryStyle } from '@/services/categories'
import { cn } from '@/utils'
import type { AnalyticsTag, Category, CategoryType } from '@/types'

interface CategoryFormModalProps {
  editing: Category | null
  onClose: () => void
  onSaved: () => void
}

export default function CategoryFormModal({ editing, onClose, onSaved }: CategoryFormModalProps) {
  const { categories } = useCategories()
  const isEditing = !!editing

  const [name, setName] = useState(editing?.name || '')
  const [emoji, setEmoji] = useState(editing?.emoji || CATEGORY_EMOJI_CHOICES[0])
  const [color, setColor] = useState(editing?.color || CATEGORY_COLOR_CHOICES[0])
  const [type, setType] = useState<CategoryType>(editing?.type || 'expense')
  const [budgetEligible, setBudgetEligible] = useState(editing?.budget_eligible ?? true)
  const [analyticsTags, setAnalyticsTags] = useState<AnalyticsTag[]>(editing?.analytics_tags ?? [])
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
      if (prev.includes(tag)) return prev.filter((t) => t !== tag)
      if (BUDGET_SPLIT_TAGS.includes(tag)) {
        return [...prev.filter((t) => !BUDGET_SPLIT_TAGS.includes(t)), tag]
      }
      return [...prev, tag]
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
        analytics_tags: analyticsTags,
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
        analytics_tags: analyticsTags,
      })
      if (createError) {
        setError(createError.message)
        setLoading(false)
        return
      }
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
          <label className="block text-sm font-medium text-zinc-300 mb-2">Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('expense')}
              className={cn(
                'h-11 rounded-lg border text-sm font-semibold transition-colors',
                type === 'expense'
                  ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                  : 'border-border-default text-zinc-400 hover:border-border-hover'
              )}
            >
              🔴 Expense
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
              className={cn(
                'h-11 rounded-lg border text-sm font-semibold transition-colors',
                type === 'income'
                  ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                  : 'border-border-default text-zinc-400 hover:border-border-hover'
              )}
            >
              🟢 Income
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Emoji</label>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10">
            {CATEGORY_EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-label={`Choose emoji ${e}`}
                aria-pressed={emoji === e}
                className={cn(
                  'h-9 w-9 rounded-lg border text-base flex items-center justify-center transition-colors',
                  emoji === e
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-border-default hover:border-border-hover'
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Color</label>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
            {CATEGORY_COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Choose color ${c}`}
                aria-pressed={color === c}
                className={cn(
                  'h-7 w-7 rounded-full border-2 transition-transform',
                  color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {type === 'expense' && (
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={budgetEligible}
              onChange={(e) => setBudgetEligible(e.target.checked)}
              className="rounded border-zinc-700 bg-surface-2 text-brand-500 focus:ring-brand-500/25 h-4 w-4"
            />
            Allow budget limits for this category
          </label>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Analytics tags (optional)</label>
          <p className="text-xs text-zinc-500 mb-2">
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
                  'px-3 h-8 rounded-full border text-xs font-semibold transition-colors',
                  analyticsTags.includes(value)
                    ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                    : 'border-border-default text-zinc-400 hover:border-border-hover'
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
