// ============================================
// Balances Service — Available Money & Card Outstandings
//
// Phase 4 of plans/accounts-and-balances.md.
//
// Rules governed by plans/accounts-and-balances.md:
// 1. One cumulative money figure: cash in hand + bank balances (balance_periods).
// 2. Individual credit cards (card_periods).
// 3. User enters today's figures; opening = today − movements since the 1st.
// 4. INR only — foreign currencies excluded and counted in unaccountedForeignCount.
// 5. Prospective changes: past months remain fixed.
// ============================================

import { supabase } from './supabase'
import { monthKey, todayKey, sumCardMovements, getCards, type CardMovement } from './cards'
import type { BalancePeriod, Card, CardPeriod } from '@/types'

export interface AvailableMoneyMovement {
  amount: number
  type: 'debit' | 'credit'
  currency?: string | null
  card_id?: string | null
  settles_card_id?: string | null
  loan_source?: 'credit_card' | 'bank' | 'family_friend' | 'other' | null
  category?: string | null
}

export interface AvailableMoneyState {
  month: string
  opening: number
  netMovement: number
  current: number
  isConfigured: boolean
  isUserSet: boolean
  unaccountedForeignCount: number
}

export interface CardBalanceState {
  card: Card
  opening: number
  netMovement: number
  currentOutstanding: number
  isUserSet: boolean
}

export interface FinancialBalanceSummary {
  month: string
  availableMoney: AvailableMoneyState
  cards: CardBalanceState[]
  totalCardDebt: number
  netLiquidWealth: number
}

/**
 * Calculates net movement on available money (cash + bank) from transaction rows.
 *
 * Rules:
 * - Foreign currencies (non-INR) are excluded and counted.
 * - Spends from bank (card_id is null, debit): decreases money (-amount).
 * - CC Bill payment (settles_card_id is not null, card_id is null, debit): decreases money (-amount).
 * - Card spend (card_id is not null, debit): 0 (does not leave bank yet).
 * - Income / refund to bank (card_id is null, credit, not a card advance): increases money (+amount).
 * - Loan with source = 'credit_card' (credit): increases bank money (+amount) because cash arrived.
 * - Card refund (card_id is not null, credit, not a card advance): 0 (refunded to card, not bank).
 */
export function sumAvailableMoneyMovements(rows: AvailableMoneyMovement[]): {
  net: number
  unaccountedForeignCount: number
} {
  let net = 0
  let unaccountedForeignCount = 0

  for (const row of rows) {
    const currency = (row.currency || 'INR').toUpperCase()
    if (currency !== 'INR') {
      unaccountedForeignCount++
      continue
    }

    const amount = Number(row.amount) || 0
    const isCardSpend = Boolean(row.card_id)
    const isCardCashAdvance = row.loan_source === 'credit_card'

    if (row.type === 'debit') {
      // If it's on a card, money hasn't left the bank.
      // If card_id is null (including CC bill payments where settles_card_id is set), money left bank.
      if (!isCardSpend) {
        net -= amount
      }
    } else if (row.type === 'credit') {
      // Money arrives in bank if:
      // 1) card_id is null (income, refund to bank, bank loan, friend loan)
      // 2) OR loan_source is 'credit_card' (cash advance / wallet transfer into bank)
      if (!isCardSpend || isCardCashAdvance) {
        net += amount
      }
    }
  }

  return { net, unaccountedForeignCount }
}

/** Converts today's typed balance to the 1st-of-month opening balance */
export function computeTodayOpening(todayAmount: number, netMovementSinceFirst: number): number {
  return todayAmount - netMovementSinceFirst
}

/** Fetch user's balance period row for a given month */
export async function getBalancePeriod(month: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('balance_periods')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', month)
    .maybeSingle()

  return { data: data as BalancePeriod | null, error }
}

/** Set the opening balance for a specific month */
export async function setBalancePeriodOpening(month: string, amount: number) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('balance_periods')
    .upsert(
      {
        user_id: user.id,
        month,
        opening_amount: amount,
        is_user_set: true,
      },
      { onConflict: 'user_id,month' }
    )
    .select()
    .single()

  return { data: data as BalancePeriod | null, error }
}

