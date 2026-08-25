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

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in environment')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { refreshToken } = req.body ?? {}
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken required' })
  }

  const jwt = authHeader.slice(7)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt)
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { error: upsertError } = await supabaseAdmin
    .from('google_oauth_tokens')
    .upsert({
      user_id: user.id,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    })

  if (upsertError) {
    console.error('save-google-refresh-token: upsert failed', upsertError)
    return res.status(500).json({ error: 'Failed to save token' })
  }

  return res.status(200).json({ status: 'ok' })
}
