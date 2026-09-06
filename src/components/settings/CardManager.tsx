// ============================================
// CardManager — Settings section for credit cards the user defines
//
// Phase 2 of plans/accounts-and-balances.md. These are cards a person
// deliberately set up because they want an outstanding tracked, not cards
// detected from email.
//
// Three owner rules from 2026-09-05 shape this screen:
//
//  1. Never ask for a figure as of a past date. Nobody can look up what a card
//     owed on the 1st; what they can read off their banking app is what it owes
//     today. The service converts today's figure to the month opening the
//     column stores.
//  2. Name and last 4 digits are required; bank and network are not. The last
//     four are what the email scanner matches an alert to a card by, which is
//     why they are not optional.
//  3. Bank and last 4 freeze once the card has its first transaction, and are
//     freely correctable until then. The card name is always editable: nothing
//     traces by name, rows point at card_id.
//
// The list shows each balance as a figure, not as a permanently-open input —
// an input holding its value as a placeholder reads as an empty field. Editing
// one is a deliberate act: press Edit, the row swaps to an input, save or
// cancel. Adding and editing details happen in CardFormModal, the same shape
// CategoryManager uses on this page.
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Card, Button, Input, Modal, ConfirmDialog, EmptyState, ACTION_BUTTON, ACTION_BUTTON_DANGER,
} from '@/components/ui'
import { useToast } from '@/context'
import {
  getCards, setCardArchived, deleteCard, getCardPeriods, setCardOpening,
  getCardMovementsSince, getCardUsageCounts, monthKey, todayKey,
} from '@/services/cards'
import { recordDriftReconciliation } from '@/services/balances'
import { formatCurrency } from '@/utils'
import { CreditCard, Plus, Archive, ArchiveRestore, Trash2, Pencil, Lock, AlertTriangle, Check, X, Scale } from 'lucide-react'
import CardFormModal from './CardFormModal'
import type { Card as CardRow, CardPeriod } from '@/types'

