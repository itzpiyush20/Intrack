import { HOME_CURRENCY } from '../utils/index.js'
// ============================================
// Transaction Service — CRUD operations
// All Supabase calls for transactions
// ============================================

import { supabase } from './supabase'
import { makeIsCreditCardBill } from '@/utils/creditCardBill'
import type { Database } from '@/types/database'
import { toISODateLocal } from '@/utils/dateFilter'

type TransactionRow = Database['public']['Tables']['transactions']['Row']
type TransactionInsert = Database['public']['Tables']['transactions']['Insert']
type TransactionUpdate = Database['public']['Tables']['transactions']['Update']

export interface TransactionQueryOptions {
  month?: string        // YYYY-MM — ignored if dateFrom/dateTo are given
  dateFrom?: string      // YYYY-MM-DD
  dateTo?: string        // YYYY-MM-DD
  type?: 'debit' | 'credit'
  category?: string
  /** Single approval_status to match. Defaults to 'approved' when neither this nor `statuses` is given. */
  status?: string
  /** Several approval statuses at once, e.g. ['approved', 'pending'] for exports. Takes precedence over `status`. */
  statuses?: string[]
  limit?: number
  offset?: number
}

/**
 * Shared filter/order builder for the transaction list queries. Kept separate
 * from the paging so `fetchAllTransactions` can issue the identical query once
 * per page without duplicating (and drifting from) the filter logic.
 */
function buildTransactionQuery(options?: TransactionQueryOptions) {
  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })

  if (options?.statuses && options.statuses.length > 0) {
    query = query.in('approval_status', options.statuses)
  } else if (options?.status) {
    query = query.eq('approval_status', options.status)
  } else {
    query = query.eq('approval_status', 'approved')
  }

  // `id` is a tiebreaker, not decoration. `date` is a DATE and `created_at` can
  // tie for rows written in the same batch (a scan flushes ten at once), and
  // Postgres gives no stable order to rows that compare equal. Paging with
  // .range() issues one request per page, so an unstable order lets a row move
  // between pages — appearing twice, or not at all. In a list view that is a
  // cosmetic wobble; in the encrypted backup that fetchAllTransactions feeds, it
  // is silent data corruption.
  query = query
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (options?.dateFrom || options?.dateTo) {
    if (options.dateFrom) query = query.gte('date', options.dateFrom)
    if (options.dateTo) query = query.lte('date', options.dateTo)
  } else if (options?.month) {
    const startDate = `${options.month}-01`
    const [year, mon] = options.month.split('-').map(Number)
    const endDate = toISODateLocal(new Date(year, mon, 0))
    query = query.gte('date', startDate).lte('date', endDate)
  }

  if (options?.type) {
    query = query.eq('type', options.type)
  }

  if (options?.category) {
    query = query.eq('category', options.category)
  }

  return query
}

/** Fetch transactions for current user with filters */
export async function getTransactions(options?: TransactionQueryOptions) {
  let query = buildTransactionQuery(options)

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1)
  }

  const { data, error, count } = await query

  return { data: data as TransactionRow[] | null, error, count }
}

/**
 * How many rows we ASK for per page. PostgREST will return fewer if its own
 * `db-max-rows` setting is lower (1000 on Supabase by default), which is why
 * the loop below must never treat "fewer than requested" as "no rows left".
 */
const ALL_TRANSACTIONS_PAGE_SIZE = 1000

/**
 * Fetch EVERY row matching the filters, paging with `.range()` until a short
 * page comes back.
 *
 * A plain `getTransactions()` with no `limit` does not return everything: it
 * returns at most `db-max-rows` rows, and the caller has no way to tell a
 * complete answer from a truncated one. That silent ceiling is survivable for a
 * list view but not for the export and encrypted-backup paths in
 * SettingsPage — a user with 1001 transactions was downloading a "full backup"
 * that quietly dropped everything past the first 1000 rows, and the
 * restore-time dedup was comparing against an equally truncated snapshot, so
 * older transactions would be re-inserted as duplicates.
 *
 * Callers that pass an explicit `limit` (Dashboard, Pending) still want the
 * single capped query and should keep using `getTransactions`.
 */
