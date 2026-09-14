import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each call to supabase.from(table) takes the next scripted response for that
// table. Every builder method returns the same chain; awaiting the chain (or
// calling .single()) resolves the scripted value.
const script: Record<string, Array<{ data: unknown; error: unknown }>> = {}
const inserts: Array<{ table: string; row: unknown }> = []
/** Tables whose next `insert()` call should throw synchronously, like a real client failure. */
const throwOnInsert = new Set<string>()

interface Chain {
  select: () => Chain
  eq: () => Chain
  order: () => Chain
  range: () => Chain
  insert: (row: unknown) => Chain
  single: () => Promise<{ data: unknown; error: unknown }>
  then: (
    resolve: (v: { data: unknown; error: unknown }) => unknown,
    reject: (e: unknown) => unknown
  ) => Promise<unknown>
}

function chainFor(table: string): Chain {
  const next = () => (script[table] ?? []).shift() ?? { data: null, error: null }
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => chain,
    insert: (row: unknown) => {
      if (throwOnInsert.has(table)) throw new Error('client boom')
      inserts.push({ table, row })
      return chain
    },
    single: () => Promise.resolve(next()),
    then: (resolve, reject) => Promise.resolve(next()).then(resolve, reject),
  }
  return chain
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => chainFor(table) },
}))

import { listMerchants, createMerchant, addMerchantAlias } from './merchants'

beforeEach(() => {
  for (const k of Object.keys(script)) delete script[k]
  inserts.length = 0
  throwOnInsert.clear()
})

describe('listMerchants', () => {
  it('joins aliases onto their merchants', async () => {
    script.merchants = [{ data: [{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining' }], error: null }]
    script.merchant_aliases = [{ data: [{ merchant_id: 'm1', alias_key: 'swiggy blr' }], error: null }]

    const { data, error } = await listMerchants()
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: ['swiggy blr'] }])
  })

  it('returns an empty list and the error when the read fails', async () => {
    script.merchants = [{ data: null, error: { message: 'boom' } }]
    const { data, error } = await listMerchants()
    expect(data).toEqual([])
    expect(error).toEqual({ message: 'boom' })
  })

  it('keeps merchants when the alias read fails', async () => {
    script.merchants = [{ data: [{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining' }], error: null }]
    script.merchant_aliases = [{ data: null, error: { message: 'x' } }]

    const { data, error } = await listMerchants()
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: [] }])
  })

  it('reads every page', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `m${i}`,
      name: `Merchant ${i}`,
      default_category: null,
    }))
    const secondPage = [{ id: 'm1000', name: 'Merchant 1000', default_category: null }]
    script.merchants = [
      { data: firstPage, error: null },
      { data: secondPage, error: null },
    ]
    script.merchant_aliases = [{ data: [], error: null }]

    const { data, error } = await listMerchants()
    expect(error).toBeNull()
    expect(data).toHaveLength(1001)
  })
})

describe('createMerchant', () => {
  it('saves a tidied name and returns the new merchant', async () => {
    script.merchants = [{ data: { id: 'm9', name: 'Sharma Kirana', default_category: null }, error: null }]
    const { data } = await createMerchant('u1', '  Sharma   Kirana ', null)
    expect(inserts[0]).toEqual({ table: 'merchants', row: { user_id: 'u1', name: 'Sharma Kirana', default_category: null } })
    expect(data).toEqual({ id: 'm9', name: 'Sharma Kirana', default_category: null, aliases: [] })
  })

  it('returns the existing merchant on a duplicate name instead of failing', async () => {
    script.merchants = [
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: { id: 'm1', name: 'Swiggy', default_category: 'Food & Dining' }, error: null },
    ]
    const { data, error } = await createMerchant('u1', 'swiggy', null)
    expect(error).toBeNull()
    expect(data?.id).toBe('m1')
  })

  it('refuses a blank name without calling the database', async () => {
    const { data, error } = await createMerchant('u1', '   ', null)
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(Error)
    expect(inserts).toHaveLength(0)
  })

  it('stores an empty usual category as null', async () => {
    script.merchants = [{ data: { id: 'm9', name: 'Sharma Kirana', default_category: null }, error: null }]
    await createMerchant('u1', 'Sharma Kirana', '   ')
    expect(inserts[0]).toEqual({
      table: 'merchants',
      row: { user_id: 'u1', name: 'Sharma Kirana', default_category: null },
    })
  })
})

describe('addMerchantAlias', () => {
  const swiggy = { id: 'm1', name: 'Swiggy', default_category: null, aliases: ['swiggy blr'] }

  it('stores a new spelling as a normalised alias', async () => {
    await addMerchantAlias('u1', swiggy, 'SWIGGY  Order')
    expect(inserts).toEqual([{ table: 'merchant_aliases', row: { user_id: 'u1', merchant_id: 'm1', alias_key: 'swiggy order' } }])
  })

  it('skips the name itself and aliases it already has', async () => {
    await addMerchantAlias('u1', swiggy, ' swiggy ')
    await addMerchantAlias('u1', swiggy, 'Swiggy BLR')
    await addMerchantAlias('u1', swiggy, '')
    expect(inserts).toHaveLength(0)
  })

  it('swallows a thrown client error', async () => {
    throwOnInsert.add('merchant_aliases')
    await expect(addMerchantAlias('u1', swiggy, 'New Spelling')).resolves.toBeUndefined()
  })
})
