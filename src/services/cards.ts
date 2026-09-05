// ============================================
// Cards Service — credit cards the user defines themselves
//
// Phase 2 of plans/accounts-and-balances.md. These are NOT cards detected from
// email: they are cards the user deliberately set up because they want an
// outstanding balance tracked for them.
//
// Nothing here computes a balance. Phase 4 owns the maths; this owns the rows
// it will be computed from.
// ============================================

import { supabase } from './supabase'
import type { Card, CardBrand, CardPeriod, Transaction } from '@/types'

/** Cards for the signed-in user. Archived ones are included; callers filter. */
export async function getCards() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return { data: data as Card[] | null, error }
}

/**
 * Creates a card. `last4` is required — see `updateCard` for why, and for when
 * it stops being editable.
 */
export async function createCard(input: {
  name: string
  last4: string
  issuer?: string | null
  brand?: CardBrand | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('cards')
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      issuer: input.issuer?.trim() || null,
      last4: input.last4.trim(),
      brand: input.brand || null,
    })
    .select()
    .single()

  return { data: data as Card | null, error }
}

/** The two fields that freeze once a card has history. */
const IDENTITY_FIELDS = ['last4', 'issuer'] as const

type Identity = Pick<Card, 'issuer' | 'last4'>

/**
 * Whether a patch would move a card's identity, as opposed to filling it in.
 *
 * Filling a field that was empty is not a move — nothing could ever have
 * matched on a blank — so a card added before `last4` was required can still be
 * completed even after it has history. Changing a value that was already there
 * is the case the lock exists for.
 */
export function movesCardIdentity(current: Partial<Identity>, patch: Partial<Identity>): boolean {
  return IDENTITY_FIELDS.some((field) => {
    if (!(field in patch)) return false
    const before = current[field] ?? ''
    const after = patch[field] ?? ''
    return before !== '' && before !== after
  })
}

/**
 * Edits a card's details.
 *
 * Name and network are always editable — renaming a card to something clearer
 * is a thing people do, and nothing traces a transaction by name: rows point at
 * `card_id`, a uuid no user can see or change.
 *
 * **`last4` and `issuer` freeze once anything points at the card** (owner,
 * 2026-09-05). They are the pair the email scanner matches on — "HDFC card
 * ending 4821" in an alert is resolved to a defined card by issuer + last four —
 * so moving them after history exists would make past matches disagree with
 * present ones. Before the first transaction they cost nothing to correct,
 * which is exactly when a typo is noticed, so they stay open until then.
 *
 * The guard lives here rather than in the form so a future caller cannot
 * quietly break the promise.
 */
export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'name' | 'issuer' | 'last4' | 'brand' | 'sort_order'>>
) {
  const { data: current, error: currentError } = await supabase
    .from('cards')
    .select('issuer, last4')
    .eq('id', id)
    .single()
  if (currentError) return { data: null, error: currentError }

  if (movesCardIdentity(current as Identity, patch)) {
    const { data: usage, error: usageError } = await getCardUsage(id)
    if (usageError) return { data: null, error: usageError }
    if (usage && usage.transactions > 0) {
      return {
        data: null,
        error: new Error(
          'The bank and last 4 digits are fixed once a card has transactions — they are how the scanner matches alerts to this card. You can still rename it.'
        ),
      }
    }
  }

  const { data, error } = await supabase
    .from('cards')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  return { data: data as Card | null, error }
}

/**
 * Archiving is always the user's explicit act — the owner was specific that
 * nothing may archive a card on their behalf. It hides the card from pickers
 * while leaving every transaction that points at it untouched, which is the
 * whole reason it exists instead of deletion.
 */
export async function setCardArchived(id: string, archived: boolean) {
  const { data, error } = await supabase
    .from('cards')
    .update({ is_archived: archived })
    .eq('id', id)
    .select()
    .single()

  return { data: data as Card | null, error }
}

/**
 * How many rows point at this card. Deletion is only offered when this is
 * zero — a card with history is archived, never removed, or its transactions
 * would silently lose the account they belonged to.
 */
export async function getCardUsage(id: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const [spends, settles] = await Promise.all([
    supabase.from('transactions').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('card_id', id),
    supabase.from('transactions').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('settles_card_id', id),
  ])

  return {
    data: { transactions: (spends.count ?? 0) + (settles.count ?? 0) },
    error: spends.error || settles.error,
  }
}

/**
 * The same count for every card at once, so Settings can tell which cards have
 * history — and therefore which have their bank and last four frozen — without
 * a query per card.
 *
 * Only rows that name a card are fetched, so this stays small no matter how
 * large the transaction table grows.
 */
