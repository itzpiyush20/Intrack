// ============================================
// CardFormModal — shared create/edit form for the user's credit cards
//
// Matches CategoryFormModal, its neighbour on the same Settings page: a modal
// with labelled fields, one inline alert for validation, and the submit button
// living in the modal footer. The card list used to carry its own inline grid
// form, which is why that section read as older than everything around it.
//
// Creating is two steps inside one dialog — details, then a confirmation
// summary. The owner asked for a confirm popup before a card is created, since
// the last four digits are how bank alerts get matched to it; a second Modal
// stacked on this one would fight it for focus, so the confirmation is a step
// here instead of a dialog on top of a dialog.
// ============================================

import { useState, type FormEvent } from 'react'
import { Modal, Button, Input, Select } from '@/components/ui'
import { createCard, updateCard, setCardOpening } from '@/services/cards'
import { formatCurrency } from '@/utils'
import { Lock, AlertTriangle } from 'lucide-react'
import type { Card as CardRow, CardBrand } from '@/types'

const BRANDS: CardBrand[] = ['Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners']

interface CardFormModalProps {
  /** The card being edited, or null when creating. */
  editing: CardRow | null
  /** Every card the user has, for spotting two that end in the same digits. */
  cards: CardRow[]
  /** True when the card already has transactions: bank and last 4 are frozen. */
  locked: boolean
  /** The month whose opening figure a newly created card's balance lands on. */
  month: string
  /** What the card has done since the 1st, for converting today's figure. */
  delta: number
  onClose: () => void
  onSaved: (message: string) => void
}

export default function CardFormModal({
  editing, cards, locked, month, delta, onClose, onSaved,
}: CardFormModalProps) {
  const isEditing = !!editing

  const [name, setName] = useState(editing?.name || '')
  const [last4, setLast4] = useState(editing?.last4 || '')
  const [issuer, setIssuer] = useState(editing?.issuer || '')
  const [brand, setBrand] = useState<CardBrand | ''>(editing?.brand || '')
  const [owed, setOwed] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Archived cards count: they still exist, and their digits are still theirs.
  const clash = last4.length === 4
    ? cards.filter((c) => c.last4 === last4 && c.id !== editing?.id)
    : []

  const validate = (): string => {
    if (!name.trim()) return 'Give the card a name.'
    if (!locked) {
      if (last4.length !== 4) return 'Enter all 4 of the card’s last digits.'
      // One card ending 1234 needs no bank name; two of them do, or neither the
      // user nor the scanner can tell which is which.
      if (clash.length > 0 && !issuer.trim()) {
        return `You already have a card ending ${last4} — ${clash[0].name}. Name the bank so the two can be told apart.`
      }
    }
    if (!isEditing) {
      const amount = Number(owed)
      if (!owed.trim() || !Number.isFinite(amount) || amount < 0) {
        return 'Enter what the card owes today as a positive number.'
      }
    }
    return ''
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }
    setError('')
    // Editing has nothing irreversible to confirm — the name is free to change
    // and the identity fields are either still open or already frozen.
    if (isEditing) { void save(); return }
    setConfirming(true)
  }

  const save = async () => {
    setLoading(true)
    setError('')

    if (isEditing && editing) {
      const { error: updateError } = await updateCard(editing.id, {
        name: name.trim(),
        brand: brand || null,
        // Not sent at all on a locked card: the service would refuse them, and
        // that refusal should never be what the user meets.
        ...(locked ? {} : { issuer: issuer.trim() || null, last4 }),
      })
      setLoading(false)
      if (updateError) { setError(readable(updateError.message, name)); return }
      onSaved('Card updated. Its transactions are untouched.')
      return
    }

    const { data: created, error: createError } = await createCard({
      name: name.trim(),
      last4,
      issuer: issuer.trim() || null,
      brand: brand || null,
    })
    if (createError || !created) {
      setLoading(false)
      setConfirming(false)
      setError(readable(createError?.message, name))
      return
    }

    // The user typed today's figure; the column stores the month's opening. A
    // card with no figure is one the balance maths cannot use, so a failure
    // here is named rather than leaving a silently half-made card.
    const { error: openingError } = await setCardOpening(created.id, month, Number(owed) - delta)
    setLoading(false)
    onSaved(
      openingError
        ? 'Card added, but the amount owed did not save. Set it from the list.'
        : 'Card added.'
    )
  }

  const summary = [issuer.trim(), brand, `•••• ${last4}`].filter(Boolean).join(' · ')

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEditing ? 'Edit card' : confirming ? 'Check the details' : 'Add a card'}
      sheet
      footer={
        confirming ? (
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirming(false)} disabled={loading}>
              Back
            </Button>
            <Button size="md" onClick={save} loading={loading}>
              Add card
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" form="card-form-modal" size="md" loading={loading}>
              {isEditing ? 'Save changes' : 'Continue'}
            </Button>
          </>
        )
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 text-sm text-[var(--status-danger-text)]"
        >
          {error}
        </div>
      )}

      {confirming ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border-default bg-surface-2 p-4">
            <p className="text-base font-semibold text-zinc-100">{name.trim()}</p>
            <p className="mt-1 text-sm text-zinc-400 tnum">{summary}</p>
            <p className="mt-3 text-sm text-zinc-300">
              Owes <span className="font-semibold text-zinc-100 tnum">{formatCurrency(Number(owed))}</span> today
            </p>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Check those last 4 digits now. They and the bank name are how Intrack matches bank
            alerts to this card, so they stop being editable once it has its first transaction.
            The card’s name can be changed whenever you like.
          </p>
        </div>
      ) : (
        <form id="card-form-modal" onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Card name"
            placeholder="e.g. Amazon ICICI"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Last 4 digits"
              placeholder="2000"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              className="tnum"
              required
              disabled={locked}
            />
            <Input
              label={clash.length > 0 ? 'Bank' : 'Bank (optional)'}
              placeholder="e.g. ICICI"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              required={clash.length > 0}
              disabled={locked}
            />
          </div>

          {clash.length > 0 && !locked && (
            <p className="flex items-start gap-2 text-sm text-[var(--status-warning-text)]">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {clash[0].name} also ends {last4}. Name the bank on both so they can be told apart.
              </span>
            </p>
          )}

          <p className="flex items-start gap-2 rounded-xl bg-[var(--status-info-subtle)] border border-[var(--status-info-border)] p-3 text-sm text-[var(--status-info-text)] leading-relaxed">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {locked
                ? 'This card already has transactions, so its bank and last 4 digits are fixed — they’re how alerts get matched to it. The name and network can still change.'
                : 'The bank and last 4 digits are how Intrack matches bank alerts to this card. They stay editable until the card’s first transaction, then they’re fixed.'}
            </span>
          </p>

          <Select
            label="Network (optional)"
            value={brand}
            onChange={(e) => setBrand(e.target.value as CardBrand | '')}
          >
            <option value="">Not set</option>
            {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>

          {!isEditing && (
            <Input
              label="Outstanding balance today"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={owed}
              onChange={(e) => setOwed(e.target.value)}
              className="tnum"
              required
            />
          )}
        </form>
      )}
    </Modal>
  )
}

/**
 * UNIQUE (user_id, name) is what produces a duplicate-key error, and "duplicate
 * key value violates unique constraint" is not something to show a person.
 */
function readable(message: string | undefined, name: string): string {
  if (message?.includes('duplicate') || message?.includes('unique')) {
    return `You already have a card called “${name.trim()}”.`
  }
  return message || 'Something went wrong. Try again.'
}
