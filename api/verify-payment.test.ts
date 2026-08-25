// ============================================================
// verify-payment — the order's notes are the source of truth.
//
// A Razorpay signature covers `order_id|payment_id` and nothing else. It proves
// the pair is genuine; it does NOT say who paid, or which plan they paid for.
// Both of those live in the order's notes, written server-side by
// create-order.ts, and both must be re-read here.
//
// The plan half of that was missing: `planType` came straight from the request
// body and set the subscription length, while the AMOUNT had already been fixed
// when the order was created. So a real ₹31 monthly payment could be verified a
// second time with planType:'annual' and buy 365 days. The signature stays valid
// throughout, because nothing in it binds the plan.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const KEY_SECRET = 'test_key_secret'

const { mockFetch, mockPaymentFetch, mockGetUser, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPaymentFetch: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    orders = { fetch: mockFetch }
    payments = { fetch: mockPaymentFetch }
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  }),
}))

import handler from './verify-payment.js'

/** A genuine signature for this order/payment pair — the attacker has one of these. */
function sign(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex')
}

function makeReq(planType: string): VercelRequest {
  return {
    method: 'POST',
    headers: {
      origin: 'https://www.intrack.co.in',
      authorization: 'Bearer mock-valid-jwt',
      // Distinct per test so the module-level IP rate limiter (5/min) cannot
      // leak between cases and turn a real assertion into a 429.
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: {
      razorpay_order_id: 'order_monthly_1',
      razorpay_payment_id: 'pay_1',
      razorpay_signature: sign('order_monthly_1', 'pay_1'),
      planType,
    },
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
 * A stand-in for the profile row, plus a fake apply_plan_purchase() (supabase/035+)
 * that behaves as the SQL does.
 *
 * The endpoint no longer computes an expiry date at all — it calls the RPC and
 * reports back whatever the database says. So the two things worth asserting
 * are what it ASKS for (plan, duration, order id) and what the row ends up
 * holding, which is why the fake models the row rather than just recording
 * arguments.
 *
 * The fake reproduces exactly the two properties the SQL exists to provide:
 *   * extension from GREATEST(now(), current expiry), not from now(); and
 *   * one period per order id, however many times the order is delivered.
 *
 * It always resolves with an `activated`-shaped JSONB result (or
 * `already_applied` on a repeat delivery of the same order) — the real
 * function's other outcomes (`queued`, `queue_extended`) are exercised by
 * dedicated tests below that stub the RPC directly, since they don't fit
 * this "grant and extend" model.
 *
 * `profile` starts with no expiry and no order, i.e. a fresh account, and is
 * overridable for the renewal cases.
 */
function captureGrant(profile: { expires_at: string | null; order_id: string | null } = { expires_at: null, order_id: null }) {
  const captured: { calls: any[]; profile: typeof profile } = { calls: [], profile }

  mockRpc.mockImplementation((fn: string, args: any) => {
    if (fn !== 'apply_plan_purchase') return Promise.resolve({ data: null, error: null })
    captured.calls.push(args)

    // Idempotent per order: this order is already on the row, so nothing moves.
    if (args.p_order_id && profile.order_id === args.p_order_id) {
      return Promise.resolve({
        data: {
          outcome: 'already_applied',
          expires_at: profile.expires_at,
          pending_plan_type: null,
          pending_activates_at: null,
        },
        error: null,
      })
    }

    const current = profile.expires_at ? new Date(profile.expires_at).getTime() : 0
    const from = Math.max(Date.now(), current)
    profile.expires_at = new Date(from + args.p_duration_days * 86_400_000).toISOString()
    profile.order_id = args.p_order_id ?? profile.order_id
    return Promise.resolve({
      data: {
        outcome: 'activated',
        expires_at: profile.expires_at,
        pending_plan_type: null,
        pending_activates_at: null,
      },
      error: null,
    })
  })

  // payments — fire-and-forget bookkeeping, resolves to a thenable
  mockFrom.mockImplementation(() => ({ insert: () => Promise.resolve({ error: null }) }))

  return captured
}

/** Days between now and an ISO timestamp, rounded — what the customer actually got. */
function daysFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

describe('api/verify-payment — plan binding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://www.intrack.co.in'
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    // The order as Razorpay holds it: a PAID MONTHLY order for user-1.
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'paid',
      notes: { userId: 'user-1', planType: 'monthly' },
    })
  })

  it('refuses a monthly order re-submitted as annual, even with a valid signature', async () => {
    const captured = captureGrant()
    const { res, out } = makeRes()

    await handler(makeReq('annual'), res)

    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/different plan/i)
    // The decisive assertion: no subscription was granted at all.
    expect(captured.calls).toHaveLength(0)
  })

  it('accepts the plan the order was actually created for, and grants 30 days', async () => {
    const captured = captureGrant()
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(200)
    expect(captured.calls[0].p_plan_type).toBe('monthly')
    expect(captured.calls[0].p_duration_days).toBe(30)
    expect(daysFromNow(captured.profile.expires_at!)).toBe(30)
    expect(daysFromNow(out.body.expiresAt)).toBe(30)
  })

  it('refuses when neither the order nor the payment shows money moving', async () => {
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'created',
      notes: { userId: 'user-1', planType: 'monthly' },
    })
    mockPaymentFetch.mockResolvedValue({ id: 'pay_1', status: 'failed' })
    const captured = captureGrant()
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/not completed/i)
    expect(captured.calls).toHaveLength(0)
  })

  // A Razorpay account set to MANUAL capture leaves a genuine payment
  // `authorized` and the order `attempted`. A strict order.status === 'paid'
  // check would reject that real customer after their money had already left.
  it('accepts a manual-capture payment where the order is not yet marked paid', async () => {
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'attempted',
      notes: { userId: 'user-1', planType: 'monthly' },
    })
    mockPaymentFetch.mockResolvedValue({ id: 'pay_1', status: 'authorized' })
    const captured = captureGrant()
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(200)
    expect(captured.calls[0].p_plan_type).toBe('monthly')
  })

  it('still refuses an order belonging to a different account', async () => {
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'paid',
      notes: { userId: 'someone-else', planType: 'monthly' },
    })
    const captured = captureGrant()
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(403)
    expect(captured.calls).toHaveLength(0)
  })
})