export async function getCardUsageCounts() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('transactions')
    .select('card_id, settles_card_id')
    .eq('user_id', user.id)
    .or('card_id.not.is.null,settles_card_id.not.is.null')

  if (error) return { data: null, error }

  const counts: Record<string, number> = {}
  for (const row of (data || []) as Pick<Transaction, 'card_id' | 'settles_card_id'>[]) {
    if (row.card_id) counts[row.card_id] = (counts[row.card_id] ?? 0) + 1
    if (row.settles_card_id) counts[row.settles_card_id] = (counts[row.settles_card_id] ?? 0) + 1
  }
  return { data: counts, error: null }
}

/**
 * Permanent removal, refused when anything points at the card.
 *
 * The database would allow it — both foreign keys are ON DELETE SET NULL — but
 * that is exactly the silent damage worth preventing: the transactions would
 * survive with no card, and the user would have no way to tell which ones had
 * lost their link.
 */
export async function deleteCard(id: string) {
  const { data: usage, error: usageError } = await getCardUsage(id)
  if (usageError) return { error: usageError }
  if (usage && usage.transactions > 0) {
    return {
      error: new Error(
        `This card has ${usage.transactions} transaction${usage.transactions === 1 ? '' : 's'}. Archive it instead — deleting would leave those transactions with no card.`
      ),
    }
  }

  const { error } = await supabase.from('cards').delete().eq('id', id)
  return { error }
}

// ── Opening outstanding ──────────────────────────────────────
// Stored per card per month. Per month rather than once is what lets the
// figure be corrected without rewriting the months before it: a correction
// lands on the month it was made and earlier months keep what they reported.

/** First day of the month a date falls in, as the YYYY-MM-DD the column stores. */
export function monthKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

export async function getCardPeriods(month: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('card_periods')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', month)

  return { data: data as CardPeriod[] | null, error }
}

/**
 * Set this card's opening outstanding for a month.
 *
 * `is_user_set` records that a person typed this rather than the app carrying
 * it forward from the previous month's close. Phase 4 needs that distinction:
 * a figure the user stated is one worth warning them about when it disagrees
 * with the computed balance; one the app derived is not.
 */
export async function setCardOpening(cardId: string, month: string, amount: number) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('card_periods')
    .upsert(
      {
        user_id: user.id,
        card_id: cardId,
        month,
        opening_outstanding: amount,
        is_user_set: true,
      },
      { onConflict: 'card_id,month' }
    )
    .select()
    .single()

  return { data: data as CardPeriod | null, error }
}

// ── Today's outstanding → this month's opening ────────────────
// The owner's rule (2026-09-05): nobody can look up what a card owed on the
// 1st. What a person can read off their banking app is what it owes *today*.
// So the UI asks for today's figure and this converts it, because the stored
// column and every downstream calculation stay anchored to the month opening:
//
//     opening = today's outstanding − everything the card did since the 1st
//
// Until Phase 3 lets a transaction name a card, that delta is always zero and
// the two figures are the same number. The conversion exists so the meaning is
// already right when tagging lands, rather than silently changing then.

/** Today as the YYYY-MM-DD the `date` column stores. Local, never UTC. */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** The columns of a transaction that move a card's outstanding. */
export type CardMovement = Pick<
  Transaction, 'amount' | 'type' | 'card_id' | 'settles_card_id' | 'loan_source'
>

/**
 * Net movement per card, summed from rows that name one.
 *
 * Signs follow the table in plans/accounts-and-balances.md: a spend on the card
 * raises it, a refund lowers it, a cash advance (`loan_source: 'credit_card'`,
 * money arriving) raises it despite also being money in, and a bill payment
 * lowers the card it settles.
 */
export function sumCardMovements(rows: CardMovement[]): Record<string, number> {
  const deltas: Record<string, number> = {}
  const add = (id: string, amount: number) => {
    deltas[id] = (deltas[id] ?? 0) + amount
  }

  for (const row of rows) {
    const amount = Number(row.amount) || 0
    if (row.card_id) {
      if (row.type === 'credit') {
        add(row.card_id, row.loan_source === 'credit_card' ? amount : -amount)
      } else {
        add(row.card_id, amount)
      }
    }
    if (row.settles_card_id) add(row.settles_card_id, -amount)
  }

  return deltas
}

/**
 * What each card has done between the 1st of `month` and `upto`, inclusive.
 *
 * Only approved rows count. A pending row is a suggestion the user has not
 * accepted, and letting it shift the figure they are about to type would mean
 * the number they entered stopped matching their statement the moment they
 * rejected it.
 */
export async function getCardMovementsSince(month: string, upto: string = todayKey()) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type, card_id, settles_card_id, loan_source')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .gte('date', month)
    .lte('date', upto)
    .or('card_id.not.is.null,settles_card_id.not.is.null')

  if (error) return { data: null, error }
  return { data: sumCardMovements((data || []) as CardMovement[]), error: null }
}
