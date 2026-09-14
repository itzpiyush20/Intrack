import { describe, it, expect } from 'vitest'
import { merchantKey, matchMerchant, filterMerchants, type MerchantOption } from './merchantKey'

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
