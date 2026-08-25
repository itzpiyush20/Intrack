import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockGetUser, mockUpsert } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ upsert: mockUpsert }),
  }),
}))

import handler from './save-google-refresh-token.js'

function makeRes() {
  let statusVal = 200
  let jsonVal: any = null
  const res = {
    setHeader: vi.fn(),
    status: (code: number) => {
      statusVal = code
      return { json: (data: any) => { jsonVal = data }, end: () => {} }
    },
  } as unknown as VercelResponse
  return { res, getStatus: () => statusVal, getJson: () => jsonVal }
}

describe('api/save-google-refresh-token', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://www.intrack.co.in'
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  it('rejects requests with no Authorization header', async () => {
    const req = { method: 'POST', headers: { origin: 'https://www.intrack.co.in' }, body: { refreshToken: 'rt' } } as unknown as VercelRequest
    const { res, getStatus } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(401)
  })

  it('rejects requests missing refreshToken', async () => {
    const req = {
      method: 'POST',
      headers: { origin: 'https://www.intrack.co.in', authorization: 'Bearer jwt' },
      body: {},
    } as unknown as VercelRequest
    const { res, getStatus } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(400)
  })

  it('upserts the refresh token for the authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockUpsert.mockResolvedValue({ error: null })

    const req = {
      method: 'POST',
      headers: { origin: 'https://www.intrack.co.in', authorization: 'Bearer valid-jwt' },
      body: { refreshToken: 'the-refresh-token' },
    } as unknown as VercelRequest
    const { res, getStatus, getJson } = makeRes()

    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(mockUpsert).toHaveBeenCalledWith({
      user_id: 'user-123',
      refresh_token: 'the-refresh-token',
      updated_at: expect.any(String),
    })
  })
})
