import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'
import { planIdFor, scheduledStartFor, type PlanType } from './_lib/subscriptionPlans.js'

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

// Simple in-memory rate limiter: max 10 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 10) return true
  entry.count++
  return false
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/**
 * ALLOWED_ORIGIN may carry several comma-separated hosts, so a domain move can
 * serve the old and the new origin at once instead of cutting over in one
 * breaking step. Same parsing as api/create-order.ts and api/gemini-proxy.ts.
 */
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

// Ten years of cycles on either cadence, which is what "until cancelled" means
// here. Razorpay requires a finite count and caps it at 100 years.
const TOTAL_COUNT: Record<PlanType, number> = { monthly: 120, annual: 10 }

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

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  // The subscription's notes.userId is later trusted by the webhook to
  // attribute a charge to an account, so it must be derived from the
  // caller's own token here, not from the request body.
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

  const { planType } = req.body ?? {}

  if (planType !== 'monthly' && planType !== 'annual') {
    return res.status(400).json({ error: 'Invalid planType. Must be monthly or annual.' })
  }

  // One subscription at a time. A second mandate would charge the customer
  // twice for the same product, which is the duplicate-billing failure the
  // refund policy exists for — refused here, before any money moves.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('razorpay_subscription_id, subscription_expires_at')
    .eq('id', userId)
    .maybeSingle()

  if (profileRow?.razorpay_subscription_id) {
    return res.status(409).json({
      error: 'You already have an active subscription. Cancel it before starting a new one.',
      code: 'SUBSCRIPTION_ALREADY_ACTIVE',
    })
  }

  // Anyone arriving here with time still on the clock — a customer who
  // cancelled and came back, or a legacy one-time buyer moving to
  // auto-renewal — has their first charge scheduled for the day their current
  // access runs out. Starting immediately would take money for days they
  // already own. Razorpay authorises the mandate now with a ~₹5 token charge
  // it refunds straight away, then bills the real amount on start_at.
  const startAt = scheduledStartFor(profileRow?.subscription_expires_at)

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: planIdFor(planType),
      total_count: TOTAL_COUNT[planType as PlanType],
      // customer_notify: 1 makes Razorpay send the customer the
      // authorisation, charge, failure and cancellation emails. Razorpay
      // owning that billing correspondence is deliberate for this migration.
      customer_notify: 1,
      ...(startAt ? { start_at: startAt } : {}),
      notes: { userId, planType },
    })

    return res.status(200).json({
      id: subscription.id,
      planType,
      // The UI has to say "you will not be charged until <date>", so the
      // decision made here travels with the response rather than being
      // re-derived in the browser from a profile it may not have refreshed.
      startsAt: startAt ?? null,
    })
  } catch (error: unknown) {
    console.error('Error creating Razorpay subscription:', error)
    const statusCode = (error as { statusCode?: number })?.statusCode
    const message = error instanceof Error ? error.message : String(error)
    const isAuthError = statusCode === 401 || /auth|key/i.test(message || '')
    return res.status(isAuthError ? 401 : 500).json({
      error: message || 'Failed to create subscription',
    })
  }
}
