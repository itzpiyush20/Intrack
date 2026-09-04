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
import type { Card, CardBrand, CardPeriod } from '@/types'

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

export async function createCard(input: {
  name: string
  issuer?: string | null
  last4?: string | null
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
      last4: input.last4?.trim() || null,
      brand: input.brand || null,
    })
    .select()
    .single()

  return { data: data as Card | null, error }
}

export async function updateCard(
  id: string,
  patch: Partial<Pick<Card, 'name' | 'issuer' | 'last4' | 'brand' | 'sort_order'>>
) {
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
