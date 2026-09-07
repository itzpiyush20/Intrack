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
    expect(r.body).toEqual({ id: 'sub_1', planType: 'annual' })
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