// ============================================================
// Renewing must ADD time, and one payment must buy exactly one period.
//
// The endpoint used to write `now() + durationDays` as an absolute date, so a
// customer with two months left who bought a year got 365 days from that day
// and lost the two months they had already paid for — the earlier you renewed,
// the more you lost.
//
// The fix (supabase/035) extends from GREATEST(now(), current expiry) instead,
// which is only safe because the same order cannot be credited twice: this
// endpoint and webhook.ts BOTH fire for one order, and Razorpay retries
// webhooks. While both wrote the same absolute date the duplicate was a no-op;
// additive, every delivery would have been another free period.
// ============================================================
describe('api/verify-payment — renewal extends, and only once per order', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://www.intrack.co.in'
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'paid',
      notes: { userId: 'user-1', planType: 'monthly' },
    })
  })

  it('adds to the time an early renewer has left instead of replacing it', async () => {
    // 60 days still paid for, and no order recorded yet — a genuine early renewal.
    const captured = captureGrant({
      expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      order_id: null,
    })
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(200)
    // 60 remaining + 30 bought. The old behaviour gave 30 and destroyed the 60.
    expect(daysFromNow(captured.profile.expires_at!)).toBe(90)
    expect(daysFromNow(out.body.expiresAt)).toBe(90)
  })

  it('grants one period when the same order is applied twice', async () => {
    const captured = captureGrant()
    const first = makeRes()

    await handler(makeReq('monthly'), first.res)
    expect(first.out.status).toBe(200)
    const afterFirst = captured.profile.expires_at!
    expect(daysFromNow(afterFirst)).toBe(30)

    // The same order arriving again: the webhook after the browser callback, or
    // a Razorpay webhook retry. Same order id, same everything.
    const second = makeRes()
    await handler(makeReq('monthly'), second.res)

    expect(second.out.status).toBe(200)
    expect(captured.calls).toHaveLength(2)
    // Both deliveries reached the RPC — the guard is in the database, not in a
    // JavaScript check that two concurrent callers could both pass — and the
    // expiry did not move for the second one.
    expect(captured.profile.expires_at).toBe(afterFirst)
    expect(second.out.body.expiresAt).toBe(afterFirst)
    expect(daysFromNow(captured.profile.expires_at!)).toBe(30)
  })
})

// ============================================================
// apply_plan_purchase() can hand back an outcome other than "activated" — a
// same-plan renewal or an annual→monthly downgrade is QUEUED to start when
// the current plan ends, not applied immediately. The response has to say
// so, or the UI tells a customer their plan changed when it hasn't.
// ============================================================
describe('api/verify-payment — outcomes other than immediate activation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://www.intrack.co.in'
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockFetch.mockResolvedValue({
      id: 'order_monthly_1',
      amount: 3100,
      status: 'paid',
      notes: { userId: 'user-1', planType: 'monthly' },
    })
    mockFrom.mockImplementation(() => ({ insert: () => Promise.resolve({ error: null }) }))
  })

  it('does not report activation for a queued purchase', async () => {
    // The customer already has an active plan; this payment is queued to
    // start when that one ends. expires_at is the CURRENT plan's expiry,
    // unchanged — the new plan hasn't touched it yet.
    const currentExpiry = new Date(Date.now() + 10 * 86_400_000).toISOString()
    const pendingActivatesAt = currentExpiry
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'queued',
        expires_at: currentExpiry,
        pending_plan_type: 'monthly',
        pending_activates_at: pendingActivatesAt,
      },
      error: null,
    })
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    expect(out.status).toBe(200)
    expect(out.body.outcome).toBe('queued')
    expect(out.body.pendingActivatesAt).not.toBeNull()
    // The regression this guards: a queued purchase must never be described
    // as an activation, or a downgrading customer is told their plan
    // changed when it has not.
    expect(out.body.message).not.toMatch(/activated/i)
  })

  it('treats a NULL result from the RPC as a hard failure, not a silent success', async () => {
    // No profile row matched — apply_plan_purchase() returns SQL NULL.
    mockRpc.mockResolvedValue({ data: null, error: null })
    const { res, out } = makeRes()

    await handler(makeReq('monthly'), res)

    // Reporting 200 here would tell a paying customer their subscription was
    // granted when nothing was written to their profile.
    expect(out.status).not.toBe(200)
  })
})
