// ============================================================
// disconnect-gmail.ts — Revoke the Google grant and forget the refresh token
//
// Clearing localStorage is not a disconnect: the refresh token lives in
// google_oauth_tokens and the daily cron (auto-sync-gmail.ts) will happily keep
// reading the inbox of a user who believes they disconnected. This endpoint is
// the real thing — it revokes the grant at Google, then deletes the stored row.
//
// Called from Settings ("Disconnect Gmail") and from account deletion.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/**
 * ALLOWED_ORIGIN may carry several comma-separated hosts, so a domain move can
 * serve the old and the new origin at once instead of cutting over in one
 * breaking step. Same parsing as api/gemini-proxy.ts.
 */
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

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

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in environment')
    return res.status(500).json({ error: 'Server misconfiguration' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const jwt = authHeader.slice(7)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt)
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: tokenRow } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle()

  // Already disconnected — idempotent success, so a retry never shows an error.
  if (!tokenRow?.refresh_token) {
    return res.status(200).json({ status: 'ok', revoked: false })
  }

  // Revoke at Google first. A failure here (already-revoked token, Google
  // outage) must not block deletion of our copy — leaving the row behind is
  // the harmful outcome, since that is what the cron reads.
  let revoked = false
  try {
    const revokeRes = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokenRow.refresh_token }),
    })
    revoked = revokeRes.ok
    if (!revokeRes.ok) {
      console.warn(`disconnect-gmail: Google revoke returned ${revokeRes.status} for user ${user.id}`)
    }
  } catch (e) {
    console.warn('disconnect-gmail: Google revoke request failed', e)
  }

  const { error: deleteError } = await supabaseAdmin
    .from('google_oauth_tokens')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('disconnect-gmail: failed to delete token row', deleteError)
    return res.status(500).json({ error: 'Failed to disconnect Gmail' })
  }

  return res.status(200).json({ status: 'ok', revoked })
}