export default function CardManager() {
  const { showToast } = useToast()

  const [cards, setCards] = useState<CardRow[]>([])
  const [openings, setOpenings] = useState<Record<string, number>>({})
  // What each card has done since the 1st. Zero for every card until Phase 3
  // lets a transaction name one.
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  // How many transactions point at each card — what decides whether its bank
  // and last four are still editable.
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  // null = closed, 'new' = creating, a card = editing that one.
  const [formTarget, setFormTarget] = useState<CardRow | 'new' | null>(null)

  const [balanceEditId, setBalanceEditId] = useState<string | null>(null)
  const [balanceDraft, setBalanceDraft] = useState('')
  const [savingBalance, setSavingBalance] = useState(false)

  const [driftTarget, setDriftTarget] = useState<CardRow | null>(null)
  const [driftActualAmount, setDriftActualAmount] = useState('')
  const [driftNotes, setDriftNotes] = useState('')
  const [savingDrift, setSavingDrift] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<CardRow | null>(null)

  // The month whose opening figure is editable. Past months are deliberately
  // not reachable from here: the owner's rule is that a correction takes effect
  // from the current month forward and never rewrites what earlier months
  // already reported.
  const month = monthKey()
  const today = todayKey()

  // Motion here says a row arrived or left, nothing more.
  const reduceMotion = useReducedMotion()

  // No setState before the first await. Calling one synchronously from an
  // effect trips react-hooks/set-state-in-effect, and `loading` already starts
  // true, so raising it here bought nothing. Refreshes after a mutation keep
  // the list on screen rather than flashing a skeleton, which reads better.
  const load = useCallback(async () => {
    const [{ data: cardRows, error }, { data: periods }, { data: movements }, { data: counts }] =
      await Promise.all([
        getCards(),
        getCardPeriods(month),
        getCardMovementsSince(month, today),
        getCardUsageCounts(),
      ])
    if (error) showToast(error.message || 'Could not load your cards.', 'error')
    setCards(cardRows || [])
    const map: Record<string, number> = {}
    ;(periods as CardPeriod[] | null)?.forEach((p) => { map[p.card_id] = Number(p.opening_outstanding) })
    setOpenings(map)
    setDeltas(movements || {})
    setUsage(counts || {})
    setLoading(false)
  }, [month, today, showToast])

  useEffect(() => {
    // Wrapped rather than called bare so every setState lands in load's
    // post-await continuation instead of synchronously in this effect body —
    // react-hooks/set-state-in-effect flags the latter, and the repo's rule is
    // not to add to that baseline.
    void (async () => { await load() })()
  }, [load])

  /** True once anything points at the card: its bank and last four are fixed. */
  const isLocked = (cardId: string) => (usage[cardId] ?? 0) > 0

  /** What the card owes today: the month's opening plus everything since. */
  const owedToday = (cardId: string): number | undefined => {
    const opening = openings[cardId]
    if (opening === undefined) return undefined
    return opening + (deltas[cardId] ?? 0)
  }

  const startBalanceEdit = (card: CardRow) => {
    const current = owedToday(card.id)
    setBalanceEditId(card.id)
    setBalanceDraft(current === undefined ? '' : String(current))
  }

  const handleBalanceSave = async (card: CardRow) => {
    const amount = Number(balanceDraft)
    if (!balanceDraft.trim() || !Number.isFinite(amount) || amount < 0) {
      showToast('Enter the amount owed as a positive number.', 'error')
      return
    }
    // The user typed today's figure; the column stores the month's opening.
    const opening = amount - (deltas[card.id] ?? 0)
    setSavingBalance(true)
    const { error } = await setCardOpening(card.id, month, opening)
    setSavingBalance(false)
    if (error) { showToast(error.message, 'error'); return }
    setOpenings((prev) => ({ ...prev, [card.id]: opening }))
    setBalanceEditId(null)
    showToast('Balance updated.', 'success')
  }

  const startDriftReconciliation = (card: CardRow) => {
    const current = owedToday(card.id)
    setDriftTarget(card)
    setDriftActualAmount(current === undefined ? '' : String(current))
    setDriftNotes('')
  }

  const handleRecordCardDrift = async () => {
    if (!driftTarget) return
    const actual = Number(driftActualAmount)
    if (!driftActualAmount.trim() || !Number.isFinite(actual) || actual < 0) {
      showToast('Please enter your actual card balance.', 'error')
      return
    }

    const current = owedToday(driftTarget.id) ?? 0
    const diff = actual - current
    if (diff === 0) {
      showToast('Actual balance matches computed balance. No adjustment needed.', 'info')
      setDriftTarget(null)
      return
    }

    setSavingDrift(true)
    const { error } = await recordDriftReconciliation({
      target: 'card',
      cardId: driftTarget.id,
      diff,
      notes: driftNotes.trim() || undefined,
    })
    setSavingDrift(false)

    if (error) {
      showToast(error.message, 'error')
      return
    }

    setDriftTarget(null)
    showToast(
      diff > 0
        ? `Card reconciliation recorded: +${formatCurrency(diff)} adjustment.`
        : `Card reconciliation recorded: ${formatCurrency(Math.abs(diff))} adjustment.`,
      'success'
    )
    void load()
  }

  const handleArchive = async (card: CardRow) => {
    const { error } = await setCardArchived(card.id, !card.is_archived)
    if (error) { showToast(error.message, 'error'); return }
    showToast(card.is_archived ? 'Card restored.' : 'Card archived. Its history is unchanged.', 'success')
    void load()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const { error } = await deleteCard(deleteTarget.id)
    setDeleteTarget(null)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Card deleted.', 'success')
    void load()
  }

  const handleSaved = (message: string) => {
    setFormTarget(null)
    showToast(message, 'success')
    void load()
  }

  const active = cards.filter((c) => !c.is_archived)
  const archived = cards.filter((c) => c.is_archived)

  const renderCard = (card: CardRow) => {
    const owed = owedToday(card.id)
    const editingBalance = balanceEditId === card.id
    const locked = isLocked(card.id)
    // A card sharing its digits with another and carrying no bank name is
    // ambiguous to the user and unmatchable by the scanner.
    const ambiguous = !!card.last4 && !card.issuer &&
      cards.some((c) => c.last4 === card.last4 && c.id !== card.id)

    return (
      <motion.li
        key={card.id}
        layout={!reduceMotion}
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-sb-hairline bg-surface-1 shadow-xs p-4 transition-all hover:border-brand-500/30 hover:shadow-card"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-xl bg-brand-50 text-brand-700 border border-brand-200/70 flex items-center justify-center shadow-xs"
          >
            <CreditCard className="h-5 w-5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-sb-ink truncate">{card.name}</p>
            <p className="mt-0.5 text-xs text-sb-ink-muted truncate tnum">
              {[card.issuer, card.brand, card.last4 && `•••• ${card.last4}`].filter(Boolean).join(' · ') ||
                'No bank or digits yet'}
              {locked && (
                <span className="inline-flex items-center gap-1 ml-2 align-middle text-sb-ink-muted">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Bank and digits are fixed</span>
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => setFormTarget(card)}
              title="Edit card details"
              aria-label={`Edit ${card.name}`}
              className={ACTION_BUTTON}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleArchive(card)}
              title={card.is_archived ? 'Restore card' : 'Archive card'}
              aria-label={card.is_archived ? `Restore ${card.name}` : `Archive ${card.name}`}
              className={ACTION_BUTTON}
            >
              {card.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setDeleteTarget(card)}
              title="Delete card"
              aria-label={`Delete ${card.name}`}
              className={ACTION_BUTTON_DANGER}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {ambiguous && (
          <p className="mt-3 flex items-start gap-2 text-xs text-[var(--status-warning-text)]">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>Another card also ends {card.last4}. Add this one’s bank so they can be told apart.</span>
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-sb-hairline">
          {editingBalance ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <Input
                  label="Outstanding balance today"
                  id={`balance-${card.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={balanceDraft}
                  onChange={(e) => setBalanceDraft(e.target.value)}
                  className="tnum"
                  autoFocus
                />
              </div>
              <Button
                size="sm"
                onClick={() => handleBalanceSave(card)}
                loading={savingBalance}
                aria-label={`Save balance for ${card.name}`}
                className="shrink-0 gap-1.5 shadow-xs"
              >
                <Check className="h-3.5 w-3.5" /> Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBalanceEditId(null)}
                aria-label="Cancel"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-sb-ink-muted">Outstanding today</p>
                {owed === undefined ? (
                  <p className="text-sm text-sb-ink-muted mt-0.5">Not set yet</p>
                ) : (
                  <p className="text-xl font-bold text-sb-ink tnum mt-0.5 tracking-tight">
                    {formatCurrency(owed)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {owed !== undefined && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startDriftReconciliation(card)}
                    className="gap-1 shadow-xs text-xs"
                    title={`Reconcile drift for ${card.name}`}
                  >
                    <Scale className="h-3.5 w-3.5" /> Reconcile Drift
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => startBalanceEdit(card)}
                  className="shrink-0 shadow-xs"
                >
                  {owed === undefined ? 'Set balance' : 'Update'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.li>
    )
  }

  return (
    <Card className="relative overflow-hidden border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h2 className="text-base font-bold text-sb-ink flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-brand-600 shrink-0" />
          <span>Credit Cards</span>
        </h2>
        <Button size="sm" onClick={() => setFormTarget('new')} className="gap-1.5 shrink-0 shadow-xs">
          <Plus className="h-3.5 w-3.5" /> Add card
        </Button>
      </div>
      <p className="text-xs text-sb-ink-muted mb-5 leading-relaxed">
        Track what each card owes, updated as you go. Optional — add nothing and nothing changes.
      </p>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2].map((i) => <div key={i} className="h-32 rounded-xl skeleton opacity-70" />)}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon="💳"
          title="No cards yet"
          description="Add a card to keep a running balance of what it owes."
          action={
            <Button size="sm" onClick={() => setFormTarget('new')} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add card
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>{active.map(renderCard)}</AnimatePresence>
          </ul>

          {archived.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-sb-ink-muted uppercase tracking-wider mb-2">
                Archived — history kept
              </h3>
              <ul className="space-y-2.5 opacity-70">
                <AnimatePresence initial={false}>{archived.map(renderCard)}</AnimatePresence>
              </ul>
            </div>
          )}
        </div>
      )}

      {formTarget && (
        <CardFormModal
          editing={formTarget === 'new' ? null : formTarget}
          cards={cards}
          locked={formTarget !== 'new' && isLocked(formTarget.id)}
          month={month}
          delta={formTarget === 'new' ? 0 : (deltas[formTarget.id] ?? 0)}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {driftTarget && (
        <Modal
          isOpen={!!driftTarget}
          onClose={() => setDriftTarget(null)}
          title={`Reconcile ${driftTarget.name} Drift`}
          footer={
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" onClick={() => setDriftTarget(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleRecordCardDrift}
                loading={savingDrift}
                disabled={
                  !driftActualAmount.trim() ||
                  Number(driftActualAmount) === (owedToday(driftTarget.id) ?? 0)
                }
                className="gap-1.5 shadow-xs"
              >
                <Check className="h-3.5 w-3.5" /> Confirm Reconciliation
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-sb-ink-secondary leading-relaxed">
              If your banking app or statement shows a different balance for this card, Intrack will record a 1-tap adjustment transaction on this card to bring them in sync.
            </p>

            <div className="rounded-xl border border-sb-hairline bg-surface-2/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-sb-ink-muted">Card:</span>
                <span className="font-semibold text-sb-ink">
                  {[driftTarget.name, driftTarget.last4 && `(•••• ${driftTarget.last4})`].filter(Boolean).join(' ')}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-sb-ink-muted">Intrack's Computed Outstanding:</span>
                <span className="font-bold text-sb-ink tnum">
                  {formatCurrency(owedToday(driftTarget.id) ?? 0)}
                </span>
              </div>
            </div>

            <Input
              label="Actual Card Outstanding Today"
              id="drift-card-actual-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={driftActualAmount}
              onChange={(e) => setDriftActualAmount(e.target.value)}
              className="tnum"
              autoFocus
            />

            {driftActualAmount.trim() !== '' && (() => {
              const currentOwed = owedToday(driftTarget.id) ?? 0
              const actualNum = Number(driftActualAmount)
              const cardDiff = Number.isFinite(actualNum) ? actualNum - currentOwed : 0
              return (
                <div
                  className={`rounded-xl border p-3 text-xs space-y-1 ${
                    cardDiff === 0
                      ? 'border-sb-hairline bg-surface-2/50 text-sb-ink-muted'
                      : cardDiff > 0
                      ? 'border-amber-200/80 bg-surface-2 text-sb-ink'
                      : 'border-emerald-200/80 bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>Discrepancy (Drift):</span>
                    <span className="tnum font-bold">
                      {cardDiff > 0 ? `+${formatCurrency(cardDiff)}` : formatCurrency(cardDiff)}
                    </span>
                  </div>
                  <p className="text-[11px] opacity-90">
                    {cardDiff === 0
                      ? 'Balances are already in sync.'
                      : cardDiff > 0
                      ? 'Card has higher debt than tracked. A Debit (Adjustment / Fee) will be logged.'
                      : 'Card has lower debt than tracked. A Credit (Waiver / Cashback) will be logged.'}
                  </p>
                </div>
              )
            })()}

            <Input
              label="Adjustment Notes (optional)"
              id="drift-card-notes-input"
              type="text"
              placeholder="e.g. Annual fee / cashback waiver"
              value={driftNotes}
              onChange={(e) => setDriftNotes(e.target.value)}
            />
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete ${deleteTarget?.name}?`}
        message="This cannot be undone. If any transaction points at this card, deleting is refused — archive it instead, which keeps every transaction exactly as it is."
        confirmLabel="Delete"
        danger
      />
    </Card>
  )
}
