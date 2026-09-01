import { describe, it, expect } from 'vitest'
import { cleanAvatarUrl } from './profiles'

describe('cleanAvatarUrl', () => {
  it('keeps an ordinary image URL', () => {
    expect(cleanAvatarUrl('https://images.unsplash.com/photo-1.jpg'))
      .toBe('https://images.unsplash.com/photo-1.jpg')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanAvatarUrl('  https://example.com/a.png  ')).toBe('https://example.com/a.png')
  })

  it('treats an empty or whitespace-only value as no avatar', () => {
    expect(cleanAvatarUrl('')).toBeNull()
    expect(cleanAvatarUrl('   ')).toBeNull()
    expect(cleanAvatarUrl(undefined)).toBeNull()
  })

  it('refuses a non-http scheme', () => {
    // Inert in an <img src>, but storing it leaves it in the profile row ready
    // for any future consumer that is less careful — a link, a redirect, an
    // email template. Cheaper to refuse at the point of storage.
    expect(cleanAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(cleanAvatarUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull()
    expect(cleanAvatarUrl('file:///etc/passwd')).toBeNull()
  })

  it('refuses something that is not a URL at all', () => {
    expect(cleanAvatarUrl('not a url')).toBeNull()
  })
})
