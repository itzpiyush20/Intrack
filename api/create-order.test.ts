import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Define hoisted mocks
const { mockCreate, mockGetUser, mockMaybeSingle } = vi.hoisted(() => {
  return {
    mockCreate: vi.fn(),
    mockGetUser: vi.fn(),
    mockMaybeSingle: vi.fn()
  }
})

// Mock Razorpay
vi.mock('razorpay', () => {
  return {
    default: class MockRazorpay {
      orders = {
        create: mockCreate
      }
    }
  }
})

// Mock Supabase. `from` supports the single chain the pending-plan guard
// uses: .from('profiles').select(...).eq(...).maybeSingle(). Individual
// tests configure mockMaybeSingle's resolved value the same way mockGetUser
// is configured below.
vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      auth: {
        getUser: mockGetUser
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: mockMaybeSingle
          })
        })
      })
    })
  }
})

// Now import handler after mocks are set up
import handler from './create-order.js'

describe('api/create-order', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://www.intrack.co.in'
    // Default: no profile row / nothing queued, so existing tests that don't
    // care about the pending-plan guard proceed to order creation as before.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  })

  it('successfully creates an order and passes only userId and planType as notes', async () => {
    // 1. Mock Supabase Auth returning a valid user
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id-12345' } },
      error: null
    })

    // 2. Mock Razorpay order creation success
    mockCreate.mockResolvedValue({
      id: 'order_test_98765',
      amount: 3100,
      currency: 'INR'
    })

    // 3. Prepare mock request and response
    const req = {
      method: 'POST',
      headers: {
        origin: 'https://www.intrack.co.in',
        authorization: 'Bearer mock-valid-jwt'
      },
      body: {
        planType: 'monthly'
      }
    } as unknown as VercelRequest

    let statusVal = 200
    let jsonVal: any = null
    const res = {
      setHeader: vi.fn(),
      status: (code: number) => {
        statusVal = code
        return {
          json: (data: any) => {
            jsonVal = data
          }
        }
      }
    } as unknown as VercelResponse

    // 4. Invoke the handler
    await handler(req, res)

    // 5. Assertions
    expect(statusVal).toBe(200)
    expect(jsonVal).toEqual({
      id: 'order_test_98765',
      amount: 3100,
      currency: 'INR'
    })

    // Notes carry only what the order needs; the intrak attribution fields
    // that used to ride along here were removed with the tracker.
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.amount).toBe(3100)
    expect(callArgs.currency).toBe('INR')
    expect(callArgs.notes).toEqual({
      userId: 'test-user-id-12345',
      planType: 'monthly'
    })
  })

  it('refuses checkout with 409 when a plan is already queued, and never creates an order', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id-12345' } },
      error: null
    })

    const pendingActivatesAt = '2026-09-16T00:00:00.000Z'
    mockMaybeSingle.mockResolvedValue({
      data: { pending_plan_type: 'monthly', pending_activates_at: pendingActivatesAt },
      error: null
    })

    const req = {
      method: 'POST',
      headers: {
        origin: 'https://www.intrack.co.in',
        authorization: 'Bearer mock-valid-jwt'
      },
      body: {
        planType: 'annual'
      }
    } as unknown as VercelRequest

    let statusVal = 200
    let jsonVal: any = null
    const res = {
      setHeader: vi.fn(),
      status: (code: number) => {
        statusVal = code
        return {
          json: (data: any) => {
            jsonVal = data
          }
        }
      }
    } as unknown as VercelResponse

    await handler(req, res)

    expect(statusVal).toBe(409)
    expect(jsonVal.code).toBe('PLAN_ALREADY_QUEUED')
    expect(jsonVal.pendingActivatesAt).toBe(pendingActivatesAt)

    // The whole point of the guard: no money changes hands for a plan that
    // cannot be granted.
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('proceeds to create an order when nothing is queued', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id-12345' } },
      error: null
    })

    mockMaybeSingle.mockResolvedValue({
      data: { pending_plan_type: null, pending_activates_at: null },
      error: null
    })

    mockCreate.mockResolvedValue({
      id: 'order_test_98765',
      amount: 3100,
      currency: 'INR'
    })

    const req = {
      method: 'POST',
      headers: {
        origin: 'https://www.intrack.co.in',
        authorization: 'Bearer mock-valid-jwt'
      },
      body: {
        planType: 'monthly'
      }
    } as unknown as VercelRequest

    let statusVal = 200
    let jsonVal: any = null
    const res = {
      setHeader: vi.fn(),
      status: (code: number) => {
        statusVal = code
        return {
          json: (data: any) => {
            jsonVal = data
          }
        }
      }
    } as unknown as VercelResponse

    await handler(req, res)

    expect(statusVal).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(jsonVal).toEqual({
      id: 'order_test_98765',
      amount: 3100,
      currency: 'INR'
    })
  })
})
