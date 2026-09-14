// ============================================
// merchantKey — how merchant names are compared.
//
// merchantKey() must stay byte-for-byte the same rule as the generated
// `name_key` column in supabase/048_merchants.sql, or a merchant the database
// calls a duplicate would look new here (and the reverse).
// ============================================

export interface MerchantOption {
  id: string
  name: string
  default_category: string | null
  /** alias_key values — already normalised. */
  aliases: string[]
}

export function merchantKey(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Exact match on a merchant's name or one of its aliases. Never a substring. */
export function matchMerchant(text: string | null | undefined, merchants: MerchantOption[]): MerchantOption | null {
  const key = merchantKey(text)
  if (!key) return null
  return (
    merchants.find((m) => merchantKey(m.name) === key) ??
    merchants.find((m) => m.aliases.includes(key)) ??
    null
  )
}

const byName = (a: MerchantOption, b: MerchantOption) => a.name.localeCompare(b.name)

/** Picker suggestions: name-prefix matches first, then name/alias substring matches. */
export function filterMerchants(query: string, merchants: MerchantOption[], limit = 8): MerchantOption[] {
  const q = merchantKey(query)
  if (!q) return [...merchants].sort(byName).slice(0, limit)

  const prefix: MerchantOption[] = []
  const contains: MerchantOption[] = []
  for (const m of merchants) {
    const name = merchantKey(m.name)
    if (name.startsWith(q)) prefix.push(m)
    else if (name.includes(q) || m.aliases.some((a) => a.includes(q))) contains.push(m)
  }
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit)
}
