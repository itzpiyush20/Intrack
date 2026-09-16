import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  GMAIL_CONNECT_ORIGIN_KEY,
  GMAIL_CONNECT_ORIGIN_TTL_MS,
  rememberGmailConnectOrigin,
  takeGmailConnectOrigin,
  isDifferentGmailConnectAccount,
} from './gmailConnectGuard'

// Node test environment has no localStorage; same stub as googleAuth.test.ts.
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

const session = {
  access_token: 'access-main',
  refresh_token: 'refresh-main',
  user: { id: 'user-main', email: 'main@gmail.com' },
} as unknown as Session

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageStub())
})

describe('rememberGmailConnectOrigin / takeGmailConnectOrigin', () => {
  it('round-trips the signed-in account', () => {
    rememberGmailConnectOrigin(session, 1000)
    expect(takeGmailConnectOrigin(2000)).toEqual({
      userId: 'user-main',
      email: 'main@gmail.com',
      accessToken: 'access-main',
      refreshToken: 'refresh-main',
      startedAt: 1000,
    })
  })

  it('uses a key that signOut purges (name contains "oauth")', () => {
    expect(GMAIL_CONNECT_ORIGIN_KEY).toContain('oauth')
  })

  it('deletes the record on read so it is acted on once', () => {
    rememberGmailConnectOrigin(session, 1000)
    takeGmailConnectOrigin(2000)
    expect(localStorage.getItem(GMAIL_CONNECT_ORIGIN_KEY)).toBeNull()
    expect(takeGmailConnectOrigin(2000)).toBeNull()
  })

  it('ignores and deletes a record older than the TTL', () => {
    rememberGmailConnectOrigin(session, 0)
    expect(takeGmailConnectOrigin(GMAIL_CONNECT_ORIGIN_TTL_MS + 1)).toBeNull()
    expect(localStorage.getItem(GMAIL_CONNECT_ORIGIN_KEY)).toBeNull()
  })

  it('ignores a record from the future (clock change)', () => {
    rememberGmailConnectOrigin(session, 5000)
    expect(takeGmailConnectOrigin(1000)).toBeNull()
  })

  it('ignores malformed or incomplete records', () => {
    localStorage.setItem(GMAIL_CONNECT_ORIGIN_KEY, '{not json')
    expect(takeGmailConnectOrigin(0)).toBeNull()
    localStorage.setItem(GMAIL_CONNECT_ORIGIN_KEY, JSON.stringify({ userId: 'u', startedAt: 0 }))
    expect(takeGmailConnectOrigin(0)).toBeNull()
  })

  it('returns null when nothing was recorded', () => {
    expect(takeGmailConnectOrigin()).toBeNull()
  })
})

describe('isDifferentGmailConnectAccount', () => {
  const origin = {
    userId: 'user-main',
    email: 'main@gmail.com',
    accessToken: 'a',
    refreshToken: 'r',
    startedAt: 0,
  }

  it('flags a different returning user', () => {
    expect(isDifferentGmailConnectAccount(origin, 'user-other')).toBe(true)
  })

  it('accepts the same user (Supabase linked the Google identity)', () => {
    expect(isDifferentGmailConnectAccount(origin, 'user-main')).toBe(false)
  })

  it('does nothing without a record or a returning user', () => {
    expect(isDifferentGmailConnectAccount(null, 'user-other')).toBe(false)
    expect(isDifferentGmailConnectAccount(origin, null)).toBe(false)
  })
})
