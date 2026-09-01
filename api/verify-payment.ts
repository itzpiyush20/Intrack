import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Razorpay from 'razorpay'
import { verifyHmacSignature, planDurationDays } from './_lib/razorpaySignature.js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const razorpayKeyId = [process.env.RAZORPAY_KEY_ID, process.env.VITE_RAZORPAY_KEY_ID]
  .find(k => k && k.startsWith('rzp_')) || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || ''

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
})

// Simple in-memory rate limiter: max 5 requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 5) return true
  entry.count++
  return false
}

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

  // Verify the caller is an authenticated Supabase user — the userId for this
  // payment is derived from the token, never trusted from the request body.
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

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    planType,
  } = req.body ?? {}

  if (
    typeof razorpay_order_id !== 'string' || !razorpay_order_id ||
    typeof razorpay_payment_id !== 'string' || !razorpay_payment_id ||
    typeof razorpay_signature !== 'string' || !razorpay_signature ||
    !['monthly', 'annual'].includes(planType)
  ) {
    return res.status(400).json({ error: 'Missing or invalid payment parameters' })
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET || ''
  const signatureValid = verifyHmacSignature(`${razorpay_order_id}|${razorpay_payment_id}`, keySecret, razorpay_signature)

  if (!signatureValid) {
    console.error('Razorpay signature verification failed for order:', razorpay_order_id)
    return res.status(400).json({ error: 'Signature verification failed. The transaction may be spoofed.' })
  }

  // A valid signature only proves the order/payment pair is genuine — it does not
  // prove the caller is who paid, and it says nothing at all about WHICH PLAN was
  // paid for. Both facts live in the order's own notes, set server-side at creation
  // time in create-order.ts, so both are cross-checked here.
  //
  // The plan check is not defensive tidiness. Without it `planType` was taken
  // straight from the request body and fed to planDurationDays() below, while the
  // amount had already been fixed at order-creation time — so buying the ₹31
  // monthly plan and then re-posting the same genuine order_id/payment_id/signature
  // with planType:'annual' bought 365 days for ₹31. The signature stays valid
  // because it covers only `order_id|payment_id`; nothing in it binds the plan.
  //
  // The money-has-moved check is deliberately TOLERANT, and that is not laziness.
  //
  // `order.status === 'paid'` is only reached once the payment is CAPTURED. On a
  // Razorpay account set to manual capture — an account-level dashboard setting
  // this code cannot see, and which nothing here pins — a genuine successful
  // payment leaves the payment `authorized` and the order still `attempted`.
  // Refusing on that would reject real paying customers and hand them an error
  // after their money left, which is far worse than the narrow case a strict
  // check would catch.
  //
  // So: `paid` passes immediately; anything else falls back to the payment
  // entity, where `captured` and `authorized` both mean the customer really paid.
  // Only a genuinely failed/pending payment is refused.
  let order: any;
  try {
    order = await razorpay.orders.fetch(razorpay_order_id)
    const notes = order.notes as Record<string, string> | undefined
    if (notes?.userId !== userId) {
      console.error('Order/user mismatch for order:', razorpay_order_id)
      return res.status(403).json({ error: 'This payment does not belong to the authenticated account.' })
    }
    if (notes?.planType !== planType) {
      console.error(
        `Order/plan mismatch for order ${razorpay_order_id}: paid for "${notes?.planType}", claimed "${planType}"`
      )
      return res.status(400).json({ error: 'This payment was made for a different plan.' })
    }

    if (order.status !== 'paid') {
      const payment = await razorpay.payments.fetch(razorpay_payment_id)
      if (payment?.status !== 'captured' && payment?.status !== 'authorized') {
        console.error(
          `Order ${razorpay_order_id} not paid (order: ${order.status}, payment: ${payment?.status})`
        )
        return res.status(400).json({ error: 'This payment has not completed.' })
      }
      console.warn(
        `Order ${razorpay_order_id} is "${order.status}" but payment ${razorpay_payment_id} is "${payment.status}" — accepting.`
      )
    }
  } catch (error: any) {
    console.error('Error fetching Razorpay order for verification:', error)
    return res.status(400).json({ error: 'Could not verify order ownership.' })
  }

  // Derived from the order's own notes, never from the request body — the body is
  // exactly what the check above exists to distrust.
  const durationDays = planDurationDays(order.notes.planType)

  try {
    // The expiry is computed in the DATABASE, not here. Two reasons, both of
    // which bit:
    //
    // 1. This used to write `now() + durationDays` absolutely, so a customer
    //    renewing with two months left lost those two months. The new expiry
    //    extends from GREATEST(now(), current expiry) instead.
    //
    // 2. Which is only safe if the same payment cannot be credited twice — and
    //    this endpoint is NOT the only writer. webhook.ts fires for the same
    //    order, and Razorpay retries webhooks. While both sides wrote the same
    //    absolute date that was harmless; additive, it would grant a second
    //    period per delivery. apply_plan_purchase() folds the "has this order
    //    already been applied to this profile" check into the same UPDATE that
    //    does the extending, so concurrent callers serialise on the profile row
    //    rather than both reading "not yet applied". See supabase/035.
    const { data: result, error } = await supabaseAdmin.rpc('apply_plan_purchase', {
      p_user_id: userId,
      p_plan_type: planType,
      p_duration_days: durationDays,
      p_order_id: razorpay_order_id,
    })

    if (error) throw error
    // NULL means no profile row matched. Without this check a missing profile
    // would silently report payment success while granting nothing.
    if (!result) {
      console.error('Plan purchase matched no profile row for userId:', userId, 'order:', razorpay_order_id)
      throw new Error('No matching profile found to update.')
    }

    // 'queued' means the customer paid for a plan that starts later — a
    // renewal or a downgrade. The response must say so, or the UI will report
    // an active plan that has not actually changed.
    const outcome = result.outcome as string
    const subscription_expires_at = new Date(result.expires_at as string).toISOString()
    const pendingActivatesAt = result.pending_activates_at
      ? new Date(result.pending_activates_at as string).toISOString()
      : null

    // Record the receipt. Fire-and-forget on purpose: the subscription is
    // already granted above, and a bookkeeping failure must not tell a paying
    // customer their payment failed. The unique index on razorpay_order_id
    // makes this safe when webhook.ts fires for the same order — the duplicate
    // simply loses.
    await supabaseAdmin
      .from('payments')
      .insert({
        user_id: userId,
        razorpay_order_id,
        razorpay_payment_id,
        plan_type: planType,
        // Razorpay reports paise; payments.amount_inr holds rupees.
        amount_inr: typeof order?.amount === 'number' ? order.amount / 100 : 0,
        source: 'razorpay',
        status: 'captured',
      })
      .then(({ error: paymentError }: { error: { code?: string; message?: string } | null }) => {
        if (paymentError && paymentError.code !== '23505') {
          console.warn('Failed to record payment for order', razorpay_order_id, paymentError.message)
        }
      })

    return res.status(200).json({
      success: true,
      // "Subscription activated successfully" is a lie for a queued purchase —
      // the customer paid for a plan that starts later, and the page must not
      // tell them their plan just changed.
      // Three outcomes, three messages. 'already_applied' — the same order
      // delivered twice, which happens whenever the webhook and the browser
      // both report a payment — used to fall into the queued wording and tell
      // a customer whose plan was ALREADY RUNNING that it starts later.
      message:
        outcome === 'activated'
          ? 'Subscription activated successfully.'
          : outcome === 'already_applied'
            ? 'This payment was already applied to your account.'
            : 'Payment received. Your new plan starts when your current one ends.',
      expiresAt: subscription_expires_at,
      outcome,
      pendingActivatesAt,
    })
  } catch (error: any) {
    console.error('Error updating profile in Supabase:', error)
    return res.status(500).json({ error: error.message || 'Database update failed' })
  }
}
