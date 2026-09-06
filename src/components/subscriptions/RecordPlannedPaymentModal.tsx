// ============================================
// RecordPlannedPaymentModal
// Allows logging a new payment or matching an existing transaction
// for a planned payment category.
// ============================================

import { useState, useMemo, type FormEvent } from 'react'
import { Modal, Button, Input, Badge } from '@/components/ui'
import { formatCurrency, formatDate, cn } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import { createTransaction, updateTransaction } from '@/services/transactions'
import { useAuth } from '@/context/AuthContext'
import { Plus, Link2, CheckCircle2, AlertCircle, Search } from 'lucide-react'

interface CandidateTransaction {
  id: string
  date: string
  amount: number
  type: string
  category: string
  description?: string | null
  merchant?: string | null
  payment_mode?: string | null
  approval_status?: string | null
}

interface RecordPlannedPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  categoryName: string
  categoryEmoji?: string
  expectedAmount?: number
  monthTransactions: CandidateTransaction[]
}

export default function RecordPlannedPaymentModal({
  isOpen,
  onClose,
  onSuccess,
  categoryName,
  categoryEmoji = '📅',
  expectedAmount,
  monthTransactions,
}: RecordPlannedPaymentModalProps) {
  const { user, currencySymbol } = useAuth()
  const [activeTab, setActiveTab] = useState<'log_new' | 'match_existing'>('log_new')

  // Log New Form State
  const [amount, setAmount] = useState<string>(expectedAmount ? String(expectedAmount) : '')
  const [date, setDate] = useState<string>(toISODateLocal(new Date()))
  const [description, setDescription] = useState<string>(`${categoryName} Payment`)
  const [merchant, setMerchant] = useState<string>('')
  const [paymentMode, setPaymentMode] = useState<string>('upi')

  // Match Existing Form State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTxn, setSelectedTxn] = useState<CandidateTransaction | null>(null)
  const [adjustedAmount, setAdjustedAmount] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filter candidate transactions: debits in this month that are not already tagged as this category
  const candidateTransactions = useMemo(() => {
    return monthTransactions.filter((t) => {
      if (t.type !== 'debit') return false
      if (t.approval_status && t.approval_status !== 'approved') return false
      if (t.category.trim().toLowerCase() === categoryName.trim().toLowerCase()) return false

      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      const matchesDesc = (t.description || '').toLowerCase().includes(q)
      const matchesMerchant = (t.merchant || '').toLowerCase().includes(q)
      const matchesCategory = t.category.toLowerCase().includes(q)
      const matchesAmount = String(t.amount).includes(q)
      return matchesDesc || matchesMerchant || matchesCategory || matchesAmount
    })
  }, [monthTransactions, categoryName, searchQuery])

  const handleSelectCandidate = (txn: CandidateTransaction) => {
    setSelectedTxn(txn)
    setAdjustedAmount(String(txn.amount))
  }

  const handleLogNew = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid payment amount.')
      return
    }

    if (!user) {
      setError('You must be signed in to record a payment.')
      return
    }

    setLoading(true)
    try {
      const { error: createError } = await createTransaction({
        user_id: user.id,
        amount: numAmount,
        type: 'debit',
        category: categoryName,
        description: description.trim() || `${categoryName} Payment`,
        merchant: merchant.trim() || description.trim() || categoryName,
        date,
        source: 'manual',
        approval_status: 'approved',
        payment_mode: paymentMode as any,
      })

      if (createError) {
        setError(createError.message)
        setLoading(false)
        return
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to record payment.')
    } finally {
      setLoading(false)
    }
  }

  const handleMatchExisting = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedTxn) {
      setError('Please select a transaction to match.')
      return
    }

    const numAmount = Number(adjustedAmount)
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid amount.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await updateTransaction(selectedTxn.id, {
        category: categoryName,
        amount: numAmount,
      })

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to match transaction.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Record Payment · ${categoryEmoji} ${categoryName}`}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Tab switcher */}
        <div className="flex rounded-xl bg-surface-2 p-1 border border-sb-hairline">
          <button
            type="button"
            onClick={() => {
              setActiveTab('log_new')
              setError('')
            }}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              activeTab === 'log_new'
                ? 'bg-surface-1 text-sb-ink shadow-xs'
                : 'text-sb-ink-muted hover:text-sb-ink'
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Log New Payment</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('match_existing')
              setError('')
            }}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer',
              activeTab === 'match_existing'
                ? 'bg-surface-1 text-sb-ink shadow-xs'
                : 'text-sb-ink-muted hover:text-sb-ink'
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Match Existing Expense ({candidateTransactions.length})</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3 text-xs text-[var(--status-danger-text)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: Log New Payment */}
        {activeTab === 'log_new' && (
          <form onSubmit={handleLogNew} className="flex flex-col gap-3.5">
            <p className="text-xs text-sb-ink-muted leading-relaxed">
              Log a new expense in your transactions. It will immediately mark this planned payment as cleared.
            </p>

            <Input
              id="plan-amount"
              label={`Amount paid (${currencySymbol})`}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="e.g. 15000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tnum font-semibold"
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="plan-date" className="block text-xs font-semibold text-sb-ink mb-1">
                  Payment date
                </label>
                <input
                  id="plan-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                  required
                />
              </div>

              <div>
                <label htmlFor="plan-mode" className="block text-xs font-semibold text-sb-ink mb-1">
                  Payment mode
                </label>
                <select
                  id="plan-mode"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-sb-hairline bg-surface-1 text-sm text-sb-ink font-medium focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all cursor-pointer"
                >
                  <option value="upi">⚡ UPI / AutoPay</option>
                  <option value="credit_card">💳 Credit Card</option>
                  <option value="debit_card">💳 Debit Card</option>
                  <option value="net_banking">🌐 Net Banking</option>
                  <option value="nach">🏦 NACH Mandate</option>
                  <option value="cash">💵 Cash</option>
                </select>
              </div>
            </div>

            <Input
              id="plan-desc"
              label="Description"
              placeholder={`e.g. ${categoryName} for this month`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <Input
              id="plan-merchant"
              label="Paid to / Merchant (optional)"
              placeholder="e.g. Landlord, Tata Power, Netflix"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />

            <div className="mt-2 flex items-center justify-end gap-2 pt-3 border-t border-sb-hairline">
              <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Record Payment
              </Button>
            </div>
          </form>
        )}

        {/* Tab 2: Match Existing Expense */}
        {activeTab === 'match_existing' && (
          <form onSubmit={handleMatchExisting} className="flex flex-col gap-3.5">
            <p className="text-xs text-sb-ink-muted leading-relaxed">
              Select an expense logged this month to link it to <strong>{categoryName}</strong>.
              This updates its category in your ledger with zero duplicate transactions.
            </p>

            <Input
              id="search-candidates"
              type="search"
              placeholder="Filter this month's expenses..."
              icon={<Search className="h-4 w-4 text-sb-ink-muted" />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <div className="max-h-56 overflow-y-auto rounded-xl border border-sb-hairline bg-surface-2/40 p-1 flex flex-col gap-1.5">
              {candidateTransactions.length === 0 ? (
                <div className="py-8 text-center text-xs text-sb-ink-muted">
                  No unmatched debit transactions found for this month.
                </div>
              ) : (
                candidateTransactions.map((txn) => {
                  const isSelected = selectedTxn?.id === txn.id
                  return (
                    <button
                      key={txn.id}
                      type="button"
                      onClick={() => handleSelectCandidate(txn)}
                      className={cn(
                        'flex items-center justify-between p-2.5 rounded-lg text-left transition-all border cursor-pointer',
                        isSelected
                          ? 'border-brand-500 bg-brand-50/80 ring-1 ring-brand-500/30'
                          : 'border-transparent bg-surface-1 hover:border-sb-hairline'
                      )}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-sb-ink truncate">
                            {txn.merchant || txn.description || 'Transaction'}
                          </span>
                          <Badge variant="default" size="sm">
                            {txn.category}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-sb-ink-muted tnum">
                          {formatDate(txn.date)}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold text-sb-ink tnum">
                          {formatCurrency(txn.amount)}
                        </span>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {selectedTxn && (
              <div className="rounded-xl border border-brand-200/80 bg-brand-50/50 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-brand-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-brand-600" />
                    Selected for matching
                  </span>
                  <span className="text-xs text-brand-700">
                    Will re-tag to <strong>{categoryName}</strong>
                  </span>
                </div>

                <div>
                  <label htmlFor="adjust-amount" className="block text-xs font-medium text-sb-ink mb-1">
                    Amount (₹) — adjust if there was an increment or change
                  </label>
                  <Input
                    id="adjust-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={adjustedAmount}
                    onChange={(e) => setAdjustedAmount(e.target.value)}
                    className="tnum font-semibold"
                    required
                  />
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center justify-end gap-2 pt-3 border-t border-sb-hairline">
              <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" loading={loading} disabled={!selectedTxn}>
                Match & Update Category
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
