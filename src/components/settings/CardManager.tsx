// ============================================
// CardManager — Settings section for credit cards the user defines
//
// Phase 2 of plans/accounts-and-balances.md. These are cards a person
// deliberately set up because they want an outstanding tracked, not cards
// detected from email.
//
// Nothing here computes a balance. The opening figure typed here is what
// Phase 4's maths will start from.
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { Card, Button, Input, ConfirmDialog } from '@/components/ui'
import { useToast } from '@/context'
import {
  getCards, createCard, updateCard, setCardArchived, deleteCard,
  getCardPeriods, setCardOpening, monthKey,
} from '@/services/cards'
import { formatCurrency } from '@/utils'
import { CreditCard, Plus, Archive, ArchiveRestore, Trash2, Check, X } from 'lucide-react'
import type { Card as CardRow, CardBrand, CardPeriod } from '@/types'

const BRANDS: CardBrand[] = ['Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners']

export default function CardManager() {
  const { showToast } = useToast()

  const [cards, setCards] = useState<CardRow[]>([])
  const [openings, setOpenings] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [last4, setLast4] = useState('')
  const [brand, setBrand] = useState<CardBrand | ''>('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<CardRow | null>(null)

  // The month whose opening figure is editable. Past months are deliberately
  // not reachable from here: the owner's rule is that a correction takes effect
  // from the current month forward and never rewrites what earlier months
  // already reported.
  const month = monthKey()

  // No setState before the first await. Calling one synchronously from an
  // effect trips react-hooks/set-state-in-effect, and `loading` already starts
  // true, so raising it here bought nothing. Refreshes after a mutation keep
  // the list on screen rather than flashing a skeleton, which reads better.
  const load = useCallback(async () => {
    const [{ data: cardRows, error }, { data: periods }] = await Promise.all([
      getCards(),
      getCardPeriods(month),
    ])
    if (error) showToast(error.message || 'Could not load your cards.', 'error')
    setCards(cardRows || [])
    const map: Record<string, number> = {}
    ;(periods as CardPeriod[] | null)?.forEach((p) => { map[p.card_id] = Number(p.opening_outstanding) })
    setOpenings(map)
    setLoading(false)
  }, [month, showToast])

  useEffect(() => {
    // Wrapped rather than called bare so every setState lands in load's
    // post-await continuation instead of synchronously in this effect body —
    // react-hooks/set-state-in-effect flags the latter, and the repo's rule is
    // not to add to that baseline.
    void (async () => { await load() })()
  }, [load])

  const resetForm = () => {
    setName(''); setIssuer(''); setLast4(''); setBrand(''); setAdding(false)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { error } = await createCard({
      name,
      issuer: issuer || null,
      last4: last4 || null,
      brand: brand || null,
    })
    setSaving(false)
    if (error) {
      // UNIQUE (user_id, name) is what produces this, and "duplicate key value
      // violates unique constraint" is not something to show a person.
      const duplicate = error.message?.includes('duplicate') || error.message?.includes('unique')
      showToast(duplicate ? `You already have a card called "${name.trim()}".` : error.message, 'error')
      return
    }
    showToast('Card added.', 'success')
    resetForm()
    void load()
  }

  const handleRename = async (card: CardRow) => {
    const trimmed = editName.trim()
    if (!trimmed || trimmed === card.name) { setEditingId(null); return }
    const { error } = await updateCard(card.id, { name: trimmed })
    if (error) { showToast(error.message, 'error'); return }
    setEditingId(null)
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
    const amount = Number(raw)
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter the amount owed as a positive number.', 'error')
      return
    }
    const { error } = await setCardOpening(card.id, month, amount)
    if (error) { showToast(error.message, 'error'); return }
    setOpeningDraft((prev) => { const next = { ...prev }; delete next[card.id]; return next })
    setOpenings((prev) => ({ ...prev, [card.id]: amount }))
    showToast('Opening balance saved.', 'success')
  }

  const active = cards.filter((c) => !c.is_archived)
  const archived = cards.filter((c) => c.is_archived)

  const renderCard = (card: CardRow) => {
    const draft = openingDraft[card.id]
    const stored = openings[card.id]
    return (
      <div
        key={card.id}
        className="rounded-xl border border-border-subtle/40 bg-surface-2/50 p-3 sm:p-4 flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingId === card.id ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-sm h-10"
                  aria-label="Card name"
                  autoFocus
                />
                <button
                  onClick={() => handleRename(card)}
                  aria-label="Save name"
                  className="h-10 w-10 rounded-lg flex items-center justify-center text-[var(--status-positive-text)] hover:bg-[var(--status-positive-subtle)] transition-colors shrink-0"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  aria-label="Cancel rename"
                  className="h-10 w-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => { setEditingId(card.id); setEditName(card.name) }}
                  className="text-sm font-bold text-sb-ink truncate block text-left hover:text-brand-400 transition-colors"
                  title="Rename"
                >
                  {card.name}
                </button>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                  {[card.issuer, card.brand, card.last4 && `•••• ${card.last4}`].filter(Boolean).join(' · ') || 'No card details'}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
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

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-3 border-t border-border-subtle/30">
          <label htmlFor={`opening-${card.id}`} className="text-xs font-semibold text-zinc-400 sm:w-44 shrink-0">
            Amount owed on 1st
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
            Currently {formatCurrency(stored)} — edit to correct it.
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
        Add the credit cards you want a running balance for. Type what each one owed at the
        start of this month and Intrack tracks it from there. Entirely optional — add
        nothing and nothing changes.
      </p>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 p-3 bg-surface-2/40 border border-border-subtle/30 rounded-xl"
        >
          <Input
            placeholder="Card name (e.g. Axis Flipkart)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xs h-11 sm:col-span-2"
            aria-label="Card name"
            required
            autoFocus
          />
          <Input
            placeholder="Bank (e.g. Axis)"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="text-xs h-11"
            aria-label="Issuing bank"
          />
          <Input
            placeholder="Last 4 digits"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="text-xs h-11"
            aria-label="Last four digits"
            inputMode="numeric"
          />
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value as CardBrand | '')}
            aria-label="Card network"
            className="w-full bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            <option value="">Network (optional)</option>
            {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="flex items-center gap-2">
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
