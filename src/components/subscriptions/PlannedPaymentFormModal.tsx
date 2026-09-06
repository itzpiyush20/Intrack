// ============================================
// PlannedPaymentFormModal
// Allows adding or editing a specific planned payment commitment
// (e.g. Netflix, Spotify, House Rent, Electricity) with its own
// category, due day, and expected amount.
// ============================================

import { useState, type FormEvent } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import {
  saveUserPlannedPayment,
  deleteUserPlannedPayment,
  isPlannedCategory,
  type UserPlannedPayment,
} from '@/services/plannedPayments'
import { updateCategoryStyle } from '@/services/categories'
import { Trash2 } from 'lucide-react'
import type { Category } from '@/types'

interface PlannedPaymentFormModalProps {
  isOpen: boolean
  editingItem: UserPlannedPayment | null
  onClose: () => void
  onSaved: () => void
  categories: Category[]
  initialCategory?: string
}

export default function PlannedPaymentFormModal({
  isOpen,
  editingItem,
  onClose,
  onSaved,
  categories,
  initialCategory,
}: PlannedPaymentFormModalProps) {
  const { user, currencySymbol } = useAuth()
  const { refresh: refreshCategories } = useCategories()

  // Default to first planned category, or initialCategory, or first expense category
  const expenseCategories = categories.filter((c) => c.type === 'expense')
  const defaultCategory =
    initialCategory ||
    editingItem?.category ||
    expenseCategories.find(isPlannedCategory)?.name ||
    expenseCategories[0]?.name ||
    'Subscriptions'

  const [name, setName] = useState(editingItem?.name || '')
  const [category, setCategory] = useState(editingItem?.category || defaultCategory)
  const [dueDay, setDueDay] = useState<number>(editingItem?.dueDay || 1)
  const [expectedAmount, setExpectedAmount] = useState<string>(
    editingItem?.expectedAmount ? String(editingItem.expectedAmount) : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isEditing = !!editingItem

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Please enter a payment name (e.g. Netflix, Rent, Tata Power).')
      return
    }

    const numAmount = Number(expectedAmount)
    if (isNaN(numAmount) || numAmount < 0) {
      setError('Please enter a valid expected amount.')
      return
    }

    setLoading(true)
    try {
      // If the selected category is not yet tagged as a planned payment category, tag it automatically!
      const targetCategoryObj = categories.find((c) => c.name.toLowerCase() === category.toLowerCase())
      if (targetCategoryObj && !isPlannedCategory(targetCategoryObj)) {
        const currentTags = targetCategoryObj.analytics_tags || []
        await updateCategoryStyle(targetCategoryObj.id, {
          analytics_tags: [...currentTags, 'subscription'],
        })
        await refreshCategories()
      }

      // Save user planned payment item
      saveUserPlannedPayment(
        {
          id: editingItem?.id,
          name: trimmedName,
          category,
          dueDay: Number(dueDay) || 1,
          expectedAmount: numAmount,
          createdAt: editingItem?.createdAt,
        },
        user?.id
      )

      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to save planned payment.')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = () => {
    if (!editingItem) return
    deleteUserPlannedPayment(editingItem.id, user?.id)
    onSaved()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Planned Payment · ${editingItem.name}` : 'Add Planned Payment'}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-xs text-sb-ink-muted leading-relaxed">
          Define a specific recurring payment. When expenses in this category are logged in your ledger,
          they will automatically match and clear this payment for the month.
        </p>

        {error && (
          <div className="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3 text-xs text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        <Input
          id="plan-item-name"
          label="Payment name / Service"
          placeholder="e.g. Netflix, House Rent, Tata Power, Spotify"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div>
          <label htmlFor="plan-item-category" className="block text-xs font-semibold text-sb-ink mb-1">
            Category
          </label>
          <select
            id="plan-item-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
          >
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.emoji} {c.name} {isPlannedCategory(c) ? '★' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="plan-item-dueday" className="block text-xs font-semibold text-sb-ink mb-1">
              Due day of month
            </label>
            <select
              id="plan-item-dueday"
              value={dueDay}
              onChange={(e) => setDueDay(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d} of month
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="plan-item-amount" className="block text-xs font-semibold text-sb-ink mb-1">
              Expected amount ({currencySymbol})
            </label>
            <Input
              id="plan-item-amount"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 649"
              value={expectedAmount}
              onChange={(e) => setExpectedAmount(e.target.value)}
              className="tnum font-semibold"
              required
            />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 pt-3 border-t border-sb-hairline">
          {isEditing ? (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] transition-colors cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {isEditing ? 'Save Changes' : 'Add Planned Payment'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
