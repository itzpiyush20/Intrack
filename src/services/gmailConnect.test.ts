import { describe, it, expect, vi } from 'vitest'
import {
  GMAIL_READONLY_SCOPE,
  connectGmailInbox,
  gmailConnectErrorMessage,
  isSameMailbox,
  normalizeMailbox,
  type GmailConnectDeps,
} from './gmailConnect'

function deps(overrides: Partial<GmailConnectDeps> = {}): GmailConnectDeps {
  return {
    requestToken: vi.fn().mockResolvedValue({ access_token: 'tok', scope: `openid ${GMAIL_READONLY_SCOPE}` }),
    fetchGmailAddress: vi.fn().mockResolvedValue('main@gmail.com'),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const input = { clientId: 'client-id', loginEmail: 'main@gmail.com' }

describe('normalizeMailbox / isSameMailbox', () => {
  it('treats Gmail dots, +tags, case and googlemail.com as one mailbox', () => {
    expect(isSameMailbox('Piyush.S+bank@GoogleMail.com', 'piyushs@gmail.com')).toBe(true)
  })

  it('keeps dots and +tags significant on other domains', () => {
    expect(isSameMailbox('a.b@company.com', 'ab@company.com')).toBe(false)
    expect(normalizeMailbox(' A.B@Company.com ')).toBe('a.b@company.com')
  })

  it('distinguishes different Gmail accounts', () => {
    expect(isSameMailbox('main@gmail.com', 'other@gmail.com')).toBe(false)
  })
})

describe('connectGmailInbox', () => {
  it('returns the token when the picked Gmail is the login email', async () => {
    const d = deps()
    expect(await connectGmailInbox(input, d)).toEqual({ ok: true, token: 'tok' })
    expect(d.requestToken).toHaveBeenCalledWith('client-id', 'main@gmail.com')
    expect(d.revokeToken).not.toHaveBeenCalled()
  })

  it('refuses a different Google account and revokes the grant at Google', async () => {
    const d = deps({ fetchGmailAddress: vi.fn().mockResolvedValue('other@gmail.com') })
    expect(await connectGmailInbox(input, d)).toEqual({
      ok: false,
      reason: 'wrong_account',
      pickedEmail: 'other@gmail.com',
    })
    expect(d.revokeToken).toHaveBeenCalledWith('tok')
  })

  it('still refuses when the revoke itself fails', async () => {
    const d = deps({
      fetchGmailAddress: vi.fn().mockResolvedValue('other@gmail.com'),
      revokeToken: vi.fn().mockRejectedValue(new Error('offline')),
    })
    expect(await connectGmailInbox(input, d)).toMatchObject({ ok: false, reason: 'wrong_account' })
  })

  it('refuses without revoking when the Gmail address cannot be read', async () => {
    const d = deps({ fetchGmailAddress: vi.fn().mockRejectedValue(new Error('offline')) })
    expect(await connectGmailInbox(input, d)).toEqual({ ok: false, reason: 'verify_failed' })
    expect(d.revokeToken).not.toHaveBeenCalled()
  })

  it('refuses when the user unticked the Gmail permission', async () => {
    const d = deps({ requestToken: vi.fn().mockResolvedValue({ access_token: 'tok', scope: 'openid email' }) })
    expect(await connectGmailInbox(input, d)).toEqual({ ok: false, reason: 'scope_denied' })
    expect(d.fetchGmailAddress).not.toHaveBeenCalled()
  })

  it('maps popup outcomes', async () => {
    for (const code of ['popup_closed', 'popup_blocked'] as const) {
      const d = deps({ requestToken: vi.fn().mockRejectedValue(new Error(code)) })
      expect(await connectGmailInbox(input, d)).toEqual({ ok: false, reason: code })
    }
    const d = deps({ requestToken: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await connectGmailInbox(input, d)).toEqual({ ok: false, reason: 'script_failed' })
  })

  it('does not open Google without a client id or login email', async () => {
    const d = deps()
    expect(await connectGmailInbox({ clientId: undefined, loginEmail: 'main@gmail.com' }, d)).toEqual({ ok: false, reason: 'not_configured' })
    expect(await connectGmailInbox({ clientId: 'client-id', loginEmail: null }, d)).toEqual({ ok: false, reason: 'no_login_email' })
    expect(d.requestToken).not.toHaveBeenCalled()
  })
})

describe('gmailConnectErrorMessage', () => {
  it('names both addresses on a wrong pick', () => {
    const msg = gmailConnectErrorMessage({ ok: false, reason: 'wrong_account', pickedEmail: 'other@gmail.com' }, 'main@gmail.com')
    expect(msg).toContain('other@gmail.com')
    expect(msg).toContain('main@gmail.com')
    expect(msg).toContain('cancelled')
  })

  it('stays silent when the user closed the popup', () => {
    expect(gmailConnectErrorMessage({ ok: false, reason: 'popup_closed' }, 'main@gmail.com')).toBeNull()
  })
})
