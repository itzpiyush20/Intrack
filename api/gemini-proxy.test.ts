import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockRpc, mockGetUser, mockGeminiFetch, mockCaptureWarning } = vi.hoisted(() => {
  process.env.GEMINI_API_KEY = 'fake-key'
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role'
  return {
    mockRpc: vi.fn(),
    mockGetUser: vi.fn(),
    mockGeminiFetch: vi.fn(),
    mockCaptureWarning: vi.fn<(message: string, context?: Record<string, unknown>) => Promise<void>>(),
  }
})

vi.mock('./_lib/monitoring.js', () => ({
  captureError: vi.fn(async () => {}),
  captureWarning: mockCaptureWarning,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: (table: string) => {
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

vi.stubGlobal('fetch', mockGeminiFetch)

import handler, { resetUpstream429Throttle } from './gemini-proxy'

function makeReqRes(body: any) {
  const req = {
    method: 'POST',
    headers: { origin: 'https://www.intrack.co.in', authorization: 'Bearer fake-jwt' },
    body,
  } as unknown as VercelRequest

  let statusVal = 200
  let jsonVal: any = null
  const res = {
    setHeader: () => {},
    status: (code: number) => { statusVal = code; return { json: (data: any) => { jsonVal = data }, end: () => {} } },
  } as unknown as VercelResponse

  return { req, res, getStatus: () => statusVal, getJson: () => jsonVal }
}

/** Calls to `increment_ai_call_count`, i.e. quota reservations. */
function reservations() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'increment_ai_call_count')
}

/** Calls to `refund_ai_call_count`, i.e. quota given back after a failure. */
function refunds() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'refund_ai_call_count')
}

describe('api/gemini-proxy — purpose-aware quota split', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockGeminiFetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) })
    // Default: within limit.
    mockRpc.mockResolvedValue({ data: true, error: null })
  })

  it('reserves against ai_scan_calls_count at the 500 limit for purpose: "scan"', async () => {
    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(reservations()).toHaveLength(1)
    expect(reservations()[0][1]).toEqual({ p_user_id: 'user-1', p_purpose: 'scan', p_limit: 500 })
    expect(refunds()).toHaveLength(0)
  })

  it('reserves against ai_calls_count at the 50 limit for purpose: "insights" (or omitted)', async () => {
    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }] })
    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(reservations()).toHaveLength(1)
    expect(reservations()[0][1]).toEqual({ p_user_id: 'user-1', p_purpose: 'insights', p_limit: 50 })
    expect(refunds()).toHaveLength(0)
  })

  it('rejects a scan request at its own 500-call limit even when insights quota has headroom', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })

    const { req, res, getStatus, getJson } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(getJson()).toEqual({ error: 'Daily AI scan limit reached. Try again tomorrow.' })
    // Over-limit is not a failed attempt — nothing to hand back.
    expect(refunds()).toHaveLength(0)
    expect(mockGeminiFetch).not.toHaveBeenCalled()
  })

  it('returns the insights limit message when the insights counter is exhausted', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })

    const { req, res, getStatus, getJson } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }] })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(getJson()).toEqual({ error: 'Daily AI insights limit reached. Try again tomorrow.' })
  })

  it('returns 500 when the quota RPC itself errors, without calling Gemini', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const { req, res, getStatus, getJson } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(500)
    expect(getJson()).toEqual({ error: 'Failed to verify usage quota' })
    expect(mockGeminiFetch).not.toHaveBeenCalled()
  })

  it('refunds the reserved unit when the Gemini call fails, so a transient error costs nothing', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream down' })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(502)
    expect(reservations()).toHaveLength(1)
    expect(refunds()).toHaveLength(1)
    expect(refunds()[0][1]).toEqual({ p_user_id: 'user-1', p_purpose: 'scan' })
  })

  it('refunds the reserved unit when the Gemini call throws', async () => {
    mockGeminiFetch.mockRejectedValue(new Error('network blew up'))

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }] })
    await handler(req, res)

    expect(getStatus()).toBe(500)
    expect(refunds()).toHaveLength(1)
    expect(refunds()[0][1]).toEqual({ p_user_id: 'user-1', p_purpose: 'insights' })
  })

  it('does not let a failing refund mask the original Gemini error', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream down' })
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'refund_ai_call_count') return Promise.reject(new Error('refund failed'))
      return Promise.resolve({ data: true, error: null })
    })

    const { req, res, getStatus, getJson } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(502)
    expect(getJson()).toMatchObject({ error: 'Gemini API error: 503' })
  })
})


// ============================================================
// Upstream 429 reporting.
//
// This is the only Gemini failure with no visible symptom anywhere: it does
// not throw (so the catch block's captureError never sees it), it is not a
// 404 (so the loud MODEL_NOT_FOUND path does not fire), and the client
// degrades to the regex ladder while telling the user the scan succeeded.
// Without this warning the operator's first signal would be noticing, months
// later, that categorisation got worse — which is exactly how the
// gemini-2.0-flash shutdown hid for ten weeks.
// ============================================================
describe('api/gemini-proxy — upstream 429 warning', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetUpstream429Throttle()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockRpc.mockResolvedValue({ data: true, error: null })
    mockCaptureWarning.mockResolvedValue(undefined)
  })

  it('reports an upstream 429 as a warning naming GEMINI_API_KEY', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(mockCaptureWarning).toHaveBeenCalledTimes(1)
    expect(mockCaptureWarning.mock.calls[0][0]).toContain('GEMINI_API_KEY')
    expect(mockCaptureWarning.mock.calls[0][1]).toMatchObject({ route: 'gemini-proxy', purpose: 'scan' })
  })

  it('still refunds the quota unit and still returns 429 to the caller', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })

    const { req, res, getStatus, getJson } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(getJson()).toMatchObject({ error: 'Gemini API error: 429' })
    expect(refunds()).toHaveLength(1)
  })

  // The throttle is the whole reason this can be awaited. Every call 429s
  // during a quota outage and captureWarning flushes for up to 2s; one report
  // per call would stall a 40-email scan for over a minute.
  it('reports once per window, not once per call, during a sustained outage', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })

    for (let i = 0; i < 5; i++) {
      const { req, res } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
      await handler(req, res)
    }

    expect(mockCaptureWarning).toHaveBeenCalledTimes(1)
  })

  it('does not report the per-user daily quota rejection — that one is normal and never reaches Google', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(mockCaptureWarning).not.toHaveBeenCalled()
    expect(mockGeminiFetch).not.toHaveBeenCalled()
  })

  it('does not report a non-429 upstream failure through this path', async () => {
    mockGeminiFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream down' })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(502)
    expect(mockCaptureWarning).not.toHaveBeenCalled()
  })
})