export async function fetchAllTransactions(
  options?: Omit<TransactionQueryOptions, 'limit' | 'offset'>
): Promise<{ data: TransactionRow[] | null; error: unknown }> {
  const all: TransactionRow[] = []
  let offset = 0

  for (;;) {
    // A fresh builder per page: PostgrestFilterBuilder is a thenable that can
    // only be awaited once, so the same instance cannot be re-ranged and
    // re-executed.
    const { data, error, count } = await buildTransactionQuery(options)
      .range(offset, offset + ALL_TRANSACTIONS_PAGE_SIZE - 1)

    if (error) return { data: null, error }

    const page = (data ?? []) as TransactionRow[]
    all.push(...page)

    // Advance by what actually ARRIVED, not by the size we asked for. Treating
    // "shorter than requested" as "no rows left" would reintroduce the very bug
    // this function exists to fix, in a harder-to-see form: PostgREST clamps a
    // response to its own `db-max-rows`, so were that ever set below our page
    // size, every page would come back short and the "complete" backup would
    // silently be one page long.
    if (page.length === 0) break
    offset += page.length

    // `count` is the total matching rows, which the query asks for via
    // `{ count: 'exact' }`. Using it means the common case — a few hundred
    // transactions — costs exactly one request; without it the loop can only
    // learn it is done by making one more request that comes back empty. The
    // empty-page break above stays as the fallback for when count is absent.
    if (typeof count === 'number' && all.length >= count) break
  }

  return { data: all, error: null }
}

/** Create a new transaction */
export async function createTransaction(transaction: TransactionInsert) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(transaction)
    .select()
    .single()

  return { data: data as TransactionRow | null, error }
}

/** Fetch a single transaction's full row — needed before handing it to ExpenseForm, which requires the complete TransactionRow shape (not the narrow columns some list views select). */
export async function getTransactionById(id: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  return { data: data as TransactionRow | null, error }
}

/** Update an existing transaction */
export async function updateTransaction(id: string, updates: TransactionUpdate) {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  return { data: data as TransactionRow | null, error }
}

/** Delete a transaction */
export async function deleteTransaction(id: string) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)

  return { error }
}

/** Only the columns the summary arithmetic needs, plus `id` to order by. */
type SummaryRow = Pick<TransactionRow, 'id' | 'amount' | 'currency' | 'type' | 'category'>

/** Rows requested per summary page — see ALL_TRANSACTIONS_PAGE_SIZE. */
const SUMMARY_PAGE_SIZE = 1000

/**
 * Get summary (income, expenses, savings, category breakdown) for an explicit
 * date range.
 *
 * `creditCardBillCategories` is the caller's list of categories tagged
 * `credit_card_bill` (see `creditCardBillCategoryNames`). Callers that render
 * alongside CategoriesContext should always pass it; omitting it falls back to
 * the legacy hardcoded name, which is wrong the moment a user renames or adds
 * a card-bill category.
 *
 * The query pages, for the same reason fetchAllTransactions does. A single
 * unbounded select returns at most PostgREST's `db-max-rows` (1000 here) and
 * reports no error when it truncates, so a range matching more rows than that
 * would quietly hand the Dashboard and Budgets pages an income, expense,
 * savings and category breakdown that are all too low — wrong numbers presented
 * with the same confidence as right ones. The range is user-chosen and the
 * custom-range picker can span many months, so this is reachable, not
 * theoretical.
 */
