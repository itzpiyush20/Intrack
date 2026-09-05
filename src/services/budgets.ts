// ============================================
// Budget Service — CRUD operations + month-to-month carry-forward
// All Supabase calls for budgets
// ============================================
//
// CARRY-FORWARD DESIGN (see the pure helpers below — they hold the whole rule)
//
// A budget is a *rule* ("I spend at most 5,000 on Food each month"), not a
// one-off fact. The table stores one row per user/category/month, so without
// help every rule evaporates at midnight on the 1st. Carry-forward re-states
// last month's rules into the new month.
//
// 1. LAZILY, ON READ. There is no scheduler in this app and there must not be
//    one — background work was deliberately removed (plans/remove-auto-sync.md).
//    So the copy happens the first time anyone reads the current month.
// 2. SOURCE = THE MOST RECENT MONTH THAT HAS ROWS, not the previous month. A
//    user who skips March and April still gets February's rules in May.
// 3. MATERIALISED, NOT VIRTUAL. The carried rules are inserted as real rows for
//    the target month. A virtual overlay would break the moment the user edited
//    one category (the month would then "have rows" and the rest would vanish),
//    and it would give the UI no row id to edit or delete. Because the copies
//    are separate rows, editing this month's Food limit writes only this
//    month's row — the source month is never touched. That mirrors the rule the
//    owner settled for opening balances: corrections are prospective.
// 4. ONLY THE CURRENT MONTH IS EVER MATERIALISED (`shouldCarryForward`).
//    Back-filling past months would fabricate history and falsify every report
//    over that period; materialising future months would multiply totals in the
//    Budgets page's custom-range view, which sums getBudgets() across every
//    month in range. A future month gets its rules when it becomes current.
// 5. A DELETION IS A TOMBSTONE, NOT A MISSING ROW. Deleting the last budget of
//    the month would otherwise empty the month and the very next read would
//    helpfully restore what the user just removed. Deleting in the current
//    month therefore sets the row's amount to 0 instead of removing it. Zero is
//    unambiguous: the schema allows `amount >= 0`, but the only writer of a
//    budget amount is the Budgets form, whose input is `min=1`, so no real
//    budget is ever 0. Tombstones are filtered out of every read, are never
//    copied forward, and still mark the month as "materialised" so nothing
//    reappears. (A dedicated `deleted_at` column would be tidier, but this
//    needs no migration — see the report.)

import { supabase } from './supabase'
import { getCurrentMonth } from '@/utils'
import type { Database } from '@/types/database'

type BudgetRow = Database['public']['Tables']['budgets']['Row']

/**
 * A deliberate deletion is a row with `deleted_at` set (migration 043).
 *
 * This used to be `amount = 0`, which worked only because the one form that
 * writes an amount carries min="1" — a convention held up by a form attribute
 * rather than the database. Any code writing a zero for an innocent reason
 * would have silently deleted someone's budget.
 *
 * Rows stamped by 043's backfill still carry amount 0 alongside their
 * timestamp; that is harmless, since a deleted budget's amount is never read.
 */

/** How many prior rows to scan when looking for a source month to copy. */
const SOURCE_LOOKBACK_ROWS = 500

type MonthRow = { category: string; amount: number; month: string; deleted_at?: string | null }

/** True when the row records "the user removed this budget", not a real limit. */
export function isTombstone(row: { deleted_at?: string | null }): boolean {
  return row.deleted_at != null
}

/** Drop tombstones — nothing outside this module should ever see one. */
export function visibleBudgets<T extends { deleted_at?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !isTombstone(r))
}

/**
 * Carry-forward only ever targets the month the user is living in. Past months
 * keep their factual record; future months are filled in when they arrive.
 */
export function shouldCarryForward(month: string, currentMonth: string = getCurrentMonth()): boolean {
  return month === currentMonth
}

/**
 * From every row older than `beforeMonth`, return the rows of the single most
 * recent month present — tombstones included, because a month containing only
 * tombstones is still the latest statement of the user's intent (they deleted
 * everything) and must not be skipped over in favour of an older month.
 */
export function pickSourceMonthRows<T extends { month: string }>(rows: T[], beforeMonth: string): T[] {
  const older = rows.filter((r) => r.month < beforeMonth)
  if (older.length === 0) return []
  const latest = older.reduce((max, r) => (r.month > max ? r.month : max), older[0].month)
  return older.filter((r) => r.month === latest)
}

/**
 * The whole carry-forward decision, as a pure function so it is testable
 * without a database.
 *
 * Returns the rows that must be inserted for `targetMonth` — empty whenever
 * carry-forward must not happen at all.
 */
