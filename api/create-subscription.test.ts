import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockCreate, mockGetUser, mockMaybeSingle } = vi.hoisted(() => {
  return {
    mockCreate: vi.fn(),
    mockGetUser: vi.fn(),
    mockMaybeSingle: vi.fn(),
  }
})

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    subscriptions = { create: mockCreate }
  },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

import handler from './create-subscription.js'

interface FakeResponse {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  setHeader: (k: string, v: string) => void
  status: (c: number) => FakeResponse
  json: (b: unknown) => FakeResponse
  end: () => FakeResponse
}

function res(): FakeResponse {
  const r = { statusCode: 0, body: null, headers: {} } as FakeResponse
  r.setHeader = (k: string, v: string) => { r.headers[k] = v }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: unknown) => { r.body = b; return r }
  r.end = () => r
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RAZORPAY_PLAN_MONTHLY = 'plan_mon'
  process.env.RAZORPAY_PLAN_ANNUAL = 'plan_ann'
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: null } })
})

describe('create-subscription', () => {
  it('rejects an unauthenticated caller', async () => {
    const r = res()
    await handler(
      { method: 'POST', headers: {}, body: { planType: 'monthly' } } as unknown as VercelRequest,
      r as unknown as VercelResponse,
    )
    expect(r.statusCode).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown plan type before calling Razorpay', async () => {
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'lifetime' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)
    expect(r.statusCode).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a subscription on the configured plan and tags it with the user id', async () => {
    mockCreate.mockResolvedValue({ id: 'sub_1', status: 'created' })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'annual' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan_ann',
      total_count: expect.any(Number),
      customer_notify: 1,
      notes: { userId: 'user-1', planType: 'annual' },
    }))
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ id: 'sub_1', planType: 'annual', startsAt: null })
  })

  it('starts immediately, with no start_at, for a customer holding no paid time', async () => {
    mockCreate.mockResolvedValue({ id: 'sub_1', status: 'created' })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'monthly' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ start_at: expect.anything() }),
    )
  })

  it('schedules the first charge at expiry for a customer who still has paid days left', async () => {
    // The returning-customer case: they cancelled, kept 20 days, and came back.
    // Charging today would bill them for days they already own.
    const expiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString()
    mockMaybeSingle.mockResolvedValue({
      data: { razorpay_subscription_id: null, subscription_expires_at: expiry },
    })
    mockCreate.mockResolvedValue({ id: 'sub_2', status: 'created' })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'monthly' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)

    const expected = Math.floor(Date.parse(expiry) / 1000)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ start_at: expected }),
    )
    expect(r.body).toEqual({ id: 'sub_2', planType: 'monthly', startsAt: expected })
  })

  it('starts immediately for a customer whose access already lapsed', async () => {
    const expiry = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    mockMaybeSingle.mockResolvedValue({
      data: { razorpay_subscription_id: null, subscription_expires_at: expiry },
    })
    mockCreate.mockResolvedValue({ id: 'sub_3', status: 'created' })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'monthly' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ start_at: expect.anything() }),
    )
    expect(r.body).toEqual({ id: 'sub_3', planType: 'monthly', startsAt: null })
  })

  it('refuses to create a second subscription while one is already active', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: 'sub_existing' } })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'monthly' },
    } as unknown as VercelRequest, r as unknown as VercelResponse)
    expect(r.statusCode).toBe(409)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
