import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  callGeminiWithFallback,
  isModelNotFoundStatus,
  modelNotFoundMessage,
  resolveGeminiModel,
} from './_lib/geminiModel.js'

/**
 * Without this, Vercel applies its default function duration (10s on Hobby),
 * which was SHORTER than this handler's own 20s AbortController and shorter
 * than the client's 25s wait. The platform therefore always won the race and
 * killed the function mid-Gemini-call, returning an opaque timeout the client
 * could not tell apart from a real AI failure.
 *
 * The ladder is now strictly nested, longest first:
 *   platform (60s)  >  this handler's abort (30s)  >  client fetch (35s)
 * so a slow Gemini call produces a clean, attributable 504 from OUR code
 * rather than an infrastructure kill.
 *
 * 60 is the ceiling on Vercel's Hobby plan without Fluid Compute; raising it
 * further requires a plan/Fluid change, not just a bigger number here.
 */
export const maxDuration = 60

/** Must stay below `maxDuration` so this handler, not the platform, times out first. */
const GEMINI_ABORT_MS = 30_000

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Simple in-memory rate limiter: max 20 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  // Pre-auth abuse shield only — real cost control is the per-user daily quota
  // in Postgres below. Raised from 20 when the scanner moved to batched
  // classification: a legitimate large scan now issues its calls in a short
  // burst rather than spread over minutes of serial waiting, and at 20/min it
  // would 429 itself. A 429 here is invisible to the user (the AI layer
  // degrades to regex), so throttling a real scan silently costs accuracy.
  if (entry.count >= 60) return true
  entry.count++
  return false
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/** ALLOWED_ORIGIN may carry several comma-separated hosts (preview deploys, a custom domain). */
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

// Server-side only — never exposed to the client, unlike a VITE_-prefixed var.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  // Pinned to known origins. This used to accept ANY `*.vercel.app` host —
  // anyone can deploy one for free — while also sending
  // Access-Control-Allow-Credentials, a wider allowlist than this app needs.
  // Extra deployments (previews, a custom domain) belong in ALLOWED_ORIGIN as
  // a comma-separated list rather than in a wildcard suffix match.
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:'))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || ALLOWED_ORIGIN)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI insights are not configured' })
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const jwt = authHeader.slice(7)
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt)
  if (userError || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Per-user daily quota, tracked in Postgres so it survives cold starts
  // (the in-memory IP limiter above resets per serverless instance and
  // doesn't actually bound cost under any real load).
  //
  // Two independent counters: email-scan classification (one call per
  // scanned email, can be dozens per scan) and AI-insights generation
  // (roughly one call per user action) used to share a single 50/day
  // limit, which meant a normal scan could exhaust the quota the
  // insights feature depends on, or vice versa. `purpose` selects which
  // counter/limit applies; omitting it preserves the original behavior
  // for any caller written before this change.
  const purpose: 'scan' | 'insights' = req.body?.purpose === 'scan' ? 'scan' : 'insights'
  const DAILY_AI_CALL_LIMIT = 50
  const DAILY_AI_SCAN_CALL_LIMIT = 500
  const dailyLimit = purpose === 'scan' ? DAILY_AI_SCAN_CALL_LIMIT : DAILY_AI_CALL_LIMIT

  const { contents, generationConfig, safetySettings } = req.body ?? {}
  if (!Array.isArray(contents)) {
    return res.status(400).json({ error: 'contents array is required' })
  }

  // Reserve one unit BEFORE the call. This used to be a SELECT, a comparison in
  // JS, and an UPDATE after success — which lost increments under the scanner's
  // own four-way batch concurrency (all four read the same count, all four
  // passed, the counter moved by one) so the cap was not enforced at all.
  // `increment_ai_call_count` does the reset/increment/check in one statement.
  const { data: withinLimit, error: quotaError } = await supabaseAdmin.rpc('increment_ai_call_count', {
    p_user_id: user.id,
    p_purpose: purpose,
    p_limit: dailyLimit,
  })

  if (quotaError) {
    return res.status(500).json({ error: 'Failed to verify usage quota' })
  }

  if (withinLimit === false) {
    const limitMessage = purpose === 'scan' ? 'Daily AI scan limit reached. Try again tomorrow.' : 'Daily AI insights limit reached. Try again tomorrow.'
    return res.status(429).json({ error: limitMessage })
  }

  // Reserving up front would otherwise make a transient upstream failure cost
  // the user a call, which the pre-atomic code never did. Every non-success
  // path below hands the unit back. Best-effort: a refund failure must never
  // mask or replace the error we are actually reporting.
  const refundQuota = async () => {
    try {
      await supabaseAdmin.rpc('refund_ai_call_count', {
        p_user_id: user.id,
        p_purpose: purpose,
      })
    } catch (refundError) {
      console.error('[gemini-proxy] Failed to refund AI quota unit:', refundError)
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_ABORT_MS)
  try {
    // Walks past any 404 to the next candidate model — see
    // `callGeminiWithFallback`. `model` is whichever id actually answered.
    const { response: geminiRes, model } = await callGeminiWithFallback(
      GEMINI_API_KEY,
      { contents, generationConfig, safetySettings },
      { signal: controller.signal }
    )

    if (!geminiRes.ok) {
      // A retired model id is reported separately and LOUDLY. This exact case
      // — gemini-2.0-flash shut down on 1 June 2026 — disabled AI
      // classification for ~10 weeks without a single visible symptom, because
      // Google's 404 was forwarded verbatim and every layer below is designed
      // to shrug off a missing AI verdict.
      //
      // Reaching here means EVERY candidate id 404'd, so this is a real
      // configuration fault and not just one stale default.
      if (isModelNotFoundStatus(geminiRes.status)) {
        const message = modelNotFoundMessage(resolveGeminiModel())
        console.error(`[gemini-proxy] FATAL CONFIG ERROR: no candidate model resolved. ${message}`)
        await refundQuota()
        return res.status(502).json({ error: message, code: 'MODEL_NOT_FOUND' })
      }

      const detail = await geminiRes.text().catch(() => '')
      console.error(
        `[gemini-proxy] Gemini API error ${geminiRes.status} for model "${model}": ${detail.slice(0, 500)}`
      )

      // Upstream 429 is passed through as 429 so the caller can back off, but
      // every other upstream failure becomes 502. Forwarding Gemini's status
      // verbatim is what made the outage above so hard to see: a 404 from
      // Google is indistinguishable, in the Vercel request log, from this
      // route not existing at all.
      const status = geminiRes.status === 429 ? 429 : 502
      await refundQuota()
      return res.status(status).json({ error: `Gemini API error: ${geminiRes.status}`, model })
    }

    const data = await geminiRes.json()

    return res.status(200).json(data)
  } catch (error: any) {
    console.error('Gemini proxy error:', error)
    await refundQuota()
    const isTimeout = error?.name === 'AbortError'
    // The raw message is logged above, not returned: forwarding it verbatim
    // leaked server-side DNS/TLS/network detail to the client for no benefit.
    return res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'Gemini API request timed out' : 'AI request failed' })
  } finally {
    clearTimeout(timeoutId)
  }
}
