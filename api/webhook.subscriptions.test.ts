import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockInsert = vi.fn(() => ({ then: (fn: any) => fn({ error: null }) }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: () => ({ insert: mockInsert }) }),
}))
vi.mock('./_lib/razorpaySignature.js', () => ({
  verifyHmacSignature: () => true,
  planDurationDays: (p: string) => (p === 'annual' ? 365 : 30),
}))

const { default: handler } = await import('./webhook.js')

function reqWith(event: any) {
  const body = JSON.stringify(event)
  return {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'sig' },
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(body) },
  } as any
}

function res() {
  const r: any = { statusCode: 0, body: null }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RAZORPAY_PLAN_MONTHLY = 'plan_mon'
  process.env.RAZORPAY_PLAN_ANNUAL = 'plan_ann'
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
})

describe('webhook — subscription events', () => {
  const charged = {
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: 'sub_1', plan_id: 'plan_ann', notes: { userId: 'user-1' } } },
      payment: { entity: { invoice_id: 'inv_1', amount: 36500 } },
    },
  }

  it('extends access through apply_subscription_charge', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'charged' }, error: null })
    const r = res()
    await handler(reqWith(charged), r)
    expect(mockRpc).toHaveBeenCalledWith('apply_subscription_charge', {
      p_user_id: 'user-1',
      p_subscription_id: 'sub_1',
      p_invoice_id: 'inv_1',
      p_plan_type: 'annual',
      p_duration_days: 365,
      p_amount_inr: 365,
    })
    expect(r.statusCode).toBe(200)
  })

  it('ignores a charge whose plan id is not one of ours rather than guessing', async () => {
    const unknown = JSON.parse(JSON.stringify(charged))
    unknown.payload.subscription.entity.plan_id = 'plan_someone_else'
    const r = res()
    await handler(reqWith(unknown), r)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(r.statusCode).toBe(200)
    expect(r.body.status).toBe('ignored_unknown_plan')
  })

  it('ignores a charge with no userId in notes', async () => {
    const orphan = JSON.parse(JSON.stringify(charged))
    orphan.payload.subscription.entity.notes = {}
    const r = res()
    await handler(reqWith(orphan), r)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(r.body.status).toBe('ignored_missing_notes')
  })

  it('clears the stored subscription id on cancellation but leaves access alone', async () => {
    const cancelled = {
      event: 'subscription.cancelled',
      payload: { subscription: { entity: { id: 'sub_1', notes: { userId: 'user-1' } } } },
    }
    mockRpc.mockResolvedValue({ data: true, error: null })
    const r = res()
    await handler(reqWith(cancelled), r)
    expect(mockRpc).toHaveBeenCalledWith('clear_subscription_link', {
      p_user_id: 'user-1',
      p_subscription_id: 'sub_1',
    })
    expect(r.statusCode).toBe(200)
  })
})
