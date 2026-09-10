// api/cleanup-scan-rejections.ts
//
// Daily cron: deletes email_scan_rejections rows older than 30 days. This
// is diagnostic data (why a scan rejected an email), not a permanent
// record, so it doesn't need to accumulate indefinitely.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { captureError } from './_lib/monitoring.js'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { error, count } = await supabaseAdmin
    .from('email_scan_rejections')
    .delete({ count: 'exact' })
    .lt('rejected_at', cutoff)

  if (error) {
    console.error('cleanup-scan-rejections: delete failed', error)
    await captureError(error, { route: 'cleanup-scan-rejections' })
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ deleted: count ?? 0 })
}
