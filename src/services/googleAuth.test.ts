import { describe, it, expect, vi, beforeEach } from 'vitest'

const LEGACY_KEY = 'intrack_google_refresh_token'
const LINKED_KEY = 'intrack_google_linked'
const TOKEN_KEY = 'intrack_google_token'

// The suite runs in the default node environment, which has no localStorage.
// A minimal in-memory stand-in is enough for these tests and avoids pulling in
// jsdom just for key/value storage.
function createLocalStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.stubGlobal('localStorage', createLocalStorageStub())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('saveGoogleRefreshTokenServerSide', () => {
  it('POSTs the refresh token to the save endpoint with the Supabase JWT', async () => {
    const { saveGoogleRefreshTokenServerSide } = await import('./googleAuth')
    await saveGoogleRefreshTokenServerSide('supabase-jwt', 'google-refresh-token')

    expect(fetch).toHaveBeenCalledWith('/api/save-google-refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer supabase-jwt' },
      body: JSON.stringify({ refreshToken: 'google-refresh-token' }),
    })
  })

  it('never writes the refresh token to localStorage', async () => {
    const { saveGoogleRefreshTokenServerSide } = await import('./googleAuth')
    await saveGoogleRefreshTokenServerSide('jwt', 'google-refresh-token')

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k))
    expect(stored).not.toContain('google-refresh-token')
  })

  it('returns false and does not mark linked when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { saveGoogleRefreshTokenServerSide } = await import('./googleAuth')

    await expect(saveGoogleRefreshTokenServerSide('jwt', 'rt')).resolves.toBe(false)
    expect(localStorage.getItem(LINKED_KEY)).toBeNull()
  })
})

describe('migrateLegacyRefreshToken', () => {
  it('moves a legacy localStorage token to the server and erases the local copy', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-rt')
    const { migrateLegacyRefreshToken } = await import('./googleAuth')
    await migrateLegacyRefreshToken('jwt')

    expect(fetch).toHaveBeenCalledWith('/api/save-google-refresh-token', expect.objectContaining({
      body: JSON.stringify({ refreshToken: 'legacy-rt' }),
    }))
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('keeps the local copy when the server save fails, so sync is not silently lost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    localStorage.setItem(LEGACY_KEY, 'legacy-rt')
    const { migrateLegacyRefreshToken } = await import('./googleAuth')
    await migrateLegacyRefreshToken('jwt')

    expect(localStorage.getItem(LEGACY_KEY)).toBe('legacy-rt')
  })

  it('is a no-op when there is nothing to migrate', async () => {
    const { migrateLegacyRefreshToken } = await import('./googleAuth')
    await migrateLegacyRefreshToken('jwt')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('tryRefreshGoogleToken', () => {
  it('sends no refresh token in the request body', async () => {
    localStorage.setItem(LINKED_KEY, 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'fresh-access-token' }),
    }))
    const { tryRefreshGoogleToken } = await import('./googleAuth')
    const token = await tryRefreshGoogleToken('supabase-jwt')

    expect(token).toBe('fresh-access-token')
    const [, init] = (fetch as any).mock.calls[0]
    expect(init.body).toBeUndefined()
    expect(init.headers.Authorization).toBe('Bearer supabase-jwt')
  })

  it('skips the round-trip entirely when the account has never linked Gmail', async () => {
    const { tryRefreshGoogleToken } = await import('./googleAuth')
    await expect(tryRefreshGoogleToken('jwt')).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears local state on 410 so the UI prompts a reconnect', async () => {
    localStorage.setItem(LINKED_KEY, 'true')
    localStorage.setItem(TOKEN_KEY, 'stale-access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }))
    const { tryRefreshGoogleToken } = await import('./googleAuth')

    await expect(tryRefreshGoogleToken('jwt')).resolves.toBeNull()
    expect(localStorage.getItem(LINKED_KEY)).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})

describe('disconnectGmail', () => {
  it('calls the disconnect endpoint and clears all local Google state', async () => {
    localStorage.setItem(LINKED_KEY, 'true')
    localStorage.setItem(TOKEN_KEY, 'access-token')
    const { disconnectGmail } = await import('./googleAuth')
    const { error } = await disconnectGmail('jwt')

    expect(error).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/disconnect-gmail', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
    })
    expect(localStorage.getItem(LINKED_KEY)).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('still clears local state when the server call fails', async () => {
    localStorage.setItem(LINKED_KEY, 'true')
    localStorage.setItem(TOKEN_KEY, 'access-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { disconnectGmail } = await import('./googleAuth')
    const { error } = await disconnectGmail('jwt')

    expect(error).toBe('offline')
    expect(localStorage.getItem(LINKED_KEY)).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