/**
 * Fetch approved transactions for available money calculations within a date range.
 */
async function fetchApprovedTransactionsInRange(startDate: string, endDate: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type, currency, card_id, settles_card_id, loan_source, category, date')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .gte('date', startDate)
    .lte('date', endDate)

  return { data: data as AvailableMoneyMovement[] | null, error }
}

/**
 * Calculates net available money movements since the 1st of the month up to a given date.
 */
export async function getAvailableMoneyMovementsSince(month: string, upto: string = todayKey()) {
  const { data, error } = await fetchApprovedTransactionsInRange(month, upto)
  if (error || !data) return { net: 0, unaccountedForeignCount: 0, error }

  const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(data)
  return { net, unaccountedForeignCount, error: null }
}

/**
 * Set available money as of today.
 * Calculates opening = today - netMovementsSinceMonthStart and saves it.
 */
export async function setAvailableMoneyToday(todayAmount: number, targetDate: Date = new Date()) {
  const month = monthKey(targetDate)
  const upto = todayKey(targetDate)

  const { net } = await getAvailableMoneyMovementsSince(month, upto)
  const opening = computeTodayOpening(todayAmount, net)

  return setBalancePeriodOpening(month, opening)
}

/**
 * Resolves the effective opening balance for a month.
 * If no record exists for `month`, carries forward from the most recent previous month.
 */
export async function resolveAvailableMoneyOpening(targetMonth: string): Promise<{
  opening: number | null
  isUserSet: boolean
  isConfigured: boolean
}> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { opening: null, isUserSet: false, isConfigured: false }

  // 1. Check if exact month has a record
  const { data: currentPeriod } = await getBalancePeriod(targetMonth)
  if (currentPeriod) {
    return {
      opening: Number(currentPeriod.opening_amount),
      isUserSet: currentPeriod.is_user_set,
      isConfigured: true,
    }
  }

  // 2. Find the most recent recorded month before targetMonth
  const { data: pastPeriods, error } = await supabase
    .from('balance_periods')
    .select('month, opening_amount, is_user_set')
    .eq('user_id', user.id)
    .lt('month', targetMonth)
    .order('month', { ascending: false })
    .limit(1)

  if (error || !pastPeriods || pastPeriods.length === 0) {
    return { opening: null, isUserSet: false, isConfigured: false }
  }

  const anchor = pastPeriods[0]
  const anchorOpening = Number(anchor.opening_amount)

  // Compute movements from anchor.month up to targetMonth (exclusive)
  // End date is day before targetMonth
  const [targetY, targetM] = targetMonth.split('-').map(Number)
  const prevMonthEnd = new Date(targetY, targetM - 1, 0)
  const prevMonthEndKey = todayKey(prevMonthEnd)

  const { data: movements } = await fetchApprovedTransactionsInRange(anchor.month, prevMonthEndKey)
  const { net } = sumAvailableMoneyMovements(movements || [])

  const carriedForward = anchorOpening + net

  // Save the carried forward opening for this month so subsequent queries are fast
  try {
    await supabase.from('balance_periods').insert({
      user_id: user.id,
      month: targetMonth,
      opening_amount: carriedForward,
      is_user_set: false,
    })
  } catch {
    // Non-fatal if concurrent insert happens
  }

  return {
    opening: carriedForward,
    isUserSet: false,
    isConfigured: true,
  }
}

/**
 * Computes full Available Money state for a given month.
 */
export async function getAvailableMoney(month: string = monthKey()): Promise<AvailableMoneyState> {
  const { opening, isUserSet, isConfigured } = await resolveAvailableMoneyOpening(month)

  if (opening === null || !isConfigured) {
    return {
      month,
      opening: 0,
      netMovement: 0,
      current: 0,
      isConfigured: false,
      isUserSet: false,
      unaccountedForeignCount: 0,
    }
  }

  // Compute movements in this month up to today
  const upto = todayKey()
  const { net, unaccountedForeignCount } = await getAvailableMoneyMovementsSince(month, upto)

  return {
    month,
    opening,
    netMovement: net,
    current: opening + net,
    isConfigured: true,
    isUserSet,
    unaccountedForeignCount,
  }
}

