// ============================================
// SplitBillModal — Split an expense with friends & track returnables
// ============================================

import { useState, useEffect, useMemo } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { formatCurrency, formatDate, toISODateLocal, cn } from '@/utils'
import { splitTransaction } from '@/services'
import { useToast } from '@/context'
import type { Database } from '@/types/database'
import { Users, Plus, Trash2, Calendar, AlertCircle, ArrowRight, Check } from 'lucide-react'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

export interface SplitBillModalProps {
  isOpen: boolean
  onClose: () => void
  transaction: TransactionRow | null
  onSplitComplete: () => void
}

interface FriendEntry {
  id: string
  name: string
  amount: string
  expectedReturnDate: string
}

export default function SplitBillModal({
  isOpen,
  onClose,
  transaction,
  onSplitComplete,
}: SplitBillModalProps) {
  const { showToast } = useToast()

  const defaultDate = useMemo(() => {
    return toISODateLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  }, [])

  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal')
  const [includeSelf, setIncludeSelf] = useState(true)
  const [friends, setFriends] = useState<FriendEntry[]>([
    { id: '1', name: '', amount: '', expectedReturnDate: defaultDate },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalAmount = transaction ? Number(transaction.amount) : 0

  // Reset when a new transaction is opened
  useEffect(() => {
    if (isOpen && transaction) {
      setSplitMode('equal')
      setIncludeSelf(true)
      setFriends([
        { id: '1', name: '', amount: '', expectedReturnDate: defaultDate },
      ])
      setError(null)
    }
  }, [isOpen, transaction, defaultDate])

  // Calculation for Equal Split
  const equalShares = useMemo(() => {
    if (!totalAmount || friends.length === 0) return { friendShare: 0, userShare: 0 }
    const totalPeople = includeSelf ? friends.length + 1 : friends.length
    if (totalPeople === 0) return { friendShare: 0, userShare: 0 }

    // Round to 2 decimals
    const baseShare = Math.round((totalAmount / totalPeople) * 100) / 100
    const totalFriendsAmount = baseShare * friends.length
    const userShare = includeSelf
      ? Math.max(0, Math.round((totalAmount - totalFriendsAmount) * 100) / 100)
      : 0

    return { friendShare: baseShare, userShare }
  }, [totalAmount, friends.length, includeSelf])

  // Calculation for Custom Split
  const customFriendTotal = useMemo(() => {
    return friends.reduce((sum, f) => {
      const val = parseFloat(f.amount)
      return sum + (isNaN(val) ? 0 : val)
    }, 0)
  }, [friends])

  const customUserShare = useMemo(() => {
    return Math.round((totalAmount - customFriendTotal) * 100) / 100
  }, [totalAmount, customFriendTotal])

  // Active user share depending on mode
  const effectiveUserShare = splitMode === 'equal' ? equalShares.userShare : customUserShare
  const effectiveFriendsTotal =
    splitMode === 'equal' ? equalShares.friendShare * friends.length : customFriendTotal

  // Validation
  const isCustomOverflow = splitMode === 'custom' && customFriendTotal > totalAmount

  const addFriend = () => {
    const nextId = String(Date.now() + Math.random())
    setFriends((prev) => [
      ...prev,
      { id: nextId, name: '', amount: '', expectedReturnDate: defaultDate },
    ])
  }

  const removeFriend = (id: string) => {
    if (friends.length <= 1) return
    setFriends((prev) => prev.filter((f) => f.id !== id))
  }

  const updateFriend = (id: string, updates: Partial<FriendEntry>) => {
    setFriends((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    )
  }

  const handleSplitSubmit = async () => {
    if (!transaction) return
    setError(null)

    // Validate friend names
    for (let i = 0; i < friends.length; i++) {
      const f = friends[i]
      if (!f.name.trim()) {
        setError(`Please enter a name for Person #${i + 1}`)
        return
      }
      if (splitMode === 'custom') {
        const val = parseFloat(f.amount)
        if (isNaN(val) || val <= 0) {
          setError(`Please enter a valid amount for ${f.name || `Person #${i + 1}`}`)
          return
        }
      }
    }

    if (splitMode === 'custom' && customFriendTotal > totalAmount) {
      setError("The sum of friends' shares cannot exceed the total bill.")
      return
    }

    setLoading(true)

    // Prepare friend shares
    const friendShares = friends.map((f) => {
      const amt =
        splitMode === 'equal'
          ? equalShares.friendShare
          : parseFloat(f.amount)
      return {
        counterparty: f.name.trim(),
        amount: Math.round(amt * 100) / 100,
        expected_return_date: f.expectedReturnDate || undefined,
        notes: `Split bill from ₹${totalAmount} (${transaction.merchant || transaction.description || 'Expense'})`,
      }
    })

    const finalUserAmount = Math.max(0, effectiveUserShare)

    const { success, error: splitErr } = await splitTransaction(
      transaction.id,
      finalUserAmount,
      friendShares
    )

    setLoading(false)

    if (!success || splitErr) {
      setError(splitErr?.message || 'Failed to split bill. Please try again.')
      return
    }

    showToast(
      `Bill split successfully! ${friendShares.length} receivable(s) created.`
    )
    onSplitComplete()
    onClose()
  }

  if (!transaction) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Split Bill with Friends"
      sheet
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-sb-ink-muted">
            {friends.length} friend{friends.length === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-sb-ink">
              Your share: {formatCurrency(effectiveUserShare)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleSplitSubmit}
              loading={loading}
              disabled={loading || isCustomOverflow}
              className="gap-1.5 font-semibold"
            >
              <Check className="h-4 w-4" />
              Confirm Split
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Bill Summary Card */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/50 p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
                Original Transaction
              </p>
              <h4 className="mt-0.5 truncate text-base font-bold text-sb-ink">
                {transaction.merchant || transaction.description || 'Expense'}
              </h4>
              <p className="text-xs text-sb-ink-muted">
                {formatDate(transaction.date)} · {transaction.category}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-sb-ink-muted">Total Paid</p>
              <p className="tnum text-lg font-extrabold text-sb-ink">
                {formatCurrency(totalAmount)}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-xs text-[var(--status-danger-text)]"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Split Controls */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
              Split Mode
            </span>
            <div className="inline-flex rounded-lg border border-sb-hairline bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => setSplitMode('equal')}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                  splitMode === 'equal'
                    ? 'bg-surface-1 text-sb-ink shadow-xs'
                    : 'text-sb-ink-muted hover:text-sb-ink'
                )}
              >
                Equal Split
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('custom')}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                  splitMode === 'custom'
                    ? 'bg-surface-1 text-sb-ink shadow-xs'
                    : 'text-sb-ink-muted hover:text-sb-ink'
                )}
              >
                Custom Amounts
              </button>
            </div>
          </div>

          {/* Include yourself toggle */}
          {splitMode === 'equal' && (
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-sb-hairline bg-surface-1 p-3 transition-colors hover:border-brand-500/30">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-brand-600" />
                <span className="text-xs font-semibold text-sb-ink">
                  Include yourself in the split
                </span>
              </div>
              <input
                type="checkbox"
                checked={includeSelf}
                onChange={(e) => setIncludeSelf(e.target.checked)}
                className="h-4 w-4 rounded border-sb-hairline text-brand-600 focus:ring-brand-500/30 cursor-pointer"
              />
            </label>
          )}
        </div>

        {/* Friends list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
              Friends & Repayment Terms
            </span>
            <button
              type="button"
              onClick={addFriend}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add friend
            </button>
          </div>

          <div className="space-y-2.5 max-h-[42vh] overflow-y-auto pr-1">
            {friends.map((friend, index) => (
              <div
                key={friend.id}
                className="flex flex-col gap-2 rounded-xl border border-sb-hairline bg-surface-1 p-3 shadow-2xs sm:flex-row sm:items-center sm:gap-3"
              >
                {/* Friend Name */}
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`friend-name-${friend.id}`}
                    className="sr-only"
                  >
                    Friend #{index + 1} Name
                  </label>
                  <Input
                    id={`friend-name-${friend.id}`}
                    placeholder={`Friend #${index + 1} (e.g. Rahul, Priya)`}
                    value={friend.name}
                    onChange={(e) =>
                      updateFriend(friend.id, { name: e.target.value })
                    }
                    className="h-9 text-xs"
                  />
                </div>

                {/* Amount */}
                <div className="w-full sm:w-28">
                  <label
                    htmlFor={`friend-amt-${friend.id}`}
                    className="sr-only"
                  >
                    Amount
                  </label>
                  {splitMode === 'equal' ? (
                    <div className="flex h-9 items-center justify-between rounded-xl border border-sb-hairline bg-surface-2/60 px-3 text-xs font-semibold text-sb-ink">
                      <span>₹</span>
                      <span className="tnum">
                        {equalShares.friendShare.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : (
                    <Input
                      id={`friend-amt-${friend.id}`}
                      type="number"
                      step="any"
                      placeholder="₹ Amount"
                      value={friend.amount}
                      onChange={(e) =>
                        updateFriend(friend.id, { amount: e.target.value })
                      }
                      className="h-9 text-xs font-mono tnum"
                    />
                  )}
                </div>

                {/* Expected Return Date */}
                <div className="w-full sm:w-36">
                  <label
                    htmlFor={`friend-date-${friend.id}`}
                    className="sr-only"
                  >
                    Return Date
                  </label>
                  <div className="relative">
                    <input
                      id={`friend-date-${friend.id}`}
                      type="date"
                      value={friend.expectedReturnDate}
                      onChange={(e) =>
                        updateFriend(friend.id, {
                          expectedReturnDate: e.target.value,
                        })
                      }
                      className="h-9 w-full rounded-xl border border-sb-hairline bg-surface-1 px-2.5 text-xs text-sb-ink font-medium shadow-2xs hover:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                      title="Expected return date"
                    />
                  </div>
                </div>

                {/* Remove button */}
                {friends.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFriend(friend.id)}
                    aria-label={`Remove friend ${index + 1}`}
                    className="self-end sm:self-center h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-sb-ink-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live Balance Summary */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/30 p-3.5 text-xs space-y-2">
          <div className="flex items-center justify-between text-sb-ink-muted">
            <span>Total bill</span>
            <span className="tnum font-medium text-sb-ink">
              {formatCurrency(totalAmount)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sb-ink-muted">
            <span>Owed by {friends.length} friend(s)</span>
            <span className="tnum font-medium text-sb-ink">
              {formatCurrency(effectiveFriendsTotal)}
            </span>
          </div>
          <div className="border-t border-sb-hairline pt-2 flex items-center justify-between font-bold text-sb-ink">
            <span>Your personal spend</span>
            <span
              className={cn(
                'tnum text-sm',
                isCustomOverflow ? 'text-rose-600' : 'text-brand-700'
              )}
            >
              {isCustomOverflow ? 'Invalid (Exceeds total)' : formatCurrency(effectiveUserShare)}
            </span>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-sb-ink-muted">
          Each friend's share will be saved as an individual returnable expense
          due by the date above. You can track repayments under "Owed back to you"
          on your Dashboard.
        </p>
      </div>
    </Modal>
  )
}
