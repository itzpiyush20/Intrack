import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_FALLBACKS,
  geminiEndpoint,
  isModelNotFoundStatus,
  modelNotFoundMessage,
  resolveGeminiModel,
  callGeminiWithFallback,
  geminiModelCandidates,
  resetGeminiModelCache,
} from './geminiModel.js'

describe('resolveGeminiModel', () => {
  it('uses GEMINI_MODEL when set', () => {
    expect(resolveGeminiModel({ GEMINI_MODEL: 'gemini-9-flash' } as NodeJS.ProcessEnv)).toBe('gemini-9-flash')
  })

  it('trims surrounding whitespace, which a dashboard paste often carries', () => {
    expect(resolveGeminiModel({ GEMINI_MODEL: '  gemini-9-flash \n' } as NodeJS.ProcessEnv)).toBe('gemini-9-flash')
  })

  it.each([{}, { GEMINI_MODEL: '' }, { GEMINI_MODEL: '   ' }])(
    'falls back to the default for %j',
    (env) => {
      expect(resolveGeminiModel(env as NodeJS.ProcessEnv)).toBe(DEFAULT_GEMINI_MODEL)
    }
  )

  // The whole point of this module. gemini-2.0-flash was shut down on
  // 1 June 2026 while its id sat hardcoded in two API handlers, and the
  // resulting 404s disabled AI classification for ~10 weeks in silence.
  it('does not default to a model Google has retired', () => {
    expect(DEFAULT_GEMINI_MODEL).not.toMatch(/gemini-(1\.|1_|2\.)/)
  })
})

describe('geminiEndpoint', () => {
  it('builds a v1beta generateContent URL for the given model and key', () => {
    expect(geminiEndpoint('KEY123', 'gemini-9-flash')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-9-flash:generateContent?key=KEY123'
    )
  })
})

describe('isModelNotFoundStatus', () => {
  it('treats 404 as a dead model id', () => {
    expect(isModelNotFoundStatus(404)).toBe(true)
  })

  it.each([400, 401, 403, 429, 500, 502, 503, 504])('does not treat %i as a dead model id', (status) => {
    expect(isModelNotFoundStatus(status)).toBe(false)
  })
})

describe('modelNotFoundMessage', () => {
  it('names the failing model and the env var that fixes it', () => {
    const message = modelNotFoundMessage('gemini-2.0-flash')
    expect(message).toContain('gemini-2.0-flash')
    expect(message).toContain('GEMINI_MODEL')
  })
})

