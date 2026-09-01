// ============================================================
// redeem-promo — the claim is taken atomically, and never leaks.
//
// Two properties, both about money, both invisible when they break.
//
// 1. A coupon's max_uses must hold under concurrency. used_count used to be
//    READ, compared to max_uses in JavaScript, and then written back as
//    `read + 1` as fire-and-forget bookkeeping AFTER the plan was granted. Two
//    people redeeming a one-use code at the same moment both read 0, both
//    passed the check, and both got a plan. UNIQUE (code, user_id) never
//    covered this: it stops ONE account redeeming twice, not TWO racing.
//    claim_promo_use() (supabase/040) decides it in one UPDATE.
//
// 2. A failed redemption must not poison the account. The endpoint claims a
//    promo_redemptions row BEFORE granting, and `hasRedeemedAnyCoupon` is
//    checked across EVERY code — so a claim left behind by a failure does not
//    just waste this coupon, it permanently disqualifies the account from all
//    of them, for a coupon the person never received. Every path between the
//    claim and a completed grant has to roll it back.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockGetUser, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  }),
}))

import handler from './redeem-promo.js'

const USER_ID = 'user-1'

function makeReq(code = 'WELCOME'): VercelRequest {
  return {
    method: 'POST',
    headers: {
      origin: 'https://www.intrack.co.in',
      authorization: 'Bearer mock-valid-jwt',
      // Distinct per test so the module-level IP rate limiter (5/min) cannot
      // leak between cases and turn a real assertion into a 429.
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: { code },
  } as unknown as VercelRequest
}

function makeRes() {
  const out = { status: 0, body: null as any }
  const res = {
    setHeader: vi.fn(),
    status: (code: number) => {
      out.status = code
      return { json: (data: any) => { out.body = data }, end: () => {} }
    },
  } as unknown as VercelResponse
  return { res, out }
}

/**
 * A PostgREST-shaped query builder that resolves to `result` however it is
 * chained.
 *
 * Every filter method returns the builder itself, so the fake cannot fall out
 * of step with the real query when a filter is added or reordered. It is also
 * thenable, so `await`-ing the chain at any depth yields `result`.
 */
function chainable(result: unknown) {
  const builder: any = {
    then: (resolve: any) => Promise.resolve(result).then(resolve),
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  }
  for (const method of ['eq', 'select', 'limit', 'order', 'in', 'gt', 'is', 'or', 'neq']) {
    builder[method] = () => builder
  }
  return builder
}

/**
 * Stands in for every table the endpoint touches, and records what it did.
 *
 * `promoRow` is the coupon as the database holds it; `grantFails` makes the
 * profiles UPDATE fail the way a database error would, which is the path the
 * rollback exists for.
 */
function setupTables(options: {
  promoRow?: Record<string, unknown> | null
  grantFails?: 'error' | 'no-row'
} = {}) {
  const promoRow = options.promoRow === undefined
    ? { code: 'WELCOME', plan_type: 'monthly', duration_days: 30, active: true, max_uses: 1, used_count: 0, expires_at: null }
    : options.promoRow

  const record = {
    redemptionsInserted: 0,
    redemptionsDeleted: 0,
    profileUpdated: 0,
    paymentsInserted: 0,
  }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'promo_codes') {
      return { select: () => chainable({ data: promoRow, error: null }) }
    }

    if (table === 'promo_redemptions') {
      return {
        // No prior redemptions: a first-time, eligible account.
        select: () => chainable({ data: [], error: null }),
        insert: () => {
          record.redemptionsInserted++
          return Promise.resolve({ error: null })
        },
        delete: () => ({
          eq: () => ({
            eq: () => {
              record.redemptionsDeleted++
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }
    }

    if (table === 'payments') {
      return {
        // Never paid before, so the account is coupon-eligible.
        //
        // Chainable rather than a fixed nest of eq(): the real query filters on
        // user_id, source AND status, and a hand-built nest silently breaks the
        // moment a filter is added — which is exactly how the first draft of
        // this file failed.
        select: () => chainable({ data: [], error: null }),
        insert: () => {
          record.paymentsInserted++
          return { then: (fn: any) => Promise.resolve(fn({ error: null })) }
        },
      }
    }

    if (table === 'profiles') {
      return {
        update: () => ({
          eq: () => ({
            select: () => {
              record.profileUpdated++
              if (options.grantFails === 'error') {
                return Promise.resolve({ data: null, error: { message: 'db down' } })
              }
              if (options.grantFails === 'no-row') {
                return Promise.resolve({ data: [], error: null })
              }
              return Promise.resolve({ data: [{ id: USER_ID }], error: null })
            },
          }),
        }),
      }
    }

    throw new Error(`unexpected table ${table}`)
  })

  return record
}

/** claim_promo_use returns true (the use was taken) unless told otherwise. */
function setupRpc(behaviour: { claimed?: boolean; claimThrows?: boolean } = {}) {
  const calls: string[] = []
  mockRpc.mockImplementation((fn: string) => {
    calls.push(fn)
    if (fn === 'claim_promo_use') {
      if (behaviour.claimThrows) return Promise.resolve({ data: null, error: { message: 'rpc exploded' } })
      return Promise.resolve({ data: behaviour.claimed !== false, error: null })
    }
    if (fn === 'release_promo_use') return Promise.resolve({ data: null, error: null })
    throw new Error(`unexpected rpc ${fn}`)
  })
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
})

describe('redeem-promo — the usage limit is taken atomically', () => {
  it('grants when the code still has a use available', async () => {
    const record = setupTables()
    const rpcCalls = setupRpc({ claimed: true })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(200)
    expect(out.body.success).toBe(true)
    expect(out.body.durationDays).toBe(30)
    expect(record.profileUpdated).toBe(1)
    // The count is taken through the RPC, never by writing back a value read
    // earlier in JavaScript.
    expect(rpcCalls).toContain('claim_promo_use')
  })

  it('takes the count BEFORE granting, not after', async () => {
    // Ordering is the whole fix. Incrementing after the grant is what let a
    // second racing redemption slip through while the first was still working.
    const order: string[] = []
    setupTables()
    mockFrom.mockImplementation(((original) => (table: string) => {
      const built = original(table)
      if (table === 'profiles') {
        return {
          update: () => ({
            eq: () => ({
              select: () => {
                order.push('grant')
                return Promise.resolve({ data: [{ id: USER_ID }], error: null })
              },
            }),
          }),
        }
      }
      return built
    })(mockFrom.getMockImplementation()!))

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'claim_promo_use') {
        order.push('claim')
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const { res } = makeRes()
    await handler(makeReq(), res)

    expect(order).toEqual(['claim', 'grant'])
  })

  it('refuses the redemption that loses the race, and grants nothing', async () => {
    // The second of two simultaneous redemptions of a one-use code. The row
    // still reads used_count 0 in this request's snapshot, so only the
    // database-side check can catch it.
    const record = setupTables()
    setupRpc({ claimed: false })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/usage limit/i)
    // Nothing was granted...
    expect(record.profileUpdated).toBe(0)
    // ...and the account is not left holding a claim for a coupon it never got.
    expect(record.redemptionsDeleted).toBe(1)
  })
})

describe('redeem-promo — a failed redemption never poisons the account', () => {
  it('releases the claim when the usage RPC itself fails', async () => {
    const record = setupTables()
    setupRpc({ claimThrows: true })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(500)
    expect(record.profileUpdated).toBe(0)
    // Without this the account carries a promo_redemptions row forever, and
    // hasRedeemedAnyCoupon then refuses EVERY future coupon.
    expect(record.redemptionsDeleted).toBe(1)
  })

  it('releases both the claim and the use when the grant errors', async () => {
    const record = setupTables({ grantFails: 'error' })
    const rpcCalls = setupRpc({ claimed: true })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(500)
    expect(record.redemptionsDeleted).toBe(1)
    // The use was taken before the grant failed, so a limited code must get it
    // back — otherwise a one-use coupon is retired by a redemption that never
    // happened.
    expect(rpcCalls).toContain('release_promo_use')
  })

  it('releases both when no profile row matches', async () => {
    const record = setupTables({ grantFails: 'no-row' })
    const rpcCalls = setupRpc({ claimed: true })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(500)
    expect(record.redemptionsDeleted).toBe(1)
    expect(rpcCalls).toContain('release_promo_use')
  })

  it('does NOT roll back once the plan is granted', async () => {
    // Past the grant the person has their access. Releasing the claim here
    // would let the same account redeem a second coupon on top of it.
    const record = setupTables()
    setupRpc({ claimed: true })

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(200)
    expect(record.redemptionsDeleted).toBe(0)
    expect(record.paymentsInserted).toBe(1)
  })
})

describe('redeem-promo — cheap refusals still cost nothing', () => {
  it('refuses an unknown code without claiming anything', async () => {
    const record = setupTables({ promoRow: null })
    const rpcCalls = setupRpc()

    const { res, out } = makeRes()
    await handler(makeReq('NOSUCHCODE'), res)

    expect(out.status).toBe(400)
    expect(record.redemptionsInserted).toBe(0)
    expect(rpcCalls).not.toContain('claim_promo_use')
  })

  it('refuses an exhausted code without touching the database', async () => {
    // The in-JS check is kept as a fast path: in the uncontended case, which is
    // essentially all of them, an exhausted code is refused with no writes.
    const record = setupTables({
      promoRow: { code: 'WELCOME', plan_type: 'monthly', duration_days: 30, active: true, max_uses: 1, used_count: 1, expires_at: null },
    })
    const rpcCalls = setupRpc()

    const { res, out } = makeRes()
    await handler(makeReq(), res)

    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/usage limit/i)
    expect(record.redemptionsInserted).toBe(0)
    expect(rpcCalls).not.toContain('claim_promo_use')
  })
})
