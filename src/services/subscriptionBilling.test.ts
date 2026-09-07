import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubscription, cancelSubscription } from './subscriptionBilling'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('subscriptionBilling', () => {
  it('sends the access token and returns the subscription id', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', planType: 'annual' }) })
    const result = await createSubscription('annual', 'token-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/create-subscription', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      body: JSON.stringify({ planType: 'annual' }),
    }))
    expect(result).toEqual({ id: 'sub_1', planType: 'annual' })
  })

  it('throws the server message so the toast says what actually went wrong', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'You already have an active subscription.' }),
    })
    await expect(createSubscription('monthly', 'token-1'))
      .rejects.toThrow('You already have an active subscription.')
  })

  it('cancels through the endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ cancelled: true }) })
    await expect(cancelSubscription('token-1')).resolves.toEqual({ cancelled: true })
  })
})
