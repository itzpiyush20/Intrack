// ============================================
// DebtsManager — Loans & Debts Command Center
// Tracks active borrowings and repayments across credit card cash advances, banks, and family/friends
// ============================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Modal,
  EmptyState,
  Skeleton,
  SECTION_LABEL,
  staggerParent,
  staggerChild,
  rowVariants,
} from '@/components/ui'
import {
  getActiveDebts,
  recordDebtTransaction,
  LOAN_SOURCE_LABELS,
  LOAN_SOURCE_DESCRIPTIONS,
  type ActiveDebtSummary,
  type LoanSource,
} from '@/services/debts'
import { getCards } from '@/services/cards'
import { formatCurrency, formatDate, toISODateLocal, cn } from '@/utils'
import { useToast } from '@/context'
import type { Card as CardType } from '@/types'
import {
  Landmark,
  CreditCard,
  Users,
  HandCoins,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingDown,
  Clock,
  CircleDollarSign,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'

const SOURCE_ICONS: Record<LoanSource, React.ComponentType<{ className?: string }>> = {
  bank: Landmark,
  credit_card: CreditCard,
  family_friend: Users,
  other: HandCoins,
}

export default function DebtsManager() {
  const reduceMotion = useReducedMotion()
  const { showToast } = useToast()

  const [summary, setSummary] = useState<ActiveDebtSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter for transactions ledger
  const [filterSource, setFilterSource] = useState<'all' | LoanSource>('all')

  // Modal for recording a new borrowing / repayment
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [userCards, setUserCards] = useState<CardType[]>([])

  // Modal form states
  const [txnType, setTxnType] = useState<'credit' | 'debit'>('credit') // credit = borrowing, debit = repayment
  const [source, setSource] = useState<LoanSource>('bank')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(toISODateLocal(new Date()))
  const [cardId, setCardId] = useState('')
  const [sourceNote, setSourceNote] = useState('')

  const loadDebts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await getActiveDebts()
      if (err) throw err
      setSummary(data)
    } catch (err: any) {
      console.error('Failed to load debts summary:', err)
      setError(err.message || 'Could not load active loans & debts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDebts()
    getCards().then(({ data }) => {
      if (data) setUserCards(data.filter((c) => !c.is_archived))
    })
  }, [loadDebts])

  const handleOpenModal = (defaultSource?: LoanSource, defaultType: 'credit' | 'debit' = 'credit') => {
    setTxnType(defaultType)
    if (defaultSource) setSource(defaultSource)
    setAmount('')
    setDescription(defaultType === 'credit' ? 'Loan borrowing' : 'Loan repayment')
    setDate(toISODateLocal(new Date()))
    setCardId('')
    setSourceNote('')
    setIsModalOpen(true)
  }

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast('Enter a valid amount greater than zero.', 'warning')
      return
    }

    if (!description.trim()) {
      showToast('Please enter a brief description.', 'warning')
      return
    }

    if (source === 'credit_card' && userCards.length > 0 && !cardId) {
      showToast('Please select which credit card was used.', 'warning')
      return
    }

    setModalLoading(true)
    try {
      const { error: err } = await recordDebtTransaction({
        type: txnType,
        amount: parsedAmount,
        loan_source: source,
        loan_source_note: sourceNote.trim() || undefined,
        description: description.trim(),
        date,
        card_id: source === 'credit_card' ? cardId : null,
      })

      if (err) throw err

      showToast(
        txnType === 'credit'
          ? `Logged borrowing of ${formatCurrency(parsedAmount)}`
          : `Logged repayment of ${formatCurrency(parsedAmount)}`,
        'success'
      )
      setIsModalOpen(false)
      await loadDebts()
    } catch (err: any) {
      console.error('Failed to record debt transaction:', err)
      showToast(err.message || 'Failed to record entry.', 'error')
    } finally {
      setModalLoading(false)
    }
  }

  const filteredTransactions = useMemo(() => {
    if (!summary) return []
    if (filterSource === 'all') return summary.transactions
    return summary.transactions.filter((t) => t.loan_source === filterSource)
  }, [summary, filterSource])

  const overallRepaidPct = useMemo(() => {
    if (!summary || summary.totalBorrowed <= 0) return 0
    return Math.min(100, Math.round((summary.totalRepaid / summary.totalBorrowed) * 100))
  }, [summary])

  return (
    <div className="space-y-6">
      {/* Header card with action */}
      <Card className="relative overflow-hidden border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 sm:p-6 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-brand-500/10 text-brand-700 dark:text-brand-400 border border-brand-500/20 shadow-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
                Active Ledger
              </span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-sb-ink sm:text-2xl">
              Loans & Debts Hub
            </h2>
            <p className="mt-1 text-sm text-sb-ink-muted max-w-xl leading-relaxed">
              Track outstanding balances across credit card cash advances, bank loans, and family/friend borrowings.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleOpenModal(undefined, 'credit')}
              className="gap-1.5 shadow-xs font-semibold"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>Record Borrowing / Repayment</span>
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-sm text-[var(--status-danger-text)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </Card>

      {/* Headline Metric Cards */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5 border-sb-hairline bg-surface-1">
              <Skeleton className="h-3.5 w-24 mb-3" />
              <Skeleton className="h-8 w-36 mb-2" />
              <Skeleton className="h-3 w-48" />
            </Card>
          ))}
        </div>
      ) : summary ? (
        <motion.div
          className="grid gap-3 sm:grid-cols-3"
          variants={staggerParent(reduceMotion, 3)}
          initial="initial"
          animate="animate"
        >
          {/* Outstanding Active Debt */}
          <motion.div variants={staggerChild(reduceMotion)}>
            <Card className="relative overflow-hidden p-5 border-sb-hairline bg-surface-1 shadow-card h-full before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-amber-500 before:to-transparent">
              <div className="flex items-center justify-between">
                <p className={SECTION_LABEL}>Total Active Debt</p>
                <span
                  className={cn(
                    'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full',
                    summary.totalOutstanding > 0
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  )}
                >
                  {summary.totalOutstanding > 0 ? 'Outstanding' : 'Debt Free'}
                </span>
              </div>
              <p
                className={cn(
                  'mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight tnum',
                  summary.totalOutstanding > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600'
                )}
              >
                {formatCurrency(summary.totalOutstanding)}
              </p>
              <p className="mt-2 text-xs font-medium text-sb-ink-muted">
                {summary.totalOutstanding > 0
                  ? 'Total remaining to be repaid across all sources'
                  : 'All recorded borrowings have been completely repaid'}
              </p>
            </Card>
          </motion.div>

          {/* Total Borrowed */}
          <motion.div variants={staggerChild(reduceMotion)}>
            <Card className="relative overflow-hidden p-5 border-sb-hairline bg-surface-1 shadow-card h-full before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
              <div className="flex items-center justify-between">
                <p className={SECTION_LABEL}>Total Borrowed</p>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-surface-2 text-sb-ink-muted">
                  Advances In
                </span>
              </div>
              <p className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-sb-ink tnum">
                {formatCurrency(summary.totalBorrowed)}
              </p>
              <p className="mt-2 text-xs font-medium text-sb-ink-muted">
                Cumulative money received through loans & advances
              </p>
            </Card>
          </motion.div>

          {/* Total Repaid */}
          <motion.div variants={staggerChild(reduceMotion)}>
            <Card className="relative overflow-hidden p-5 border-sb-hairline bg-surface-1 shadow-card h-full before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-emerald-500 before:to-transparent">
              <div className="flex items-center justify-between">
                <p className={SECTION_LABEL}>Total Repaid</p>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  {overallRepaidPct}% Repaid
                </span>
              </div>
              <p className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400 tnum">
                {formatCurrency(summary.totalRepaid)}
              </p>
              <p className="mt-2 text-xs font-medium text-sb-ink-muted">
                Settled back to banks, credit cards, and lenders
              </p>
            </Card>
          </motion.div>
        </motion.div>
      ) : null}

      {/* Sources Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-sb-ink-muted">
            Borrowing Sources Breakdown
          </h3>
          <span className="text-xs text-sb-ink-muted font-medium">
            Credit Cards · Banks · Family & Friends · Other
          </span>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="p-4 border-sb-hairline bg-surface-1">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-20 mb-4" />
                <Skeleton className="h-2 w-full rounded-full" />
              </Card>
            ))}
          </div>
        ) : summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summary.bySourceList.map((src) => {
              const Icon = SOURCE_ICONS[src.source] || HandCoins
              const repaidPct =
                src.borrowed > 0
                  ? Math.min(100, Math.round((src.repaid / src.borrowed) * 100))
                  : 100

              return (
                <Card
                  key={src.source}
                  className="relative overflow-hidden border-sb-hairline bg-surface-1 p-4 shadow-card hover:shadow-card-hover transition-all duration-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-brand-600 shrink-0 shadow-xs">
                        <Icon className="h-4 w-4" />
                      </span>
                      <h4 className="text-sm font-bold text-sb-ink truncate" title={src.label}>
                        {src.label}
                      </h4>
                    </div>

                    {src.outstanding > 0 ? (
                      <Badge variant="warning" size="sm">
                        Owed
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        Cleared
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 space-y-1">
                    <p className="text-xs text-sb-ink-muted font-medium">Outstanding Balance</p>
                    <p className="text-lg font-bold text-sb-ink tnum">
                      {formatCurrency(src.outstanding)}
                    </p>
                  </div>

                  {/* Progress bar of repayment */}
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[11px] font-medium text-sb-ink-muted tnum">
                      <span>Repaid {formatCurrency(src.repaid)}</span>
                      <span>{repaidPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all duration-500"
                        style={{ width: `${repaidPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-sb-hairline/60 flex items-center justify-between text-xs">
                    <span className="text-sb-ink-muted">
                      Total borrowed: <strong className="tnum text-sb-ink font-semibold">{formatCurrency(src.borrowed)}</strong>
                    </span>
                    <button
                      onClick={() => handleOpenModal(src.source, src.outstanding > 0 ? 'debit' : 'credit')}
                      className="text-brand-600 hover:text-brand-700 font-semibold inline-flex items-center gap-0.5 cursor-pointer"
                    >
                      {src.outstanding > 0 ? 'Repay' : 'Borrow'} &rarr;
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Transaction Ledger */}
      <Card className="border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-sb-ink">
              Borrowing & Repayment History
            </h3>
            <p className="text-xs text-sb-ink-muted">
              Record of incoming loan advances and outgoing settlement payments.
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {(['all', 'bank', 'credit_card', 'family_friend', 'other'] as const).map((key) => {
              const isActive = filterSource === key
              const label =
                key === 'all'
                  ? 'All Sources'
                  : key === 'credit_card'
                  ? 'Credit Card'
                  : key === 'bank'
                  ? 'Bank'
                  : key === 'family_friend'
                  ? 'Family & Friends'
                  : 'Other'

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterSource(key)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-500/30'
                      : 'text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 border-b border-sb-hairline">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="No loan records found"
            description={
              filterSource === 'all'
                ? 'You have not recorded any borrowings or loan repayments yet. Click "Record Borrowing / Repayment" above to log one.'
                : `No transactions found under ${LOAN_SOURCE_LABELS[filterSource]}.`
            }
          />
        ) : (
          <ul className="divide-y divide-sb-hairline">
            <AnimatePresence initial={false}>
              {filteredTransactions.map((txn) => {
                const isBorrowing = txn.type === 'credit'
                const Icon = SOURCE_ICONS[txn.loan_source] || HandCoins

                return (
                  <motion.li
                    key={txn.id}
                    layout={!reduceMotion}
                    variants={rowVariants(reduceMotion)}
                    exit="exit"
                    className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between first:pt-1 last:pb-1"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl shrink-0 text-sm shadow-xs',
                          isBorrowing
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'bg-brand-500/10 text-brand-700 dark:text-brand-400'
                        )}
                      >
                        {isBorrowing ? (
                          <ArrowDownLeft className="h-4.5 w-4.5" />
                        ) : (
                          <ArrowUpRight className="h-4.5 w-4.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-sb-ink truncate">
                            {txn.description}
                          </p>
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-sb-ink-muted border border-sb-hairline">
                            <Icon className="h-3 w-3 text-brand-600" />
                            {LOAN_SOURCE_LABELS[txn.loan_source]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-sb-ink-muted">
                          <span>{formatDate(txn.date)}</span>
                          {txn.loan_source_note && (
                            <span> · {txn.loan_source_note}</span>
                          )}
                          {txn.counterparty && <span> · {txn.counterparty}</span>}
                        </p>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0 ml-12 sm:ml-0">
                      <p
                        className={cn(
                          'text-sm font-bold tnum',
                          isBorrowing
                            ? 'text-sb-ink'
                            : 'text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {isBorrowing ? '+ ' : '- '}
                        {formatCurrency(txn.amount)}
                      </p>
                      <span className="text-[11px] font-medium text-sb-ink-muted">
                        {isBorrowing ? 'Borrowed (In)' : 'Repaid (Settled)'}
                      </span>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </Card>

      {/* Record Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={txnType === 'credit' ? 'Record Borrowed Money' : 'Record Loan Repayment'}
        footer={null}
      >
        <form onSubmit={handleRecordSubmit} className="space-y-4">
          {/* Toggle Borrowing vs Repayment */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted mb-1.5">
              Action
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTxnType('credit')
                  if (!description || description === 'Loan repayment') setDescription('Loan advance received')
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-sm font-semibold transition-colors cursor-pointer',
                  txnType === 'credit'
                    ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-400 font-bold'
                    : 'border-sb-hairline bg-surface-2 text-sb-ink-muted hover:text-sb-ink'
                )}
              >
                <ArrowDownLeft className="h-4 w-4" />
                <span>Borrowed (Money in)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTxnType('debit')
                  if (!description || description === 'Loan advance received') setDescription('Loan repayment')
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-sm font-semibold transition-colors cursor-pointer',
                  txnType === 'debit'
                    ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-400 font-bold'
                    : 'border-sb-hairline bg-surface-2 text-sb-ink-muted hover:text-sb-ink'
                )}
              >
                <ArrowUpRight className="h-4 w-4" />
                <span>Repaid (Settled)</span>
              </button>
            </div>
          </div>

          {/* Loan Source */}
          <Select
            label="Loan Source"
            value={source}
            onChange={(e) => setSource(e.target.value as LoanSource)}
          >
            <option value="bank">🏛️ Bank (Personal Loan, Overdraft, EMI)</option>
            <option value="credit_card">💳 Credit Card (Cash Advance / Transfer)</option>
            <option value="family_friend">👥 Family & Friends</option>
            <option value="other">🤝 Other / Peer-to-Peer</option>
          </Select>

          {source === 'credit_card' && userCards.length > 0 && (
            <Select
              label="Credit Card"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              required
            >
              <option value="">Select card</option>
              {userCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (•••• {c.last4})
                </option>
              ))}
            </Select>
          )}

          {(source === 'family_friend' || source === 'other') && (
            <Input
              label="Lender / Note"
              placeholder="e.g. Uncle Ramesh or Friend Amit"
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
            />
          )}

          {/* Amount */}
          <Input
            label="Amount (₹)"
            type="number"
            inputMode="decimal"
            placeholder="25000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="1"
            required
            className="tnum"
          />

          {/* Date */}
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          {/* Description */}
          <Input
            label="Description"
            placeholder={txnType === 'credit' ? 'e.g. Advance for medical expense' : 'e.g. 1st installment payback'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-sb-hairline">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={modalLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={modalLoading}
              disabled={modalLoading}
              className="gap-1.5 font-semibold"
            >
              {txnType === 'credit' ? 'Save Borrowing' : 'Save Repayment'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
