// ============================================
// Debts & Loans Service — Borrowings, Repayments & Active Debt Tracking
// Tracks loans across credit card cash advances, banks, family/friends, and other sources
// ============================================

import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type LoanSource = 'credit_card' | 'bank' | 'family_friend' | 'other'

export interface DebtSourceSummary {
  source: LoanSource
  label: string
  description: string
  borrowed: number
  repaid: number
  outstanding: number
  transactionCount: number
}

export interface DebtTransactionItem {
  id: string
  amount: number
  type: 'debit' | 'credit'
  date: string
  category: string
  description: string
  loan_source: LoanSource
  loan_source_note?: string | null
  counterparty?: string | null
  card_id?: string | null
  merchant?: string | null
}

export interface ActiveDebtSummary {
  totalBorrowed: number
  totalRepaid: number
  totalOutstanding: number
  sources: Record<LoanSource, DebtSourceSummary>
  bySourceList: DebtSourceSummary[]
  transactions: DebtTransactionItem[]
}

export const LOAN_SOURCE_LABELS: Record<LoanSource, string> = {
  credit_card: 'Credit Card Advances',
  bank: 'Bank Loans & Overdrafts',
  family_friend: 'Family & Friends',
  other: 'Other Borrowings',
}

export const LOAN_SOURCE_DESCRIPTIONS: Record<LoanSource, string> = {
  credit_card: 'Cash advances or wallet transfers from credit cards',
  bank: 'Personal loans, vehicle loans, education loans, and overdrafts',
  family_friend: 'Informal loans from friends, family, and peers',
  other: 'Peer-to-peer borrowings and miscellaneous lenders',
}

const ORDERED_SOURCES: LoanSource[] = ['credit_card', 'bank', 'family_friend', 'other']

/**
 * Resolves the effective loan source from a transaction's fields.
 */
export function resolveLoanSource(row: {
  loan_source?: string | null
  category?: string | null
  event_type?: string | null
}): LoanSource | null {
  if (row.loan_source && (ORDERED_SOURCES as string[]).includes(row.loan_source)) {
    return row.loan_source as LoanSource
  }
  if (row.category && row.category.trim().toLowerCase() === 'loan') {
    return 'other'
  }
  if (row.event_type === 'loan_repayment') {
    return 'bank'
  }
  return null
}

/**
 * Pure calculation helper: aggregates total borrowed (credits) vs repaid (debits)
 * across each loan source, computing outstanding balances and overall debt metrics.
 */
export function calculateDebtSummary(transactions: DebtTransactionItem[]): ActiveDebtSummary {
  const sources: Record<LoanSource, DebtSourceSummary> = {
    credit_card: {
      source: 'credit_card',
      label: LOAN_SOURCE_LABELS.credit_card,
      description: LOAN_SOURCE_DESCRIPTIONS.credit_card,
      borrowed: 0,
      repaid: 0,
      outstanding: 0,
      transactionCount: 0,
    },
    bank: {
      source: 'bank',
      label: LOAN_SOURCE_LABELS.bank,
      description: LOAN_SOURCE_DESCRIPTIONS.bank,
      borrowed: 0,
      repaid: 0,
      outstanding: 0,
      transactionCount: 0,
    },
    family_friend: {
      source: 'family_friend',
      label: LOAN_SOURCE_LABELS.family_friend,
      description: LOAN_SOURCE_DESCRIPTIONS.family_friend,
      borrowed: 0,
      repaid: 0,
      outstanding: 0,
      transactionCount: 0,
    },
    other: {
      source: 'other',
      label: LOAN_SOURCE_LABELS.other,
      description: LOAN_SOURCE_DESCRIPTIONS.other,
      borrowed: 0,
      repaid: 0,
      outstanding: 0,
      transactionCount: 0,
    },
  }

  for (const txn of transactions) {
    const src = sources[txn.loan_source]
    if (!src) continue

    const amt = Number(txn.amount) || 0
    if (txn.type === 'credit') {
      // Credit = money borrowed into bank / pocket
      src.borrowed += amt
    } else if (txn.type === 'debit') {
      // Debit = loan repayment
      src.repaid += amt
    }
    src.transactionCount += 1
  }

  let totalBorrowed = 0
  let totalRepaid = 0
  let totalOutstanding = 0

  for (const key of ORDERED_SOURCES) {
    const src = sources[key]
    src.outstanding = Math.max(0, src.borrowed - src.repaid)
    totalBorrowed += src.borrowed
    totalRepaid += src.repaid
    totalOutstanding += src.outstanding
  }

  const bySourceList = ORDERED_SOURCES.map((k) => sources[k])

  return {
    totalBorrowed,
    totalRepaid,
    totalOutstanding,
    sources,
    bySourceList,
    transactions,
  }
}

/**
 * Fetches all approved loan-related transactions and calculates the active debt summary.
 */
export async function getActiveDebts(): Promise<{ data: ActiveDebtSummary | null; error: unknown }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, type, date, category, description, loan_source, loan_source_note, counterparty, card_id, merchant, event_type, approval_status')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .or('loan_source.not.is.null,category.ilike.Loan,event_type.eq.loan_repayment')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { data: null, error }

  const validTxns: DebtTransactionItem[] = []
  for (const row of (data || [])) {
    const source = resolveLoanSource(row)
    if (!source) continue

    validTxns.push({
      id: row.id,
      amount: Number(row.amount),
      type: row.type as 'debit' | 'credit',
      date: row.date,
      category: row.category || 'Loan',
      description: row.description || '',
      loan_source: source,
      loan_source_note: row.loan_source_note,
      counterparty: row.counterparty,
      card_id: row.card_id,
      merchant: row.merchant,
    })
  }

  const summary = calculateDebtSummary(validTxns)
  return { data: summary, error: null }
}

/**
 * Records a new loan borrowing or repayment transaction.
 */
export async function recordDebtTransaction(params: {
  type: 'debit' | 'credit'
  amount: number
  loan_source: LoanSource
  loan_source_note?: string
  description: string
  date: string
  card_id?: string | null
  counterparty?: string | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      type: params.type,
      amount: params.amount,
      category: 'Loan',
      description: params.description,
      date: params.date,
      source: 'manual',
      approval_status: 'approved',
      loan_source: params.loan_source,
      loan_source_note: params.loan_source_note || null,
      counterparty: params.counterparty || null,
      card_id: params.loan_source === 'credit_card' ? (params.card_id || null) : null,
      event_type: params.type === 'debit' ? 'loan_repayment' : null,
    })
    .select()
    .single()

  return { data: data as Database['public']['Tables']['transactions']['Row'] | null, error }
}
