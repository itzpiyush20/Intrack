// ============================================
// Learning Engine V2 — Supabase-Synced
// Merchant rules stored in DB, not just localStorage.
// Uses canonical merchant names for cross-variant learning.
// ============================================

import { supabase } from './supabase.js'
import { cleanMerchantName, getMerchantWeights, getMerchantSettings, applyMerchantRules } from './emailScanner.js'
import { normalizeMerchant, getMerchantKey } from './merchantNormalizer.js'
import type { RuleMatchResult } from './emailScanner.js'
import type { SupabaseClient } from '@supabase/supabase-js'

type CardBrand = 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners'

export type MerchantRuleRow = {
  id: string
  user_id: string
  merchant_key: string
  canonical_name: string
  preferred_category: string
  card_brand: CardBrand | null
  auto_approve: boolean
  confidence: number
  times_confirmed: number
  last_updated: string
  created_at: string
  rule_type: string
}

/**
 * The merchant rules, plus whether the read actually succeeded.
 *
 * `ok: false` means the request failed; `ok: true` with an empty array means
 * the account genuinely has no rules. getMerchantRulesFromDB below collapses
 * those two into `[]`, which is right for the scanner — a rules read that
 * fails must degrade to "no rules matched", never fail the scan — but wrong
 * for any caller that has to decide between showing nothing and falling back
 * to a cached copy. SettingsPage needs that distinction: keyed off the empty
 * array alone, deleting your last rule looked identical to a failed read and
 * repopulated the list from stale localStorage.
 */
export async function fetchMerchantRules(
  userId: string,
  db: SupabaseClient = supabase
): Promise<{ rules: MerchantRuleRow[]; ok: boolean }> {
  const { data, error } = await db
    .from('merchant_rules')
    .select('*')
    .eq('user_id', userId)
    .order('times_confirmed', { ascending: false })

  if (error) {
    console.warn('[LearningEngine] Failed to fetch merchant rules:', error.message)
    return { rules: [], ok: false }
  }
  return { rules: (data || []) as MerchantRuleRow[], ok: true }
}

/**
 * The merchant rules, or an empty list if they could not be read.
 *
 * The swallow is deliberate and load-bearing for the scanner (see
 * emailScanner.ts): a failed rules read must cost the scan its rules, not the
 * scan itself. Callers that need to tell empty from failed use
 * fetchMerchantRules above.
 */
export async function getMerchantRulesFromDB(userId: string, db: SupabaseClient = supabase): Promise<MerchantRuleRow[]> {
  const { rules } = await fetchMerchantRules(userId, db)
  return rules
}

export async function saveMerchantRuleToDb(
  userId: string,
  merchant: string,
  category: string,
  autoApprove = true,
  cardBrand?: CardBrand | null,
  ruleType?: 'income' | 'expense'
): Promise<void> {
  const normalized = normalizeMerchant(merchant)
  const canonicalName = normalized.canonical || cleanMerchantName(merchant)
  const merchantKey = getMerchantKey(canonicalName) || cleanMerchantName(merchant).toLowerCase().trim()

  if (!merchantKey || merchantKey.length <= 2) return

  const { data: existing } = await supabase
    .from('merchant_rules')
    .select('id, times_confirmed, card_brand')
    .eq('user_id', userId)
    .eq('merchant_key', merchantKey)
    .maybeSingle()

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      preferred_category: category,
      auto_approve: autoApprove,
      times_confirmed: existing.times_confirmed + 1,
      confidence: 100,
      canonical_name: canonicalName,
      last_updated: new Date().toISOString(),
    }
    // Only update card_brand if a new value is explicitly provided
    if (cardBrand !== undefined) {
      updatePayload.card_brand = cardBrand
    }
    // Only update rule_type if a new value is explicitly provided — avoids
    // clobbering an existing rule's type when a caller (e.g. the Pending-page
    // "Create rule" banner) doesn't pass one.
    if (ruleType !== undefined) {
      updatePayload.rule_type = ruleType
    }

    await supabase.from('merchant_rules').update(updatePayload).eq('id', existing.id)
  } else {
    await supabase.from('merchant_rules').insert({
      user_id: userId,
      merchant_key: merchantKey,
      canonical_name: canonicalName,
      preferred_category: category,
      card_brand: cardBrand ?? null,
      auto_approve: autoApprove,
      confidence: 100,
      times_confirmed: 1,
      rule_type: ruleType ?? 'expense',
    })
  }
}