export function planCarryForward(input: {
  targetMonth: string
  /** Rows that already exist for targetMonth, tombstones included. */
  existingRows: MonthRow[]
  /** Rows for months older than targetMonth (any number of months). */
  priorRows: MonthRow[]
  /** Categories that still exist AND can still hold a budget. */
  eligibleCategories: string[]
}): MonthRow[] {
  const { targetMonth, existingRows, priorRows, eligibleCategories } = input

  // The month has already been materialised — by a real budget, by an earlier
  // carry-forward, or by a tombstone. Never touch it again.
  if (existingRows.length > 0) return []

  const source = pickSourceMonthRows(priorRows, targetMonth)
  if (source.length === 0) return []

  // Categories can be renamed or deleted between months. Renames cascade to
  // budgets through the rename_category RPC and deletes remove the budgets
  // outright, but a stale name must never resurrect a category: only names the
  // user still has, and can still budget for, are copied.
  const eligible = new Set(eligibleCategories)

  const seen = new Set<string>()
  const plan: MonthRow[] = []
  for (const row of source) {
    if (isTombstone(row)) continue
    if (!eligible.has(row.category)) continue
    if (seen.has(row.category)) continue
    seen.add(row.category)
    plan.push({ category: row.category, amount: Number(row.amount), month: targetMonth })
  }
  return plan
}

/** Names of categories a budget may be set for — mirrors the Budgets form. */
async function fetchEligibleCategories(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('name, type, budget_eligible')
    .eq('user_id', userId)

  if (error || !data) return []
  return (data as Array<{ name: string; type: string; budget_eligible: boolean }>)
    .filter((c) => c.type === 'expense' && c.budget_eligible)
    .map((c) => c.name)
}

/**
 * Materialise last month's rules into `month`. Best-effort: any failure here
 * leaves the month empty rather than failing the caller's read, because a
 * convenience write must never break the page that triggered it.
 *
 * Returns true if rows were written (the caller should re-read).
 */
async function carryForwardInto(userId: string, month: string): Promise<boolean> {
  try {
    const [priorRes, eligibleCategories] = await Promise.all([
      supabase
        .from('budgets')
        .select('category, amount, month, deleted_at')
        .eq('user_id', userId)
        .lt('month', month)
        .order('month', { ascending: false })
        .limit(SOURCE_LOOKBACK_ROWS),
      fetchEligibleCategories(userId),
    ])

    if (priorRes.error || !priorRes.data) return false

    const plan = planCarryForward({
      targetMonth: month,
      existingRows: [],
      priorRows: priorRes.data as MonthRow[],
      eligibleCategories,
    })
    if (plan.length === 0) return false

    // ignoreDuplicates: another tab (or the Dashboard, which reads the same
    // month) may be materialising concurrently. Whoever gets there first wins;
    // we must never overwrite a value the user has meanwhile typed.
    const { error } = await supabase
      .from('budgets')
      .upsert(
        plan.map((p) => ({ user_id: userId, ...p })),
        { onConflict: 'user_id,category,month', ignoreDuplicates: true }
      )

    if (error) {
      console.warn('Budget carry-forward skipped:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('Budget carry-forward skipped:', err)
    return false
  }
}

/**
 * Fetch budgets for current user for a specific month.
 *
 * For the current month, an empty month is first filled from the most recent
 * month that has budgets (see the design note at the top of this file). Pass
 * `{ carryForward: false }` for a pure read.
 */
export async function getBudgets(month: string, options?: { carryForward?: boolean }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const read = async () => {
    const { data, error } = await supabase
      .from('budgets')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', month)
      .order('created_at', { ascending: false })
    return { data: data as BudgetRow[] | null, error }
  }

  const first = await read()
  if (first.error) return first

  const allowCarry = options?.carryForward !== false && shouldCarryForward(month)
  // Rows present — even if every one of them is a tombstone — means the month
  // has already been decided. Only a genuinely untouched month is filled.
  if (!allowCarry || (first.data && first.data.length > 0)) {
    return { data: visibleBudgets(first.data || []), error: first.error }
  }

  const wrote = await carryForwardInto(user.id, month)
  if (!wrote) return { data: visibleBudgets(first.data || []), error: first.error }

  const second = await read()
  if (second.error) return { data: visibleBudgets(first.data || []), error: null }
  return { data: visibleBudgets(second.data || []), error: null }
}

/** Set or update a budget for a category in a month */
export async function upsertBudget(category: string, amount: number, month: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('budgets')
    .upsert(
      {
        user_id: user.id,
        category,
        amount,
        month,
      },
      { onConflict: 'user_id,category,month' }
    )
    .select()
    .single()

  return { data: data as BudgetRow | null, error }
}

/**
 * Delete a budget limit.
 *
 * Pass the row's `month` so a deletion in the current month can be recorded as
 * a tombstone instead of a removal — otherwise emptying the month would let the
 * next read carry the same budgets straight back in. Deletions in other months
 * are plain removals: nothing is ever carried forward into them.
 */
export async function deleteBudget(id: string, budget?: { month: string }) {
  if (budget && shouldCarryForward(budget.month)) {
    const { error } = await supabase
      .from('budgets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    return { error }
  }

  const { error } = await supabase
    .from('budgets')
    .delete()
    .eq('id', id)

  return { error }
}
