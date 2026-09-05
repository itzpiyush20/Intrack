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
//     freely correctable until then — a typo is caught in the first days, and
//     once history exists the match key must stop moving. The card name is
//     always editable: nothing traces by name.
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { Card, Button, Input, ConfirmDialog } from '@/components/ui'
import { useToast } from '@/context'
import {
  getCards, createCard, updateCard, setCardArchived, deleteCard,
  getCardPeriods, setCardOpening, getCardMovementsSince, getCardUsageCounts,
  monthKey, todayKey,
} from '@/services/cards'
import { formatCurrency, formatDate } from '@/utils'
import { CreditCard, Plus, Archive, ArchiveRestore, Trash2, Pencil, Lock, AlertTriangle } from 'lucide-react'
import type { Card as CardRow, CardBrand, CardPeriod } from '@/types'

const BRANDS: CardBrand[] = ['Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners']

/** The editable details of a card. */
type Details = { name: string; issuer: string; last4: string; brand: CardBrand | '' }

const EMPTY: Details = { name: '', issuer: '', last4: '', brand: '' }

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

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Details>(EMPTY)
  const [openingInput, setOpeningInput] = useState('')
  const [saving, setSaving] = useState(false)
  // Set once the add form has been validated; the confirmation dialog is what
  // actually creates the card.
  const [confirmAdd, setConfirmAdd] = useState<{ details: Details; owed: number } | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Details>(EMPTY)
  const [savingEdit, setSavingEdit] = useState(false)

  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<CardRow | null>(null)

  // The month whose opening figure is editable. Past months are deliberately
  // not reachable from here: the owner's rule is that a correction takes effect
  // from the current month forward and never rewrites what earlier months
  // already reported.
  const month = monthKey()
  const today = todayKey()

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

  /** Other cards sharing these last four — archived ones included; they still exist. */
  const sharing = (last4: string, exceptId?: string) =>
    last4.length === 4 ? cards.filter((c) => c.last4 === last4 && c.id !== exceptId) : []

  /** What the card owes today: the month's opening plus everything since. */
  const owedToday = (cardId: string): number | undefined => {
    const opening = openings[cardId]
    if (opening === undefined) return undefined
    return opening + (deltas[cardId] ?? 0)
  }

  /** Reads a typed rupee figure, refusing anything that is not a positive number. */
  const parseAmount = (raw: string): number | null => {
    const amount = Number(raw)
    if (!raw.trim() || !Number.isFinite(amount) || amount < 0) {
      showToast('Enter the amount owed as a positive number.', 'error')
      return null
    }
    return amount
  }

  /**
   * The checks both forms share. Returns an error to show, or null to proceed.
   *
   * The issuer requirement only bites on a collision: one card ending 1234
   * needs no bank name, two of them do, or neither the user nor the scanner can
   * tell which is which.
   */
  const validateDetails = (details: Details, exceptId?: string): string | null => {
    if (!details.name.trim()) return 'Give the card a name.'
    if (details.last4.length !== 4) return 'Type all 4 of the card’s last digits.'
    const clash = sharing(details.last4, exceptId)
    if (clash.length > 0 && !details.issuer.trim()) {
      return `You already have a card ending ${details.last4} — ${clash[0].name}. Name the bank so the two can be told apart.`
    }
    return null
  }

  const resetForm = () => { setForm(EMPTY); setOpeningInput(''); setAdding(false) }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateDetails(form)
    if (problem) { showToast(problem, 'error'); return }
    const owed = parseAmount(openingInput)
    if (owed === null) return
    // Confirmed rather than saved outright: the last four are about to become
    // the card's match key, and a dialog is the second chance to catch a typo.
    setConfirmAdd({ details: form, owed })
  }

  const performAdd = async () => {
    if (!confirmAdd) return
    const { details, owed } = confirmAdd
    setConfirmAdd(null)
    setSaving(true)

    const { data: created, error } = await createCard({
      name: details.name,
      last4: details.last4,
      issuer: details.issuer || null,
      brand: details.brand || null,
    })
    if (error || !created) {
      setSaving(false)
      // UNIQUE (user_id, name) is what produces this, and "duplicate key value
      // violates unique constraint" is not something to show a person.
      const duplicate = error?.message?.includes('duplicate') || error?.message?.includes('unique')
      showToast(
        duplicate
          ? `You already have a card called "${details.name.trim()}".`
          : error?.message || 'Could not add that card.',
        'error'
      )
      return
    }

    // A card with no figure is a card the balance maths cannot use, so a failed
    // second write is worth naming rather than leaving a silently half-made card.
    const { error: openingError } = await setCardOpening(created.id, month, owed - (deltas[created.id] ?? 0))
    setSaving(false)
    showToast(
      openingError
        ? 'Card added, but the amount owed did not save. Type it again below.'
        : 'Card added.',
      openingError ? 'error' : 'success'
    )
    resetForm()
    void load()
  }

  const startEdit = (card: CardRow) => {
    setEditingId(card.id)
    setEditForm({
      name: card.name,
      issuer: card.issuer || '',
      last4: card.last4 || '',
      brand: card.brand || '',
    })
  }

  /**
   * Saves every editable detail at once. Nothing here touches transactions:
   * they point at the card by id, so renaming a card to something clearer
   * leaves the history exactly as it was.
   *
   * On a locked card the bank and last four are not sent at all — the service
   * would refuse them anyway, and this keeps the refusal from ever being what
   * the user meets.
   */
  const handleEditSave = async (card: CardRow, e: React.FormEvent) => {
    e.preventDefault()
    const locked = isLocked(card.id)
    const problem = locked
      ? (editForm.name.trim() ? null : 'Give the card a name.')
      : validateDetails(editForm, card.id)
    if (problem) { showToast(problem, 'error'); return }

    setSavingEdit(true)
    const { error } = await updateCard(card.id, {
      name: editForm.name.trim(),
      brand: editForm.brand || null,
      ...(locked ? {} : {
        issuer: editForm.issuer.trim() || null,
        last4: editForm.last4,
      }),
    })
    setSavingEdit(false)
    if (error) {
      const duplicate = error.message?.includes('duplicate') || error.message?.includes('unique')
      showToast(duplicate ? `You already have a card called "${editForm.name.trim()}".` : error.message, 'error')
      return
    }
    setEditingId(null)
    showToast('Card details updated. Its transactions are untouched.', 'success')
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

  const handleOpeningSave = async (card: CardRow) => {
    const raw = openingDraft[card.id]
    if (raw === undefined) return
    const owed = parseAmount(raw)
    if (owed === null) return

    // The user typed today's figure; the column stores the month's opening.
    const opening = owed - (deltas[card.id] ?? 0)
    const { error } = await setCardOpening(card.id, month, opening)
    if (error) { showToast(error.message, 'error'); return }
    setOpeningDraft((prev) => { const next = { ...prev }; delete next[card.id]; return next })
    setOpenings((prev) => ({ ...prev, [card.id]: opening }))
    showToast('Amount owed saved.', 'success')
  }

  const active = cards.filter((c) => !c.is_archived)
  const archived = cards.filter((c) => c.is_archived)

  /**
   * The name/bank/last-four/network fields, shared by the add and edit forms.
   * `locked` disables the two identity fields and says why.
   */
  const detailFields = (
    value: Details,
    onChange: (next: Details) => void,
    idPrefix: string,
    options: { locked?: boolean; exceptId?: string } = {}
  ) => {
    const { locked = false, exceptId } = options
    const clash = sharing(value.last4, exceptId)
    return (
      <>
        {/* Wrapped because Input puts className on the <input>, not on the
            grid item, so the span has to be carried by an element that is one. */}
        <div className="sm:col-span-2">
          <Input
            placeholder="Card name (e.g. Axis Flipkart)"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className="text-xs h-11"
            aria-label="Card name"
            id={`${idPrefix}-name`}
            required
          />
        </div>

        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            placeholder="Last 4 digits"
            value={value.last4}
            onChange={(e) => onChange({ ...value, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            className="text-xs h-11"
            aria-label="Last four digits"
            aria-describedby={`${idPrefix}-last4-note`}
            inputMode="numeric"
            id={`${idPrefix}-last4`}
            required
            disabled={locked}
          />
          <Input
            placeholder={clash.length > 0 ? 'Bank — required' : 'Bank — optional'}
            value={value.issuer}
            onChange={(e) => onChange({ ...value, issuer: e.target.value })}
            className="text-xs h-11"
            aria-label={clash.length > 0 ? 'Issuing bank' : 'Issuing bank (optional)'}
            id={`${idPrefix}-issuer`}
            required={clash.length > 0}
            disabled={locked}
          />
          <p
            id={`${idPrefix}-last4-note`}
            className={`text-[11px] leading-relaxed sm:col-span-2 flex items-start gap-1.5 ${
              locked ? 'text-zinc-500' : 'text-[var(--status-warning-text)]'
            }`}
          >
            {locked ? <Lock className="h-3 w-3 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />}
            <span>
              {locked
                ? 'Fixed — this card already has transactions. These two are how alerts are matched to it, so they no longer change. The name can still be edited.'
                : 'Type these carefully. The last 4 digits and bank are how Intrack matches bank alerts to this card, and they stop being editable once the card has its first transaction.'}
            </span>
          </p>
          {clash.length > 0 && !locked && (
            <p className="text-[11px] leading-relaxed text-[var(--status-warning-text)] sm:col-span-2">
              You already have a card ending {value.last4} — {clash[0].name}. Name the bank on both so they can be told apart.
            </p>
          )}
        </div>

        <select
          value={value.brand}
          onChange={(e) => onChange({ ...value, brand: e.target.value as CardBrand | '' })}
          aria-label="Card network (optional)"
          id={`${idPrefix}-brand`}
          className="w-full bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400 sm:col-span-2"
        >
          <option value="">Network — optional</option>
          {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </>
    )
  }

  const renderCard = (card: CardRow) => {
    const draft = openingDraft[card.id]
    const stored = owedToday(card.id)
    const locked = isLocked(card.id)
    // A card sharing its digits with another and carrying no bank name is
    // ambiguous to the user and unmatchable by the scanner. Say so where they
    // can act on it, rather than only inside the form.
    const ambiguous = card.last4 && !card.issuer && sharing(card.last4, card.id).length > 0

    return (
      <div
        key={card.id}
        className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-3 sm:p-4 flex flex-col gap-3"
      >
        {editingId === card.id ? (
          <form
            onSubmit={(e) => handleEditSave(card, e)}
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            {detailFields(editForm, setEditForm, `edit-${card.id}`, { locked, exceptId: card.id })}
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button size="sm" type="submit" loading={savingEdit} className="justify-center flex-1">
                Save details
              </Button>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => setEditingId(null)}
                className="justify-center"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-sb-ink truncate">{card.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">
                {[card.issuer, card.brand, card.last4 && `•••• ${card.last4}`].filter(Boolean).join(' · ') || 'No card details'}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => startEdit(card)}
                title="Edit card details"
                aria-label={`Edit ${card.name}`}
                className="h-10 w-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-brand-400 hover:bg-surface-2 transition-colors"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleArchive(card)}
                title={card.is_archived ? 'Restore card' : 'Archive card'}
                aria-label={card.is_archived ? `Restore ${card.name}` : `Archive ${card.name}`}
                className="h-10 w-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-surface-2 transition-colors"
              >
                {card.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setDeleteTarget(card)}
                title="Delete card"
                aria-label={`Delete ${card.name}`}
                className="h-10 w-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {ambiguous && editingId !== card.id && (
          <p className="text-[11px] leading-relaxed text-[var(--status-warning-text)] flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>Another card also ends {card.last4}. Add this one’s bank name so they can be told apart.</span>
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-3 border-t border-border-subtle/30">
          <label htmlFor={`opening-${card.id}`} className="text-xs font-semibold text-zinc-400 sm:w-44 shrink-0">
            Owed today
          </label>
          <div className="flex items-center gap-2 flex-1">
            <Input
              id={`opening-${card.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder={stored !== undefined ? String(stored) : '0'}
              value={draft ?? ''}
              onChange={(e) => setOpeningDraft((prev) => ({ ...prev, [card.id]: e.target.value }))}
              className="text-sm h-11 flex-1"
            />
            {draft !== undefined && draft !== '' && (
              <Button size="sm" onClick={() => handleOpeningSave(card)} className="justify-center shrink-0">
                Save
              </Button>
            )}
          </div>
        </div>
        {stored !== undefined && draft === undefined && (
          <p className="text-xs text-zinc-500 -mt-1">
            {formatCurrency(stored)} as of {formatDate(today)} — edit to correct it.
          </p>
        )}
      </div>
    )
  }

  return (
    <Card className="border-border-subtle bg-surface-1 shadow-md">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-base font-bold text-zinc-200 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-brand-400 shrink-0" />
          <span>Credit Cards</span>
        </h2>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add card
          </Button>
        )}
      </div>
      <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
        Add the credit cards you want a running balance for. Each one needs a name, its last
        4 digits, and what it owes right now — the figure your banking app shows today.
        Intrack tracks it from there. The name is always editable; the digits and bank are
        fixed once the card has its first transaction. Add nothing and nothing changes.
      </p>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 p-3 bg-surface-2/40 border border-border-subtle/30 rounded-xl"
        >
          {detailFields(form, setForm, 'add')}
          <div className="sm:col-span-2">
            <label htmlFor="add-owed" className="text-xs font-semibold text-zinc-400 block mb-1">
              Owed today ({formatDate(today)})
            </label>
            <Input
              id="add-owed"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0"
              value={openingInput}
              onChange={(e) => setOpeningInput(e.target.value)}
              className="text-xs h-11"
              required
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button size="sm" type="submit" loading={saving} className="justify-center flex-1">Add</Button>
            <Button size="sm" type="button" variant="secondary" onClick={resetForm} className="justify-center">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-24 rounded-xl skeleton opacity-70" />)}
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center">
          <p className="text-xs text-zinc-500">
            No cards yet. Add one to start tracking what it owes.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">{active.map(renderCard)}</div>

          {archived.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 pt-2">
                Archived — history kept
              </p>
              <div className="space-y-2 opacity-60">{archived.map(renderCard)}</div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmAdd}
        onClose={() => setConfirmAdd(null)}
        onConfirm={performAdd}
        title={`Add ${confirmAdd?.details.name.trim()}?`}
        message={
          `${[confirmAdd?.details.issuer.trim(), confirmAdd?.details.last4 && `•••• ${confirmAdd.details.last4}`]
            .filter(Boolean).join(' · ')} — owing ${formatCurrency(confirmAdd?.owed ?? 0)} today. ` +
          'Check those last 4 digits now: they and the bank name are how Intrack matches bank alerts to this card, and they stop being editable once this card has its first transaction. The card name can be changed at any time.'
        }
        confirmLabel="Add card"
        danger={false}
      />

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
