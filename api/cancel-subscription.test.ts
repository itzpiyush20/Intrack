import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockCancel, mockGetUser, mockMaybeSingle } = vi.hoisted(() => {
  return {
    mockCancel: vi.fn(),
    mockGetUser: vi.fn(),
    mockMaybeSingle: vi.fn(),
  }
})

vi.mock('razorpay', () => ({
  default: class MockRazorpay {
    subscriptions = { cancel: mockCancel }
  },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

import handler from './cancel-subscription.js'

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
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

describe('cancel-subscription', () => {
  it('cancels at cycle end so paid-for access is not withdrawn early', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: 'sub_1' } })
    mockCancel.mockResolvedValue({ id: 'sub_1', status: 'cancelled' })
    const r = res()
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer t' } } as unknown as VercelRequest,
      r as unknown as VercelResponse,
    )
    expect(mockCancel).toHaveBeenCalledWith('sub_1', true)
    expect(r.statusCode).toBe(200)
  })

  it('returns 404 when the account has no subscription', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: null } })
    const r = res()
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer t' } } as unknown as VercelRequest,
      r as unknown as VercelResponse,
    )
    expect(r.statusCode).toBe(404)
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    const r = res()
    await handler(
      { method: 'POST', headers: {} } as unknown as VercelRequest,
      r as unknown as VercelResponse,
    )
    expect(r.statusCode).toBe(401)
    expect(mockCancel).not.toHaveBeenCalled()
  })
})
