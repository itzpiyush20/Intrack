// ============================================================
// geminiModel.ts — the ONE place the Gemini model id is chosen.
//
// Why this file exists: the model id used to be a string literal inside
// `api/gemini-proxy.ts` AND the since-deleted `api/auto-sync-gmail.ts`
// (removed 2026-08-27 with automatic scanning). Google shut
// `gemini-2.0-flash` down on 1 June 2026, both literals went stale, and
// `generativelanguage.googleapis.com` began answering every request with
// 404 NOT_FOUND. The proxy forwarded that 404 verbatim, the client's
// `isFatalProxyError` check treated 404 as terminal, and every AI verdict
// became `null` — which the scanner correctly reads as "no AI opinion, use
// the regex ladder". So the classifier was completely dead for ~10 weeks
// while the app reported nothing wrong at all.
//
// Two rules follow from that, and both are load-bearing:
//   1. ONE definition, imported by every caller. Two literals cannot drift.
//   2. Overridable WITHOUT a code change. Model ids now churn on a scale of
//      months; when the next one is retired the fix must be an env var in the
//      Vercel dashboard, not a pull request.
// ============================================================

/**
 * Model used for email classification (the scanner) and AI insights.
 *
 * Default chosen 2026-08-13 for the classification workload: it is the
 * cheapest current tier and this is high-volume, low-reasoning structured
 * extraction. Override with the GEMINI_MODEL environment variable.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export function resolveGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
}

/**
 * Model ids to try, in order, when the configured one answers 404.
 *
 * This exists because of a specific, verified constraint rather than as
 * general defensiveness. Google resolves API-key auth BEFORE model routing, so
 * an unauthenticated request cannot tell a live model id from a fabricated one
 * — every id returns the same 403. A model id therefore cannot be validated
 * from outside the deployment, and picking exactly one is a bet that only
 * settles in production, on a path whose entire failure history is silence.
 *
 * So: try the configured id first (an explicit GEMINI_MODEL always wins), then
 * fall through known candidates. The first that answers is cached for the life
 * of the warm instance, and logged with an instruction to pin it, so the
 * fallback converts an outage into one noisy log line instead of weeks of
 * quietly degraded output.
 *
 * This is a safety net, NOT a substitute for configuration. Pin GEMINI_MODEL
 * once the working id is known — the fallback costs one extra round trip per
 * cold start whenever the first choice is dead.
 */
export const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
]

/** Configured model first, then the fallbacks, without repeats. */
export function geminiModelCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([resolveGeminiModel(env), ...GEMINI_MODEL_FALLBACKS])]
}

/** Told to the operator when a fallback had to rescue the configured model. */
export function modelFallbackMessage(configured: string, working: string): string {
  return (
    `Gemini model "${configured}" returned 404, but "${working}" works. ` +
    `Set GEMINI_MODEL="${working}" to pin it and remove the extra probe on every cold start.`
  )
}

export function geminiEndpoint(apiKey: string, model: string = resolveGeminiModel()): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
}

/**
 * True when an upstream status means "this model id does not resolve" rather
 * than "the request was bad" or "we are busy".
 *
 * 404 is the signature of a retired or misspelled model. It is the single
 * most important failure to name explicitly, because it is silent by nature:
 * every downstream layer is built to degrade gracefully when the AI has no
 * opinion, so a permanently dead model looks exactly like a model that keeps
 * answering "I'm not sure".
 */
export function isModelNotFoundStatus(status: number): boolean {
  return status === 404
}

/**
 * The model id already known to work on this warm instance, so the fallback
 * probe runs at most once per cold start rather than once per request.
 */
let cachedWorkingModel: string | null = null

/** Test seam — resets the warm-instance cache. */
export function resetGeminiModelCache(): void {
  cachedWorkingModel = null
}

export interface GeminiCallResult {
  response: Response
  model: string
}

/**
 * POSTs to Gemini, walking the candidate list past any 404.
 *
 * Only 404 advances to the next candidate: that is the signature of a model id
 * that does not resolve. Every other status — 429, 5xx, a bad request — is
 * that model's real answer and is returned as-is, because retrying a rate
 * limit against a different model would just multiply the failure.
 */
export async function callGeminiWithFallback(
  apiKey: string,
  body: unknown,
  init: { signal?: AbortSignal } = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<GeminiCallResult> {
  const configured = resolveGeminiModel(env)
  const candidates = cachedWorkingModel ? [cachedWorkingModel] : geminiModelCandidates(env)

  let last: GeminiCallResult | null = null
  for (const model of candidates) {
    const response = await fetch(geminiEndpoint(apiKey, model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: init.signal,
    })

    if (!isModelNotFoundStatus(response.status)) {
      if (response.ok) {
        if (model !== configured) console.error(`[gemini] ${modelFallbackMessage(configured, model)}`)
        cachedWorkingModel = model
      }
      return { response, model }
    }

    console.error(`[gemini] model "${model}" returned 404 (retired or misspelled)`)
    last = { response, model }
    // A cached model that has since been retired: reopen the full search.
    if (cachedWorkingModel) {
      cachedWorkingModel = null
      return callGeminiWithFallback(apiKey, body, init, env)
    }
  }

  return last as GeminiCallResult
}

/** Operator-facing explanation for a dead model id. Logged AND returned to the client. */
export function modelNotFoundMessage(model: string): string {
  return (
    `Gemini model "${model}" was not found (404). It has most likely been retired by Google. ` +
    `Set the GEMINI_MODEL environment variable to a current model id — ` +
    `see https://ai.google.dev/gemini-api/docs/deprecations`
  )
}
