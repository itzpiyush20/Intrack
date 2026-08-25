import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/**
 * ALLOWED_ORIGIN may carry several comma-separated hosts, so a domain move can
 * serve the old and the new origin at once instead of cutting over in one
 * breaking step. Same parsing as api/gemini-proxy.ts.
 */
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 20) return true
  entry.count++
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' })

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in environment')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  // Verify the caller is an authenticated Supabase user before touching their Google token
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const jwt = authHeader.slice(7)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt)
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // The refresh token is looked up by the authenticated user's id — never accepted
  // from the request body. Taking it from the caller would turn this endpoint into
  // a token-exchange oracle: anyone holding *any* valid app JWT could mint Gmail
  // access tokens for any refresh token they got hold of.
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()

  if (tokenErr) {
    console.error('refresh-google-token: token lookup failed', tokenErr)
    return res.status(500).json({ error: 'Token lookup failed' })
  }
  // 410 = "this grant is gone" — the client clears local state and prompts a reconnect.
  if (!tokenRow?.refresh_token) {
    return res.status(410).json({ error: 'no_token' })
  }
  const refreshToken = tokenRow.refresh_token

  // Exchange the Google refresh token for a new access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({})) as Record<string, string>
    // invalid_grant = refresh token revoked by the user in their Google account.
    // Drop the dead row so the daily sync cron stops retrying it, and tell the
    // client (410) to clear local state and prompt a reconnect.
    if (err.error === 'invalid_grant') {
      await supabaseAdmin.from('google_oauth_tokens').delete().eq('user_id', user.id)
      return res.status(410).json({ error: 'invalid_grant' })
    }
    return res.status(400).json({ error: err.error || 'Token refresh failed' })
  }

  const { access_token, expires_in } = await tokenRes.json() as { access_token: string; expires_in: number }
  return res.status(200).json({ accessToken: access_token, expiresIn: expires_in })
}