export async function migrateLocalStorageRulesToDB(userId: string): Promise<{ migrated: number }> {
  const migrationDoneKey = 'intrack_ls_migration_done'
  try {
    if (sessionStorage.getItem(migrationDoneKey)) return { migrated: 0 }
  } catch {
    return { migrated: 0 }
  }

  const weights = getMerchantWeights()
  const settings = getMerchantSettings()
  const entries = Object.entries(weights)
  if (entries.length === 0) return { migrated: 0 }

  let migrated = 0

  for (const [rawKey, catMap] of entries) {
    let bestCategory = 'other'
    let maxCount = 0
    let totalCount = 0

    for (const [cat, count] of Object.entries(catMap)) {
      totalCount += count
      if (count > maxCount) {
        maxCount = count
        bestCategory = cat
      }
    }

    const autoApprove = settings[rawKey]?.autoApprove !== false
    const confidence = Math.min(100, Math.round((maxCount / Math.max(1, totalCount)) * 100))

    // Normalize the key from localStorage to canonical form
    const normalized = normalizeMerchant(rawKey)
    const canonicalName = normalized.isKnown ? normalized.canonical : rawKey
    const merchantKey = getMerchantKey(canonicalName) || rawKey

    const { error } = await supabase.from('merchant_rules').upsert(
      {
        user_id: userId,
        merchant_key: merchantKey,
        canonical_name: canonicalName,
        preferred_category: bestCategory,
        auto_approve: autoApprove,
        confidence,
        times_confirmed: totalCount,
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'user_id,merchant_key' }
    )

    if (!error) migrated++
  }

  try {
    sessionStorage.setItem(migrationDoneKey, '1')
  } catch {}

  return { migrated }
}

/**
 * Pure matching half of `applyMerchantRulesFromDB` — takes rules already in
 * memory instead of fetching them.
 *
 * Exists so a scan can fetch the user's rules ONCE and reuse them across every
 * email, rather than re-reading the whole `merchant_rules` table per email as
 * the DB-fetching wrapper does. Behaviour is otherwise identical, including the
 * localStorage fallback when nothing matches.
 */
/**
 * Merchant keys that clear the 5-character floor but are ordinary English, so
 * matching them as a substring of raw email text pairs a learned rule with
 * completely unrelated merchants. Disqualifies a key from the partial-match
 * arm only; an exact key match is still honoured.
 */
const GENERIC_MERCHANT_WORDS = new Set([
  'store', 'stores', 'market', 'mobile', 'online', 'payment', 'payments',
  'service', 'services', 'center', 'centre', 'india', 'digital', 'retail',
  'shopping', 'recharge', 'account', 'transfer', 'transaction',
])

export function applyMerchantRulesFromRows(
  rules: MerchantRuleRow[],
  merchant: string,
  snippet: string,
  defaultCategory: string
): RuleMatchResult {
  // Normalize the merchant to canonical form for consistent lookup
  const normalized = normalizeMerchant(merchant)
  const canonicalName = normalized.isKnown ? normalized.canonical : cleanMerchantName(merchant)
  const merchantKey = getMerchantKey(canonicalName) || cleanMerchantName(merchant).toLowerCase().trim()

  // Exact key match
  const exactMatch = rules.find((r) => r.merchant_key === merchantKey)
  if (exactMatch) {
    // Rule confidence never auto-approves — approval always requires explicit
    // human review, regardless of confidence/auto_approve/times_confirmed.
    return {
      category: exactMatch.preferred_category,
      approval_status: 'pending',
      confidence: exactMatch.confidence,
      matchReason: `DB rule: '${exactMatch.merchant_key}' (${exactMatch.confidence}% confidence, ${exactMatch.times_confirmed} confirmations)`,
    }
  }

  // Exact matches above are unaffected — a rule keyed "store" still applies to
  // a merchant that normalises to exactly "store". This list only disqualifies
  // a key from the fuzzy substring arm below.

  // Partial match — only for keys with 5+ chars to prevent "jio", "air", "pay" etc.
  // from false-matching against unrelated emails
  const lowerSnippet = snippet.toLowerCase().substring(0, 300)
  for (const rule of rules) {
    if (rule.merchant_key.length < 5) continue
    // The length floor alone is not enough: plenty of ordinary English words
    // clear five characters. A rule learned from a merchant literally named
    // "Store" matched any snippet containing "App Store subscription" or
    // "grocery store" — the snippet arm below searches raw email text, so the
    // blast radius is every future email, not just similarly-named merchants.
    if (GENERIC_MERCHANT_WORDS.has(rule.merchant_key)) continue
    if (merchantKey.includes(rule.merchant_key) || lowerSnippet.includes(rule.merchant_key)) {
      // Same as exact match above — never auto-approve, always pending review.
      return {
        category: rule.preferred_category,
        approval_status: 'pending',
        confidence: Math.round(rule.confidence * 0.8),
        matchReason: `DB partial rule: '${rule.merchant_key}' (partial match)`,
      }
    }
  }

  // Fallback to localStorage-based rules
  return applyMerchantRules(merchant, snippet, defaultCategory)
}

export async function applyMerchantRulesFromDB(
  userId: string,
  merchant: string,
  snippet: string,
  defaultCategory: string,
  db: SupabaseClient = supabase
): Promise<RuleMatchResult> {
  let rules: MerchantRuleRow[] = []
  try {
    rules = await getMerchantRulesFromDB(userId, db)
  } catch (err) {
    // Unreachable in practice (getMerchantRulesFromDB swallows its own errors
    // and returns []), but kept so a future change there can't turn a DB
    // outage into a failed scan. Empty rules degrade to localStorage below.
    console.warn('[LearningEngine] DB lookup failed, falling back to localStorage:', err)
  }
  return applyMerchantRulesFromRows(rules, merchant, snippet, defaultCategory)
}
