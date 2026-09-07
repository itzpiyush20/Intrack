import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'

const razorpayKeyId = [process.env.RAZORPAY_KEY_ID, process.env.VITE_RAZORPAY_KEY_ID]
  .find(k => k && k.startsWith('rzp_')) || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || ''

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
})

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/**
 * ALLOWED_ORIGIN may carry several comma-separated hosts, so a domain move can
 * serve the old and the new origin at once instead of cutting over in one
 * breaking step. Same parsing as api/create-order.ts and api/create-subscription.ts.
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

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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
  const userId = user.id

  // The subscription id comes from the caller's OWN profile row, never from
  // the request body — otherwise one account could cancel another's
  // subscription by passing its id.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('razorpay_subscription_id')
    .eq('id', userId)
    .maybeSingle()

  const subscriptionId = profileRow?.razorpay_subscription_id
  if (!subscriptionId) {
    return res.status(404).json({ error: 'No active subscription found on this account.' })
  }

  try {
    // cancel_at_cycle_end = true. Cancelling immediately would withdraw
    // access the customer already paid for, which the Refund Policy
    // forbids. profiles.razorpay_subscription_id is deliberately NOT
    // cleared here — the subscription.cancelled webhook owns that write,
    // so exactly one path performs it.
    await razorpay.subscriptions.cancel(subscriptionId, true)

    return res.status(200).json({ cancelled: true, atCycleEnd: true })
  } catch (error: unknown) {
    console.error(`Error cancelling Razorpay subscription ${subscriptionId}:`, error)
    const message = error instanceof Error ? error.message : String(error)
    return res.status(500).json({ error: message || 'Failed to cancel subscription' })
  }
}
