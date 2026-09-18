// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isChunkLoadError,
  reloadOnceForChunkError,
  retryImport,
  prefetchOnIntent,
  RELOAD_GUARD_KEY,
} from './chunkLoad'

const noSleep = () => Promise.resolve()

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/PricingPage-abc.js', // Chrome
    'error loading dynamically imported module: https://x/assets/a.js', // Firefox
    'Importing a module script failed.', // Safari — the one ErrorBoundary's button missed
    'Unable to preload CSS for /assets/a.css', // Vite preload helper
    'Failed to load module script: Expected a JavaScript-or-Wasm module script', // 404 served as HTML
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('retryImport', () => {
  it('recovers when a chunk download fails once and then succeeds', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))
      .mockResolvedValueOnce({ default: 'page' })
    await expect(retryImport(load, 2, 0, noSleep)).resolves.toEqual({ default: 'page' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget', async () => {
    const err = new TypeError('Importing a module script failed.')
    const load = vi.fn().mockRejectedValue(err)
    await expect(retryImport(load, 2, 0, noSleep)).rejects.toBe(err)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not retry an error that is not a chunk failure', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(retryImport(load, 2, 0, noSleep)).rejects.toThrow('boom')
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('reloadOnceForChunkError', () => {
  const reload = vi.fn()
  const original = window.location

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockReset()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
  })
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  it('reloads the first time and not again inside the guard window', () => {
    expect(reloadOnceForChunkError(100_000)).toBe(true)
    expect(reloadOnceForChunkError(105_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('100000')
  })

  it('reloads again once the window has passed', () => {
    reloadOnceForChunkError(100_000)
    expect(reloadOnceForChunkError(120_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  // Both reloads used to share one key. AutoUpdateChecker reloads the tab onto
  // a new build at a route change, and a chunk from the old build 404s most
  // often in exactly the seconds that follow — so the update reload armed this
  // guard, the recovery reload was skipped, and the user was left on the error
  // screen with a route that a reload would have fixed.
  it('is not suppressed by an auto-update reload', () => {
    sessionStorage.setItem('intrack_last_auto_reload', '99000')
    expect(reloadOnceForChunkError(100_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not disturb the auto-update guard', () => {
    sessionStorage.setItem('intrack_last_auto_reload', '99000')
    reloadOnceForChunkError(100_000)
    expect(sessionStorage.getItem('intrack_last_auto_reload')).toBe('99000')
  })
})

describe('prefetchOnIntent', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('starts the chunk download when a finger lands on a link to that route', () => {
    document.body.innerHTML = '<a href="/pricing"><span id="inner">Pricing</span></a><a href="https://example.com/pricing" id="ext">x</a>'
    const pricing = vi.fn(() => Promise.resolve())
    const stop = prefetchOnIntent({ '/pricing': pricing })

    document.getElementById('ext')!.dispatchEvent(new Event('touchstart', { bubbles: true }))
    expect(pricing).not.toHaveBeenCalled()

    document.getElementById('inner')!.dispatchEvent(new Event('touchstart', { bubbles: true }))
    document.getElementById('inner')!.dispatchEvent(new Event('mouseover', { bubbles: true }))
    expect(pricing).toHaveBeenCalledTimes(1)

    stop()
  })

  it('tries again on the next intent if the prefetch failed', async () => {
    document.body.innerHTML = '<a href="/privacy" id="a">Privacy</a>'
    const privacy = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const stop = prefetchOnIntent({ '/privacy': privacy })
    const a = document.getElementById('a')!
    a.dispatchEvent(new Event('touchstart', { bubbles: true }))
    await Promise.resolve(); await Promise.resolve()
    a.dispatchEvent(new Event('touchstart', { bubbles: true }))
    expect(privacy).toHaveBeenCalledTimes(2)
    stop()
  })
})
