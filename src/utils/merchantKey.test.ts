import { describe, it, expect } from 'vitest'
import { merchantKey, matchMerchant, filterMerchants, preselectMerchants, withLearnedAlias, type MerchantOption } from './merchantKey'

const m = (id: string, name: string, aliases: string[] = []): MerchantOption => ({
  id,
  name,
  default_category: null,
  aliases,
})

describe('merchantKey', () => {
  it('lower-cases, trims and collapses spaces — same rule as name_key in 048', () => {
    expect(merchantKey('  Sharma   Kirana ')).toBe('sharma kirana')
  })
  it('treats null and blank as empty', () => {
    expect(merchantKey(null)).toBe('')
    expect(merchantKey('   ')).toBe('')
  })
  it('collapses tabs and newlines too', () => {
    expect(merchantKey('Swiggy\t\nBLR')).toBe('swiggy blr')
  })
  it('treats no-break space and a byte-order mark as whitespace, like the SQL class', () => {
    expect(merchantKey('\u00a0Swiggy\u00a0\u00a0BLR\ufeff')).toBe('swiggy blr')
  })
  it('gives an empty key for a name of only tabs — the database rejects it', () => {
    expect(merchantKey('\t\t')).toBe('')
  })
})

describe('matchMerchant', () => {
  const list = [m('1', 'Swiggy', ['swiggy blr', 'swiggy order']), m('2', 'Amazon')]

  it('matches the name regardless of case and spacing', () => {
    expect(matchMerchant(' AMAZON ', list)?.id).toBe('2')
  })
  it('matches a saved alias', () => {
    expect(matchMerchant('SWIGGY  BLR', list)?.id).toBe('1')
  })
  it('does not match a mere substring', () => {
    expect(matchMerchant('Swiggy Instamart', list)).toBeNull()
  })
  it('returns null for empty text', () => {
    expect(matchMerchant('', list)).toBeNull()
  })
})

describe('filterMerchants', () => {
  const list = [
    m('1', 'Zepto'),
    m('2', 'Amazon'),
    m('3', 'Big Bazaar', ['bb store']),
    m('4', 'Amazon Pay'),
    m('5', 'Nazara'),
  ]

  it('returns everything alphabetically for an empty query, capped by limit', () => {
    expect(filterMerchants('', list, 3).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay', 'Big Bazaar'])
  })
  it('puts name prefix matches before substring matches', () => {
    expect(filterMerchants('az', list).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay', 'Big Bazaar', 'Nazara'])
    expect(filterMerchants('ama', list).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay'])
  })
  it('finds a merchant through an alias', () => {
    expect(filterMerchants('bb st', list).map((x) => x.name)).toEqual(['Big Bazaar'])
  })
})

describe('preselectMerchants', () => {
  const saved = [m('m1', 'Swiggy', ['swiggy*blr']), m('m2', 'Zomato')]
  type F = { merchant: string; merchantId: string | null; category: string }

  it('leaves an already-linked entry unchanged', () => {
    const fields: Record<string, F> = { a: { merchant: 'Swiggy', merchantId: 'other', category: 'Food' } }
    const out = preselectMerchants(fields, saved)
    expect(out).toBe(fields)
    expect(out.a.merchantId).toBe('other')
  })

  it('leaves empty text unchanged', () => {
    const fields: Record<string, F> = { a: { merchant: '  ', merchantId: null, category: 'Food' } }
    expect(preselectMerchants(fields, saved)).toBe(fields)
  })

  it('leaves non-matching text unchanged, including substrings', () => {
    const fields: Record<string, F> = { a: { merchant: 'Swig', merchantId: null, category: 'Food' } }
    expect(preselectMerchants(fields, saved)).toBe(fields)
  })

  it('links an alias hit and uses the saved name', () => {
    const fields: Record<string, F> = { a: { merchant: 'SWIGGY*BLR', merchantId: null, category: 'Food' } }
    const out = preselectMerchants(fields, saved)
    expect(out.a).toEqual({ merchant: 'Swiggy', merchantId: 'm1', category: 'Food' })
  })

  it('returns the identical object when nothing changed', () => {
    const fields: Record<string, F> = { a: { merchant: 'Uber', merchantId: null, category: 'Travel' } }
    expect(preselectMerchants(fields, saved)).toBe(fields)
    expect(preselectMerchants(fields, [])).toBe(fields)
  })

  it('changes only the matching entry; others keep identity', () => {
    const a: F = { merchant: 'Uber', merchantId: null, category: 'Travel' }
    const b: F = { merchant: 'zomato', merchantId: null, category: 'Food' }
    const c: F = { merchant: 'Swiggy', merchantId: 'm1', category: 'Food' }
    const fields = { a, b, c }
    const out = preselectMerchants(fields, saved)
    expect(out).not.toBe(fields)
    expect(out.a).toBe(a)
    expect(out.c).toBe(c)
    expect(out.b).toEqual({ merchant: 'Zomato', merchantId: 'm2', category: 'Food' })
    expect(fields.b.merchantId).toBeNull()
  })
})

describe('withLearnedAlias', () => {
  const list = [m('m1', 'Swiggy', ['swiggy*blr']), m('m2', 'Zomato')]

  it('returns the same array for empty text', () => {
    expect(withLearnedAlias(list, 'm1', '')).toBe(list)
    expect(withLearnedAlias(list, 'm1', '   ')).toBe(list)
    expect(withLearnedAlias(list, 'm1', null)).toBe(list)
    expect(withLearnedAlias(list, 'm1', undefined)).toBe(list)
  })

  it('returns the same array for an unknown merchant id', () => {
    expect(withLearnedAlias(list, 'nope', 'SWIGGY BANGALORE')).toBe(list)
  })

  it('returns the same array when the text is the name', () => {
    expect(withLearnedAlias(list, 'm1', '  SWIGGY ')).toBe(list)
  })

  it('returns the same array when the text is already an alias', () => {
    expect(withLearnedAlias(list, 'm1', 'Swiggy*BLR')).toBe(list)
  })

  it('adds the normalised key to that merchant only, without mutating', () => {
    const out = withLearnedAlias(list, 'm1', '  SWIGGY   Bangalore ')
    expect(out).not.toBe(list)
    expect(out[0]).toEqual({ ...list[0], aliases: ['swiggy*blr', 'swiggy bangalore'] })
    expect(out[1]).toBe(list[1])
    expect(list[0].aliases).toEqual(['swiggy*blr'])
  })
})
