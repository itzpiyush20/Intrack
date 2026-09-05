// ============================================
// Categories Service — per-user category CRUD
// Rename/delete go through atomic Postgres RPCs.
// ============================================

import { supabase } from './supabase'
import type { AnalyticsTag, Category, CategoryType } from '@/types'

export async function getCategories() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  return { data: data as Category[] | null, error }
}

export async function createCategory(input: {
  name: string
  emoji: string
  color: string
  type: CategoryType
  budget_eligible: boolean
  analytics_tags?: AnalyticsTag[]
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: user.id, ...input })
    .select()
    .single()

  return { data: data as Category | null, error }
}

/** Update emoji/color/type/budget_eligible/analytics_tags — everything except the name. */
export async function updateCategoryStyle(
  id: string,
  patch: Partial<Pick<Category, 'emoji' | 'color' | 'type' | 'budget_eligible' | 'analytics_tags'>>
) {
  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  return { data: data as Category | null, error }
}

/** Atomic rename: cascades to transactions, budgets, merchant_rules via RPC. */
export async function renameCategory(oldName: string, newName: string) {
  const { error } = await supabase.rpc('rename_category', {
    old_name: oldName,
    new_name: newName,
  })
  return { error }
}

/** Atomic delete: transactions→fallback, budgets removed, rules→fallback. */
export async function deleteCategory(name: string) {
  const { data, error } = await supabase.rpc('delete_category', { cat_name: name })
  const row = Array.isArray(data) ? data[0] : data
  return {
    data: row as { moved_transactions: number; deleted_budgets: number; fallback_name: string } | null,
    error,
  }
}

/** Usage counts shown in the delete-confirmation dialog. */
export async function getCategoryUsage(name: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const [tx, budgets] = await Promise.all([
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('category', name),
    // Deleted budgets are kept as rows carrying deleted_at (migration 043),
    // so counting them would overstate how much a category is still used
    // in the delete-category confirmation.
    supabase.from('budgets').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('category', name).is('deleted_at', null),
  ])

  return {
    data: { transactions: tx.count ?? 0, budgets: budgets.count ?? 0 },
    error: tx.error || budgets.error,
  }
}
