// ============================================
// merchantKey — how merchant names are compared.
//
// merchantKey() must stay byte-for-byte the same rule as the generated
// `name_key` column in supabase/048_merchants.sql, or a merchant the database
// calls a duplicate would look new here (and the reverse). The SQL spells out
// the same whitespace set as JavaScript's \s (rather than using Postgres's
// locale/ICU-dependent \s) so the two stay in lockstep.
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

/**
 * Pre-select a saved merchant on every entry that is not yet linked and whose
 * merchant text exactly matches a saved name or alias: the entry gets the saved
 * name and id. Linked entries and non-matches are untouched. Returns the SAME
 * object when nothing changed, so a React state update can bail out.
 */
export function preselectMerchants<T extends { merchant: string; merchantId: string | null }>(
  fields: Record<string, T>,
  saved: MerchantOption[]
): Record<string, T> {
  if (saved.length === 0) return fields
  let changed = false
  const next = { ...fields }
  for (const [id, f] of Object.entries(fields)) {
    if (f.merchantId) continue
    const hit = matchMerchant(f.merchant, saved)
    if (hit) {
      next[id] = { ...f, merchant: hit.name, merchantId: hit.id }
      changed = true
    }
  }
  return changed ? next : fields
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
