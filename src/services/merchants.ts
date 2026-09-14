// ============================================
// Merchants service — the user's saved merchant list (migration 048).
//
// RLS scopes every read to the signed-in user. Aliases are read in a second
// query and joined here rather than as an embedded select, so this does not
// depend on relationship metadata in the generated types.
// ============================================

import { supabase } from './supabase'
import { merchantKey, type MerchantOption } from '@/utils/merchantKey'

/** Rows per page — PostgREST silently stops at db-max-rows otherwise. */
const PAGE_SIZE = 1000

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = []
  for (let offset = 0; ; ) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1)
    if (error) return { rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { rows, error: null }
    offset += page.length
  }
}

export async function listMerchants(): Promise<{ data: MerchantOption[]; error: unknown }> {
  const merchants = await readAll<{ id: string; name: string; default_category: string | null }>((from, to) =>
    supabase.from('merchants').select('id, name, default_category').order('id', { ascending: true }).range(from, to)
  )
  if (merchants.error) return { data: [], error: merchants.error }

  const aliases = await readAll<{ merchant_id: string; alias_key: string }>((from, to) =>
    supabase.from('merchant_aliases').select('merchant_id, alias_key').order('id', { ascending: true }).range(from, to)
  )
  // Aliases only widen matching; without them the list still works.
  const byMerchant = new Map<string, string[]>()
  for (const a of aliases.rows) {
    byMerchant.set(a.merchant_id, [...(byMerchant.get(a.merchant_id) ?? []), a.alias_key])
  }

  return {
    data: merchants.rows.map((m) => ({ ...m, aliases: byMerchant.get(m.id) ?? [] })),
    error: null,
  }
}

export async function createMerchant(
  userId: string,
  name: string,
  defaultCategory: string | null
): Promise<{ data: MerchantOption | null; error: unknown }> {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return { data: null, error: new Error('Merchant name is empty') }

  const { data, error } = await supabase
    .from('merchants')
    .insert({ user_id: userId, name: clean, default_category: defaultCategory })
    .select('id, name, default_category')
    .single()

  if (!error && data) return { data: { ...data, aliases: [] }, error: null }

  // Same name already saved (UNIQUE user_id, name_key): use that one.
  if ((error as { code?: string } | null)?.code === '23505') {
    const existing = await supabase
      .from('merchants')
      .select('id, name, default_category')
      .eq('user_id', userId)
      .eq('name_key', merchantKey(clean))
      .single()
    if (existing.data) return { data: { ...existing.data, aliases: [] }, error: null }
    return { data: null, error: existing.error }
  }
  return { data: null, error }
}

/**
 * Remember another spelling for a merchant the user just picked. Best effort:
 * a failure only means this spelling won't pre-match next time.
 */
export async function addMerchantAlias(userId: string, merchant: MerchantOption, typed: string): Promise<void> {
  const key = merchantKey(typed)
  if (!key || key === merchantKey(merchant.name) || merchant.aliases.includes(key)) return
  await supabase.from('merchant_aliases').insert({ user_id: userId, merchant_id: merchant.id, alias_key: key })
}
