// ============================================
// BalanceManager — Settings section for Available Money (Cash + Bank)
//
// Governed by plans/accounts-and-balances.md:
// 1. One cumulative money figure: cash in hand + bank balances.
// 2. User enters today's figures; opening = today − movements since the 1st.
// 3. INR only — foreign currencies excluded.
// 4. Prospective changes: past months remain fixed.
// 5. 1-tap drift reconciliation for discrepancy between actual and computed.
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Card, Button, Input, Modal, EmptyState } from '@/components/ui'
import { useToast } from '@/context'
import {
  getAvailableMoney,
  setAvailableMoneyToday,
  recordDriftReconciliation,
  type AvailableMoneyState,
} from '@/services/balances'
import { formatCurrency } from '@/utils'
import {
  Wallet,
  Pencil,
  Check,
  X,
  Scale,
  TrendingUp,
  TrendingDown,
  Info,
  Calendar,
} from 'lucide-react'

export default function BalanceManager() {
  const { showToast } = useToast()
  const reduceMotion = useReducedMotion()

  const [balanceState, setBalanceState] = useState<AvailableMoneyState | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit today's balance state
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Drift reconciliation modal state
  const [showDriftModal, setShowDriftModal] = useState(false)
  const [driftActualAmount, setDriftActualAmount] = useState('')
  const [driftNotes, setDriftNotes] = useState('')
  const [savingDrift, setSavingDrift] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const state = await getAvailableMoney()
      setBalanceState(state)
    } catch (err: any) {
      showToast(err.message || 'Could not load available money balance.', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void (async () => {
      await loadData()
    })()
  }, [loadData])

  const startEditing = () => {
    setEditDraft(balanceState?.current !== undefined ? String(balanceState.current) : '')
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditDraft('')
  }

  const handleSaveBalance = async () => {
    const amount = Number(editDraft)
    if (!editDraft.trim() || !Number.isFinite(amount) || amount < 0) {
      showToast('Please enter a valid positive balance.', 'error')
      return
    }

    setSavingEdit(true)
    const { error } = await setAvailableMoneyToday(amount)
    setSavingEdit(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    setIsEditing(false)
    showToast('Available money updated for this month.', 'success')
    void loadData()
  }

  const openDriftModal = () => {
    setDriftActualAmount(balanceState?.current !== undefined ? String(balanceState.current) : '')
    setDriftNotes('')
    setShowDriftModal(true)
  }

  const handleRecordDrift = async () => {
    if (!balanceState) return
    const actual = Number(driftActualAmount)
    if (!driftActualAmount.trim() || !Number.isFinite(actual) || actual < 0) {
      showToast('Please enter your actual balance.', 'error')
      return
    }

    const diff = actual - balanceState.current
    if (diff === 0) {
      showToast('Actual balance matches computed balance. No adjustment needed.', 'info')
      setShowDriftModal(false)
      return
    }

    setSavingDrift(true)
    const { error } = await recordDriftReconciliation({
      target: 'bank',
      diff,
      notes: driftNotes.trim() || undefined,
    })
    setSavingDrift(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    setShowDriftModal(false)
    showToast(
      diff > 0
        ? `Reconciliation recorded: +${formatCurrency(diff)} income adjustment.`
        : `Reconciliation recorded: ${formatCurrency(diff)} expense adjustment.`,
      'success'
    )
    void loadData()
  }

  const computedCurrent = balanceState?.current ?? 0
  const driftActualNum = Number(driftActualAmount)
  const driftDiff = Number.isFinite(driftActualNum) && driftActualAmount.trim() !== ''
    ? driftActualNum - computedCurrent
    : 0

  return (
    <Card className="relative overflow-hidden border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h2 className="text-base font-bold text-sb-ink flex items-center gap-2">
          <Wallet className="h-5 w-5 text-brand-600 shrink-0" />
          <span>Available Money (Cash & Bank)</span>
        </h2>
        {balanceState?.isConfigured && !isEditing && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={openDriftModal}
              className="gap-1.5 shrink-0 shadow-xs text-xs"
            >
              <Scale className="h-3.5 w-3.5" /> Reconcile Drift
            </Button>
            <Button
              size="sm"
              onClick={startEditing}
              className="gap-1.5 shrink-0 shadow-xs text-xs"
            >
              <Pencil className="h-3.5 w-3.5" /> Set Balance
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-sb-ink-muted mb-5 leading-relaxed">
        One cumulative pool for cash in hand and all bank balances. Past months stay locked; changes take effect today forward.
      </p>

      {loading ? (
        <div className="h-28 rounded-xl skeleton opacity-70" />
      ) : !balanceState?.isConfigured ? (
        /* Not configured yet */
        <EmptyState
          icon="💰"
          title="Available money not configured"
          description="Set what you currently have in your bank accounts and cash in hand today. Intrack will track your running balance automatically."
          action={
            isEditing ? (
              <div className="w-full max-w-sm space-y-3 pt-2">
                <Input
                  label="Available money today"
                  id="initial-balance-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 50000"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  className="tnum"
                  autoFocus
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={cancelEditing}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveBalance}
                    loading={savingEdit}
                    className="gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" /> Save Balance
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={startEditing} className="gap-1.5 shadow-xs">
                <Wallet className="h-3.5 w-3.5" /> Set starting balance
              </Button>
            )
          }
        />
      ) : (
        /* Configured view */
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {isEditing ? (
              <motion.div
                key="editing"
                initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                className="rounded-xl border border-brand-500/30 bg-surface-2/70 p-4 shadow-xs"
              >
                <p className="text-xs font-semibold text-sb-ink mb-1">Set today's available balance</p>
                <p className="text-xs text-sb-ink-muted mb-3 leading-relaxed">
                  Enter your total bank and cash money today. Intrack adjusts your month opening balance backwards, keeping all recorded transactions intact.
                </p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5">
                  <div className="flex-1">
                    <Input
                      label="Balance today (₹)"
                      id="edit-available-today"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="tnum"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={handleSaveBalance}
                      loading={savingEdit}
                      className="gap-1.5 shadow-xs flex-1 sm:flex-initial"
                    >
                      <Check className="h-3.5 w-3.5" /> Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelEditing}
                      className="flex-1 sm:flex-initial"
                    >
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="viewing"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-sb-hairline bg-surface-2/40 p-4 sm:p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-sb-ink-muted">
                      Today's Available Balance
                    </span>
                    <p className="text-2xl sm:text-3xl font-extrabold text-sb-ink tnum mt-1 tracking-tight">
                      {formatCurrency(balanceState.current)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-sb-ink-muted self-start sm:self-auto bg-surface-1 px-2.5 py-1 rounded-lg border border-sb-hairline shadow-xs">
                    <Calendar className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                    <span>Current month: <span className="font-semibold text-sb-ink tnum">{balanceState.month}</span></span>
                  </div>
                </div>

                {/* Breakdown metrics */}
                <div className="mt-4 pt-4 border-t border-sb-hairline grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-surface-1 border border-sb-hairline p-3">
                    <p className="text-sb-ink-muted">Month Opening (1st of month)</p>
                    <p className="text-base font-bold text-sb-ink tnum mt-0.5">
                      {formatCurrency(balanceState.opening)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-1 border border-sb-hairline p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sb-ink-muted">Net Movement This Month</p>
                      {balanceState.netMovement >= 0 ? (
                        <TrendingUp className="h-3.5 w-3.5 text-[var(--status-positive-text)]" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-sb-ink-muted" />
                      )}
                    </div>
                    <p
                      className={`text-base font-bold tnum mt-0.5 ${
                        balanceState.netMovement >= 0
                          ? 'text-[var(--status-positive-text)]'
                          : 'text-sb-ink'
                      }`}
                    >
                      {balanceState.netMovement >= 0 ? '+' : ''}
                      {formatCurrency(balanceState.netMovement)}
                    </p>
                  </div>
                </div>

                {balanceState.unaccountedForeignCount > 0 && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-sb-ink-muted bg-surface-1 border border-sb-hairline p-2.5 rounded-lg">
                    <Info className="h-3.5 w-3.5 mt-0.5 text-brand-600 shrink-0" />
                    <span>
                      {balanceState.unaccountedForeignCount} foreign currency transaction
                      {balanceState.unaccountedForeignCount === 1 ? '' : 's'} excluded (INR only).
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 1-Tap Drift Reconciliation Modal */}
      <Modal
        isOpen={showDriftModal}
        onClose={() => setShowDriftModal(false)}
        title="Reconcile Bank & Cash Drift"
        footer={
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowDriftModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRecordDrift}
              loading={savingDrift}
              disabled={driftDiff === 0 || !driftActualAmount.trim()}
              className="gap-1.5 shadow-xs"
            >
              <Check className="h-3.5 w-3.5" /> Confirm Reconciliation
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-sb-ink-secondary leading-relaxed">
            If your banking app shows a different number from Intrack's computed balance (due to interest, bank fees, or cash spends), Intrack will log a 1-tap adjustment transaction to bring them in sync.
          </p>

          <div className="rounded-xl border border-sb-hairline bg-surface-2/50 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sb-ink-muted">Intrack's Computed Balance:</span>
              <span className="font-bold text-sb-ink tnum">{formatCurrency(computedCurrent)}</span>
            </div>
          </div>

          <Input
            label="Actual Total Bank & Cash Balance Today"
            id="drift-actual-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="e.g. 52400"
            value={driftActualAmount}
            onChange={(e) => setDriftActualAmount(e.target.value)}
            className="tnum"
            autoFocus
          />

          {driftActualAmount.trim() !== '' && (
            <div
              className={`rounded-xl border p-3 text-xs space-y-1 ${
                driftDiff === 0
                  ? 'border-sb-hairline bg-surface-2/50 text-sb-ink-muted'
                  : driftDiff > 0
                  ? 'border-emerald-200/80 bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                  : 'border-brand-200/80 bg-surface-2 text-sb-ink'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span>Discrepancy (Drift):</span>
                <span className="tnum font-bold">
                  {driftDiff > 0 ? `+${formatCurrency(driftDiff)}` : formatCurrency(driftDiff)}
                </span>
              </div>
              <p className="text-[11px] opacity-90">
                {driftDiff === 0
                  ? 'Balances are already in sync.'
                  : driftDiff > 0
                  ? 'Bank has more funds than tracked. A Credit (Income) adjustment will be logged.'
                  : 'Bank has less funds than tracked. A Debit (Expense) adjustment will be logged.'}
              </p>
            </div>
          )}

          <Input
            label="Adjustment Notes (optional)"
            id="drift-notes-input"
            type="text"
            placeholder="e.g. Bank interest / rounding correction"
            value={driftNotes}
            onChange={(e) => setDriftNotes(e.target.value)}
          />
        </div>
      </Modal>
    </Card>
  )
}