/**
 * Computes full Credit Card balances state for all active cards in a given month.
 */
export async function getCardBalances(month: string = monthKey()): Promise<CardBalanceState[]> {
  const { data: cards, error: cardsError } = await getCards()
  if (cardsError || !cards) return []

  const activeCards = cards.filter((c) => !c.is_archived)
  if (activeCards.length === 0) return []

  // Fetch card periods for this month
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: periods } = await supabase
    .from('card_periods')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', month)

  const periodMap = new Map<string, CardPeriod>()
  for (const p of periods || []) {
    periodMap.set(p.card_id, p)
  }

  // Fetch all movements for these cards this month up to today
  const upto = todayKey()
  const { data: rows } = await supabase
    .from('transactions')
    .select('amount, type, card_id, settles_card_id, loan_source')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .gte('date', month)
    .lte('date', upto)
    .or('card_id.not.is.null,settles_card_id.not.is.null')

  const movementsByCard = sumCardMovements((rows || []) as CardMovement[])

  return activeCards.map((card) => {
    const period = periodMap.get(card.id)
    const opening = period ? Number(period.opening_outstanding) : 0
    const net = movementsByCard[card.id] || 0
    return {
      card,
      opening,
      netMovement: net,
      currentOutstanding: Math.max(0, opening + net),
      isUserSet: period?.is_user_set ?? false,
    }
  })
}

/**
 * Top-line financial summary combining available bank/cash money and credit card debts.
 */
export async function getFinancialSummary(month: string = monthKey()): Promise<FinancialBalanceSummary> {
  const [availableMoney, cards] = await Promise.all([
    getAvailableMoney(month),
    getCardBalances(month),
  ])

  const totalCardDebt = cards.reduce((sum, c) => sum + c.currentOutstanding, 0)
  const netLiquidWealth = availableMoney.current - totalCardDebt

  return {
    month,
    availableMoney,
    cards,
    totalCardDebt,
    netLiquidWealth,
  }
}

/**
 * Record a 1-tap drift reconciliation transaction.
 *
 * When the computed figure drifts from what the user's banking app says:
 * - If bank has extra money (real > computed): records an Income/Credit adjustment.
 * - If bank is missing money (computed > real): records an Expense/Debit adjustment.
 * - If card has higher debt (real > computed): records a Card Fee/Debit adjustment on the card.
 * - If card has lower debt (computed > real): records a Card Waiver/Credit adjustment on the card.
 */
export async function recordDriftReconciliation(params: {
  target: 'bank' | 'card'
  cardId?: string
  diff: number // real - computed
  notes?: string
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: new Error('User not authenticated') }

  const today = todayKey()
  const absAmount = Math.abs(params.diff)
  if (absAmount === 0) return { error: null }

  if (params.target === 'bank') {
    const isSurplus = params.diff > 0
    const { error } = await supabase.from('transactions').insert({
      user_id: user.id,
      amount: absAmount,
      type: isSurplus ? 'credit' : 'debit',
      category: 'Adjustment',
      merchant: 'Balance Reconciliation',
      description: params.notes || (isSurplus ? 'Reconciliation Surplus' : 'Reconciliation Adjustment'),
      date: today,
      approval_status: 'approved',
      category_confirmed_at: new Date().toISOString(),
      source: 'manual',
    })
    return { error }
  } else {
    // Credit card reconciliation
    const owesMore = params.diff > 0
    const { error } = await supabase.from('transactions').insert({
      user_id: user.id,
      amount: absAmount,
      type: owesMore ? 'debit' : 'credit',
      category: 'Adjustment',
      merchant: 'Card Reconciliation',
      description: params.notes || (owesMore ? 'Card Balance Adjustment' : 'Card Waiver / Cashback Adjustment'),
      date: today,
      card_id: params.cardId || null,
      approval_status: 'approved',
      category_confirmed_at: new Date().toISOString(),
      source: 'manual',
    })
    return { error }
  }
}
