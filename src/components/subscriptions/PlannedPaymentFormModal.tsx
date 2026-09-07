// ============================================
// PlannedPaymentFormModal
// Allows adding or editing a specific planned payment commitment
// (e.g. Netflix, Spotify, House Rent, Electricity) with its own
// category, cadence (Monthly, Weekly, Quarterly, Annual, Custom),
// due day/interval, and expected amount.
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
  type PaymentCadence,
} from '@/services/plannedPayments'
import { updateCategoryStyle } from '@/services/categories'
import { Trash2 } from 'lucide-react'
import { cn, formatDate } from '@/utils'
import type { Category } from '@/types'

interface PlannedPaymentFormModalProps {
  isOpen: boolean
  editingItem: UserPlannedPayment | null
  onClose: () => void
  onSaved: () => void
  categories: Category[]
  initialCategory?: string
}

const CADENCE_OPTIONS: Array<{ value: PaymentCadence; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
  { value: 'custom', label: 'Custom' },
]

const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

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
  const [cadence, setCadence] = useState<PaymentCadence>(editingItem?.cadence || 'monthly')
  const [dueDay, setDueDay] = useState<number>(editingItem?.dueDay || 1)
  const [dueDayOfWeek, setDueDayOfWeek] = useState<number>(editingItem?.dueDayOfWeek ?? 1)
  const [dueMonth, setDueMonth] = useState<number>(editingItem?.dueMonth ?? 0)
  const [customFrequencyDays, setCustomFrequencyDays] = useState<string>(
    editingItem?.customFrequencyDays ? String(editingItem.customFrequencyDays) : '8'
  )
  const [startDate, setStartDate] = useState<string>(
    editingItem?.startDate || new Date().toISOString().split('T')[0]
  )
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

    let parsedCustomDays: number | undefined
    if (cadence === 'custom') {
      parsedCustomDays = Number(customFrequencyDays)
      if (isNaN(parsedCustomDays) || parsedCustomDays < 2 || parsedCustomDays > 365) {
        setError('Please enter a custom frequency between 2 and 365 days.')
        return
      }
    }

    setLoading(true)
    try {
      // If the selected category is not yet tagged as a planned payment category, tag it automatically
      const targetCategoryObj = categories.find((c) => c.name.toLowerCase() === category.toLowerCase())
      if (targetCategoryObj && !isPlannedCategory(targetCategoryObj)) {
        const currentTags = targetCategoryObj.analytics_tags || []
        await updateCategoryStyle(targetCategoryObj.id, {
          analytics_tags: [...currentTags, 'subscription'],
        })
        await refreshCategories()
      }

      // Save user planned payment item with frequency & cadence properties
      saveUserPlannedPayment(
        {
          id: editingItem?.id,
          name: trimmedName,
          category,
          cadence,
          dueDay: Number(dueDay) || 1,
          dueDayOfWeek: cadence === 'weekly' ? dueDayOfWeek : undefined,
          dueMonth: cadence === 'quarterly' || cadence === 'annual' ? dueMonth : undefined,
          customFrequencyDays: parsedCustomDays,
          startDate: cadence === 'custom' || cadence === 'weekly' ? startDate : undefined,
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
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-xs text-sb-ink-muted leading-relaxed">
          Define recurring commitments (subscriptions, utilities, rent, EMIs).
          Choose your billing frequency (monthly, weekly, quarterly, annual, or custom cycle).
        </p>

        {error && (
          <div className="rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3 text-xs text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        <Input
          id="plan-item-name"
          label="Payment name / Service"
          placeholder="e.g. Netflix, House Rent, Tata Power, Spotify, Gym"
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

        {/* Cadence Pill Selector */}
        <div>
          <label className="block text-xs font-semibold text-sb-ink mb-1.5">
            Billing Frequency
          </label>
          <div
            role="group"
            aria-label="Billing frequency"
            className="grid grid-cols-5 gap-1 p-1 bg-surface-2/70 border border-sb-hairline rounded-xl"
          >
            {CADENCE_OPTIONS.map((opt) => {
              const selected = cadence === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCadence(opt.value)}
                  className={cn(
                    'py-1.5 px-2 rounded-lg text-xs font-semibold transition-all text-center cursor-pointer',
                    selected
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-1'
                  )}
                  aria-pressed={selected}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Conditional Schedule & Amount Configuration */}
        {cadence === 'monthly' && (
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
        )}

        {cadence === 'weekly' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label htmlFor="plan-item-weekday" className="block text-xs font-semibold text-sb-ink mb-1">
                  Day of week
                </label>
                <select
                  id="plan-item-weekday"
                  value={dueDayOfWeek}
                  onChange={(e) => setDueDayOfWeek(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-startdate" className="block text-xs font-semibold text-sb-ink mb-1">
                  Starting / First Date
                </label>
                <input
                  id="plan-item-startdate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                  required
                />
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-amount" className="block text-xs font-semibold text-sb-ink mb-1">
                  Per week ({currencySymbol})
                </label>
                <Input
                  id="plan-item-amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 500"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="tnum font-semibold"
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-sb-ink-muted">
              Recurs every 7 days (approximately 4–5 occurrences each month).
            </p>
          </div>
        )}

        {cadence === 'quarterly' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label htmlFor="plan-item-quarter-month" className="block text-xs font-semibold text-sb-ink mb-1">
                  Quarter cycle starts
                </label>
                <select
                  id="plan-item-quarter-month"
                  value={dueMonth}
                  onChange={(e) => setDueMonth(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                >
                  <option value={0}>Jan / Apr / Jul / Oct</option>
                  <option value={1}>Feb / May / Aug / Nov</option>
                  <option value={2}>Mar / Jun / Sep / Dec</option>
                </select>
              </div>

              <div className="sm:col-span-1">
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
                      Day {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-amount" className="block text-xs font-semibold text-sb-ink mb-1">
                  Per quarter ({currencySymbol})
                </label>
                <Input
                  id="plan-item-amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 2500"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="tnum font-semibold"
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-sb-ink-muted">
              Recurs every 3 months on the specified day of the cycle.
            </p>
          </div>
        )}

        {cadence === 'annual' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label htmlFor="plan-item-annual-month" className="block text-xs font-semibold text-sb-ink mb-1">
                  Billing month
                </label>
                <select
                  id="plan-item-annual-month"
                  value={dueMonth}
                  onChange={(e) => setDueMonth(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                >
                  {MONTH_NAMES.map((m, idx) => (
                    <option key={idx} value={idx}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-dueday" className="block text-xs font-semibold text-sb-ink mb-1">
                  Due day
                </label>
                <select
                  id="plan-item-dueday"
                  value={dueDay}
                  onChange={(e) => setDueDay(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-amount" className="block text-xs font-semibold text-sb-ink mb-1">
                  Per year ({currencySymbol})
                </label>
                <Input
                  id="plan-item-amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 15000"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="tnum font-semibold"
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-sb-ink-muted">
              Recurs once a year in {MONTH_NAMES[dueMonth]} on Day {dueDay}.
            </p>
          </div>
        )}

        {cadence === 'custom' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label htmlFor="plan-item-frequency" className="block text-xs font-semibold text-sb-ink mb-1">
                  Repeat every (days)
                </label>
                <Input
                  id="plan-item-frequency"
                  type="number"
                  min="2"
                  max="365"
                  placeholder="e.g. 8"
                  value={customFrequencyDays}
                  onChange={(e) => setCustomFrequencyDays(e.target.value)}
                  className="tnum font-semibold"
                  required
                />
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-custom-start" className="block text-xs font-semibold text-sb-ink mb-1">
                  Anchor / start date
                </label>
                <input
                  id="plan-item-custom-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                  required
                />
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="plan-item-amount" className="block text-xs font-semibold text-sb-ink mb-1">
                  Per cycle ({currencySymbol})
                </label>
                <Input
                  id="plan-item-amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 1000"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="tnum font-semibold"
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-sb-ink-muted">
              Recurs every {customFrequencyDays || 'N'} days starting from {startDate ? formatDate(startDate) : 'selected date'}.
            </p>
          </div>
        )}

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
