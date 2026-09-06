// ============================================
// EditPlannedScheduleModal
// Allows updating due day and typical amount for a planned category
// ============================================

import { useState, type FormEvent } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import {
  savePlannedCategorySchedule,
  getPlannedCategorySchedule,
} from '@/services/plannedPayments'

interface EditPlannedScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  categoryName: string
  categoryEmoji?: string
  initialDueDay?: number
  initialExpectedAmount?: number
}

export default function EditPlannedScheduleModal({
  isOpen,
  onClose,
  onSaved,
  categoryName,
  categoryEmoji = '📅',
  initialDueDay = 1,
  initialExpectedAmount,
}: EditPlannedScheduleModalProps) {
  const { user, currencySymbol } = useAuth()
  const [dueDay, setDueDay] = useState<number>(initialDueDay)
  const [expectedAmount, setExpectedAmount] = useState<string>(
    initialExpectedAmount ? String(initialExpectedAmount) : ''
  )
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    if (user?.id) {
      savePlannedCategorySchedule(
        categoryName,
        {
          categoryName,
          dueDay: Number(dueDay) || 1,
          expectedAmount: expectedAmount ? Number(expectedAmount) : undefined,
        },
        user.id
      )
    }
    setLoading(false)
    onSaved()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Plan · ${categoryEmoji} ${categoryName}`}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-xs text-sb-ink-muted leading-relaxed">
          Set the expected due day and typical payment amount for <strong>{categoryName}</strong>.
          Payments logged in your ledger this month will automatically clear this.
        </p>

        <div>
          <label htmlFor="edit-due-day" className="block text-xs font-semibold text-sb-ink mb-1">
            Due day of the month
          </label>
          <select
            id="edit-due-day"
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

        <Input
          id="edit-expected-amount"
          label={`Expected amount per cycle (${currencySymbol})`}
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 15000"
          value={expectedAmount}
          onChange={(e) => setExpectedAmount(e.target.value)}
          className="tnum font-semibold"
        />

        <div className="mt-2 flex items-center justify-end gap-2 pt-3 border-t border-sb-hairline">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save Plan
          </Button>
        </div>
      </form>
    </Modal>
  )
}
