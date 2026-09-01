import { describe, it, expect, vi, beforeEach } from 'vitest'

const defaultMockOrder = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: defaultMockOrder }) }) }),
  },
}))

import { getMerchantRulesFromDB, fetchMerchantRules, applyMerchantRulesFromDB, applyMerchantRulesFromRows } from './learningEngine'

describe('applyMerchantRulesFromDB', () => {
  it('never returns approval_status "approved", even for a high-confidence, auto_approve, many-times-confirmed exact match', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: 'r1', user_id: 'u1', merchant_key: 'swiggy', canonical_name: 'Swiggy',
        preferred_category: 'food', card_brand: null,
        auto_approve: true, confidence: 100, times_confirmed: 10,
        last_updated: '2026-07-01', created_at: '2026-07-01',
      }],
      error: null,
    })
    const db: any = {
      from: () => ({ select: () => ({ eq: () => ({ order }) }) }),
    }

    const result = await applyMerchantRulesFromDB('u1', 'swiggy', 'Swiggy order snippet', 'other', db)

    expect(result.approval_status).toBe('pending')
    expect(result.category).toBe('food')
  })

  it('never returns approval_status "approved" for a partial match either, even past the old auto-approve threshold', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: 'r2', user_id: 'u1', merchant_key: 'quickmart', canonical_name: 'Quickmart',
        preferred_category: 'shopping', card_brand: null,
        // Old threshold for partial-match auto-approve was confidence >= 80 && times_confirmed >= 2
        auto_approve: true, confidence: 90, times_confirmed: 5,
        last_updated: '2026-07-01', created_at: '2026-07-01',
      }],
      error: null,
    })
    const db: any = {
      from: () => ({ select: () => ({ eq: () => ({ order }) }) }),
    }

    // "quickmart junction" doesn't exactly equal the rule's merchant_key ("quickmart"),
    // so this only matches via the partial-match branch (merchantKey.includes(rule.merchant_key)).
    const result = await applyMerchantRulesFromDB('u1', 'quickmart junction', 'unrelated snippet text', 'other', db)

    expect(result.approval_status).toBe('pending')
    expect(result.category).toBe('shopping')
  })
})

describe('getMerchantRulesFromDB', () => {
  beforeEach(() => {
    defaultMockOrder.mockReset()
    defaultMockOrder.mockResolvedValue({ data: [], error: null })
  })

  it('uses the injected db client instead of the default module client', async () => {
    const customOrder = vi.fn().mockResolvedValue({
      data: [{
        id: 'r1', user_id: 'u1', merchant_key: 'swiggy', canonical_name: 'Swiggy',
        preferred_category: 'food', card_brand: null, auto_approve: true,
        confidence: 90, times_confirmed: 3, last_updated: '2026-07-01', created_at: '2026-07-01',
      }],
      error: null,
    })
    const customDb: any = {
      from: () => ({ select: () => ({ eq: () => ({ order: customOrder }) }) }),
    }

    const rules = await getMerchantRulesFromDB('u1', customDb)

    expect(customOrder).toHaveBeenCalledTimes(1)
    expect(defaultMockOrder).not.toHaveBeenCalled()
    expect(rules).toHaveLength(1)
    expect(rules[0].merchant_key).toBe('swiggy')
  })

  it('falls back to the default module client when none is passed', async () => {
    await getMerchantRulesFromDB('u1')
    expect(defaultMockOrder).toHaveBeenCalledTimes(1)
  })
})

describe('fetchMerchantRules — an empty account is not a failed read', () => {
  // getMerchantRulesFromDB collapses both into [], which is correct for the
  // scanner: a failed rules read must cost the scan its rules, never the scan.
  // But SettingsPage has to choose between showing nothing and falling back to
  // the browser copy, and keyed off the empty array alone it could not tell the
  // two apart — so deleting your last rule looked like a failed read and the
  // list repopulated itself from stale localStorage.
  const dbReturning = (result: unknown) => ({
    from: () => ({ select: () => ({ eq: () => ({ order: vi.fn().mockResolvedValue(result) }) }) }),
  }) as any

  it('reports ok for an account that genuinely has no rules', async () => {
    const { rules, ok } = await fetchMerchantRules('u1', dbReturning({ data: [], error: null }))
    expect(ok).toBe(true)
    expect(rules).toEqual([])
  })

  it('reports NOT ok when the read failed', async () => {
    const { rules, ok } = await fetchMerchantRules('u1', dbReturning({ data: null, error: { message: 'boom' } }))
    expect(ok).toBe(false)
    expect(rules).toEqual([])
  })

  it('getMerchantRulesFromDB still swallows the failure, for the scanner', async () => {
    // Changing this would let a rules outage fail a whole scan.
    const rules = await getMerchantRulesFromDB('u1', dbReturning({ data: null, error: { message: 'boom' } }))
    expect(rules).toEqual([])
  })
})

describe('generic-word merchant rules do not fuzzy-match unrelated mail', () => {
  const rule = (merchant_key: string) => ({
    merchant_key,
    preferred_category: 'Shopping',
    confidence: 100,
    times_confirmed: 5,
    auto_approve: true,
  }) as any

  // Asserted on matchReason, not category: when no rule matches the function
  // falls through to the localStorage matcher, which supplies a category of
  // its own. Only matchReason isolates whether the DB partial rule fired.
  it('does not fuzzy-match a rule keyed "store" against an App Store subscription email', () => {
    const result = applyMerchantRulesFromRows(
      [rule('store')], 'Netflix', 'Your App Store subscription has renewed', 'Other'
    )
    expect(result.matchReason).not.toContain('DB partial rule')
  })

  it('does not fuzzy-match a rule keyed "payment" against an unrelated payment alert', () => {
    const result = applyMerchantRulesFromRows(
      [rule('payment')], 'Zomato', 'Payment of Rs 450 debited', 'Other'
    )
    expect(result.matchReason).not.toContain('DB partial rule')
  })

  it('still fuzzy-matches a distinctive merchant key found in the snippet', () => {
    const result = applyMerchantRulesFromRows(
      [rule('bigbasket')], 'Unknown Vendor', 'Your bigbasket order has shipped', 'Other'
    )
    expect(result.matchReason).toContain('DB partial rule')
    expect(result.category).toBe('Shopping')
    // The never-auto-approve invariant holds regardless of the rule's flag.
    expect(result.approval_status).toBe('pending')
  })

  it('leaves the exact-match arm alone', () => {
    // The guard disqualifies a generic key from the FUZZY arm only. Exercised
    // via a distinctive key here because merchantNormalizer routes a bare
    // generic name like "store" to a template default, so such a name never
    // reaches the exact-key comparison in practice anyway.
    const result = applyMerchantRulesFromRows(
      [rule('swiggy')], 'SWIGGYBANGALORE', 'order delivered', 'Other'
    )
    expect(result.matchReason).toContain('DB rule')
    expect(result.category).toBe('Shopping')
    expect(result.approval_status).toBe('pending')
  })
})