// ============================================================
// The candidate walk.
//
// Google resolves API-key auth BEFORE model routing, so an unauthenticated
// probe returns the same 403 for a real model id and a fabricated one. A model
// id therefore cannot be validated from outside the deployment, which is why
// the proxy walks candidates rather than betting on one string.
// ============================================================
describe('callGeminiWithFallback', () => {
  const okBody = { candidates: [] }

  function mockFetch(byModel: Record<string, number>) {
    const tried: string[] = []
    const fn = vi.fn(async (url: string) => {
      const model = String(url).split('/models/')[1].split(':')[0]
      tried.push(model)
      const status = byModel[model] ?? 404
      return { ok: status < 400, status, json: async () => okBody } as any
    })
    // Cast at the seam: the mock only models the two fields under test
    // (status/ok), not the whole Response/fetch surface.
    return { fn: fn as unknown as typeof globalThis.fetch, tried }
  }

  beforeEach(() => {
    resetGeminiModelCache()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('uses the configured model and stops when it answers', async () => {
    const { fn, tried } = mockFetch({ 'gemini-x': 200 })
    global.fetch = fn
    const out = await callGeminiWithFallback('KEY', {}, {}, { GEMINI_MODEL: 'gemini-x' } as NodeJS.ProcessEnv)
    expect(out.model).toBe('gemini-x')
    expect(tried).toEqual(['gemini-x'])
  })

  it('walks past a 404 to the next candidate', async () => {
    const { fn, tried } = mockFetch({ 'gemini-3.6-flash': 200 })
    global.fetch = fn
    const out = await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(out.model).toBe('gemini-3.6-flash')
    expect(tried[0]).toBe(DEFAULT_GEMINI_MODEL) // configured/default tried first
    expect(out.response.ok).toBe(true)
  })

  it('does NOT walk on a 429 — that is the model answering, not a dead id', async () => {
    const { fn, tried } = mockFetch({ [DEFAULT_GEMINI_MODEL]: 429 })
    global.fetch = fn
    const out = await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(out.response.status).toBe(429)
    expect(tried).toEqual([DEFAULT_GEMINI_MODEL])
  })

  it('does not walk on a 500 either', async () => {
    const { fn, tried } = mockFetch({ [DEFAULT_GEMINI_MODEL]: 500 })
    global.fetch = fn
    const out = await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(out.response.status).toBe(500)
    expect(tried).toHaveLength(1)
  })

  it('returns the last 404 when every candidate is dead', async () => {
    const { fn, tried } = mockFetch({})
    global.fetch = fn
    const out = await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(out.response.status).toBe(404)
    expect(tried).toEqual(geminiModelCandidates({} as NodeJS.ProcessEnv))
  })

  it('caches the working model so the probe costs nothing on later calls', async () => {
    const { fn, tried } = mockFetch({ 'gemini-3.6-flash': 200 })
    global.fetch = fn
    await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    const afterFirst = tried.length
    await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(tried.length).toBe(afterFirst + 1)
    expect(tried[tried.length - 1]).toBe('gemini-3.6-flash')
  })

  it('re-opens the search if the cached model is itself later retired', async () => {
    const live: Record<string, number> = { 'gemini-3.6-flash': 200 }
    const { fn } = mockFetch(live)
    global.fetch = fn
    await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)

    // Google retires the cached one mid-flight; another candidate takes over.
    delete live['gemini-3.6-flash']
    live['gemini-2.5-flash'] = 200

    const out = await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(out.model).toBe('gemini-2.5-flash')
    expect(out.response.ok).toBe(true)
  })

  it('tells the operator to pin the model that actually worked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fn } = mockFetch({ 'gemini-3.6-flash': 200 })
    global.fetch = fn
    await callGeminiWithFallback('KEY', {}, {}, {} as NodeJS.ProcessEnv)
    expect(spy.mock.calls.flat().join(' ')).toContain('GEMINI_MODEL="gemini-3.6-flash"')
  })
})

describe('geminiModelCandidates', () => {
  it('puts the configured model first and never repeats it', async () => {
    const list = geminiModelCandidates({ GEMINI_MODEL: 'gemini-3.6-flash' } as NodeJS.ProcessEnv)
    expect(list[0]).toBe('gemini-3.6-flash')
    expect(new Set(list).size).toBe(list.length)
  })
})


// ============================================================
// The shape of the fallback chain.
//
// The tail of this list is what rescues a whole-generation retirement, so its
// ORDER carries meaning and a careless edit would quietly undo it.
// ============================================================
describe('GEMINI_MODEL_FALLBACKS', () => {
  it('starts with the default, so the cheap model is always tried first', () => {
    expect(GEMINI_MODEL_FALLBACKS[0]).toBe(DEFAULT_GEMINI_MODEL)
  })

  it('contains no duplicates', () => {
    expect(new Set(GEMINI_MODEL_FALLBACKS).size).toBe(GEMINI_MODEL_FALLBACKS.length)
  })

  // Reaching the tail means every cheaper id 404'd — i.e. the generation is
  // gone. An older model is the worst possible last resort at that point,
  // because it is likelier to have been retired in the same sweep.
  it('puts newer generations ahead of the oldest candidate', () => {
    const oldest = GEMINI_MODEL_FALLBACKS.indexOf('gemini-2.5-flash')
    expect(oldest).toBe(GEMINI_MODEL_FALLBACKS.length - 1)
    for (const newer of ['gemini-3.7-flash', 'gemini-3.8-flash']) {
      expect(GEMINI_MODEL_FALLBACKS.indexOf(newer)).toBeGreaterThan(-1)
      expect(GEMINI_MODEL_FALLBACKS.indexOf(newer)).toBeLessThan(oldest)
    }
  })

  it('lists no model from a generation Google has already retired', () => {
    for (const model of GEMINI_MODEL_FALLBACKS) {
      expect(model).not.toMatch(/^gemini-(1\.|2\.0)/)
    }
  })
})