export async function getSummary(
  range: { dateFrom: string; dateTo: string },
  options?: { creditCardBillCategories?: string[] }
) {
  const isCreditCardBill = makeIsCreditCardBill(options?.creditCardBillCategories)

  const data: SummaryRow[] = []
  let offset = 0

  for (;;) {
    // A fresh builder per page, for the same reason as fetchAllTransactions:
    // PostgrestFilterBuilder is a thenable that can only be awaited once, so
    // the same instance cannot be re-ranged and re-executed.
    //
    // `id` is selected purely to order by: the range this summary covers is
    // user-chosen and the custom-range picker happily spans a year, so a total
    // order is what stops a row drifting between pages and being counted twice
    // or not at all. `id` is the primary key, so ordering by it alone is
    // already total — no tiebreaker needed.
    const { data: page, error, count } = await supabase
      .from('transactions')
      .select('id, amount, currency, type, category', { count: 'exact' })
      .eq('approval_status', 'approved')
      .gte('date', range.dateFrom)
      .lte('date', range.dateTo)
      .order('id', { ascending: true })
      .range(offset, offset + SUMMARY_PAGE_SIZE - 1)

    if (error) return { data: null, error }

    const rows = (page ?? []) as SummaryRow[]
    data.push(...rows)

    // Advance by what actually ARRIVED, not by what we asked for: PostgREST
    // clamps every response to its own `db-max-rows`, so a page can legitimately
    // come back short without the result set being finished.
    if (rows.length === 0) break
    offset += rows.length

    if (typeof count === 'number' && data.length >= count) break
  }

  // Headline totals cover the home currency ONLY. Summing rupees with dollars
  // produces a number that means nothing, and the app deliberately holds no
  // exchange rates (see src/services/currency.ts). Foreign spend is reported
  // separately below rather than being folded in or silently dropped.
  const homeRows = data.filter((t) => (t.currency ?? HOME_CURRENCY) === HOME_CURRENCY)
  const foreignRows = data.filter((t) => (t.currency ?? HOME_CURRENCY) !== HOME_CURRENCY)

  const other_currency_totals: Record<string, { income: number; expenses: number }> = {}
  for (const t of foreignRows) {
    const code = t.currency as string
    const bucket = other_currency_totals[code] ?? { income: 0, expenses: 0 }
    if (t.type === 'credit') bucket.income += Number(t.amount)
    else if (!isCreditCardBill(t.category)) bucket.expenses += Number(t.amount)
    other_currency_totals[code] = bucket
  }

  const total_income = homeRows
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  // Credit card bill payments are excluded from all expense totals — the
  // purchases they cover were already counted as expenses when they happened,
  // so counting the bill payment too would double-book that spend.
  const expenseTxns = homeRows.filter((t) => t.type === 'debit' && !isCreditCardBill(t.category))

  const total_expenses = expenseTxns.reduce((sum, t) => sum + Number(t.amount), 0)

  // Category breakdown for debits
  const categoryMap = new Map<string, { amount: number; count: number }>()
  expenseTxns.forEach((t) => {
    const existing = categoryMap.get(t.category) || { amount: 0, count: 0 }
    categoryMap.set(t.category, {
      amount: existing.amount + Number(t.amount),
      count: existing.count + 1,
    })
  })

  const category_breakdown = Array.from(categoryMap.entries())
    .map(([category, { amount, count }]) => ({
      category,
      amount,
      count,
      percentage: total_expenses > 0 ? (amount / total_expenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    data: {
      total_income,
      total_expenses,
      savings: total_income - total_expenses,
      category_breakdown,
      /** Per-currency totals for anything outside the home currency. */
      other_currency_totals,
    },
    error: null,
  }
}

/** Get monthly summary (income, expenses, savings) — thin wrapper around getSummary */
export async function getMonthlySummary(
  month: string,
  options?: { creditCardBillCategories?: string[] }
) {
  const startDate = `${month}-01`
  const [year, mon] = month.split('-').map(Number)
  const endDate = toISODateLocal(new Date(year, mon, 0))
  return getSummary({ dateFrom: startDate, dateTo: endDate }, options)
}

export async function bulkDeleteTransactions(ids: string[]) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .in('id', ids)

  return { error }
}

/** Bulk update transactions category */
export async function bulkUpdateTransactionsCategory(ids: string[], category: string) {
  const { error } = await supabase
    .from('transactions')
    .update({ category })
    .in('id', ids)

  return { error }
}

export interface LoggingStreak {
  streak: number
  loggedToday: boolean
}

/**
 * Consecutive days (ending today, or yesterday if nothing's logged yet
 * today) with at least one transaction created. Uses `created_at` (when the
 * record was logged) rather than `date` (what the expense is for), so
 * backdating an entry can't manufacture streak days.
 */
export async function getLoggingStreak(): Promise<{ data: LoggingStreak; error: Error | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { data: { streak: 0, loggedToday: false }, error: new Error('User not authenticated') }
  }

  const since = new Date()
  since.setDate(since.getDate() - 60)

  const { data, error } = await supabase
    .from('transactions')
    .select('created_at')
    .eq('user_id', user.id)
    .eq('approval_status', 'approved')
    .gte('created_at', since.toISOString())

  if (error || !data) {
    return { data: { streak: 0, loggedToday: false }, error: error as Error | null }
  }

  const days = new Set(data.map((t) => t.created_at.slice(0, 10)))
  const todayStr = new Date().toISOString().slice(0, 10)
  const loggedToday = days.has(todayStr)

  const cursor = new Date()
  if (!loggedToday) cursor.setDate(cursor.getDate() - 1)

  let streak = 0
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return { data: { streak, loggedToday }, error: null }
}

/** Returnable debits due this month or earlier, not yet received */
export async function getActiveReceivables() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const now = new Date()
  const endOfMonth = toISODateLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0))

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_returnable', true)
    .eq('return_status', 'pending')
    .lte('expected_return_date', endOfMonth)

  return { data: data as TransactionRow[] | null, error }
}

/** Marks a receivable as received: creates the payback credit and updates the original */
export async function settleReceivable(transactionId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data: original, error: fetchError } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .single()

  if (fetchError || !original) {
    return { data: null, error: fetchError || new Error('Receivable not found') }
  }

  const originalRow = original as TransactionRow

  const { data: creditTxn, error: insertError } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      type: 'credit',
      amount: originalRow.amount,
      category: originalRow.category,
      description: `Returned by ${originalRow.counterparty || 'counterparty'}`,
      date: toISODateLocal(new Date()),
      source: 'manual',
      approval_status: 'approved',
    })
    .select()
    .single()

  if (insertError || !creditTxn) {
    return { data: null, error: insertError || new Error('Failed to create payback transaction') }
  }

  const { error: updateError } = await supabase
    .from('transactions')
    .update({ return_status: 'received', settled_by_transaction_id: creditTxn.id })
    .eq('id', transactionId)

  if (updateError) {
    return { data: null, error: updateError }
  }

  return { data: creditTxn as TransactionRow, error: null }
}

