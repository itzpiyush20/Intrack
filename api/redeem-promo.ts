import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  normalisePromoCode,
  checkRedeemable,
  checkCouponEligibility,
  grantExpiryFrom,
  type PromoCodeRow,
} from './_lib/promo.js'

// ============================================
// Redeem a promo code.
//
// This exists because the browser cannot be trusted with either half of the
// job. Codes used to be checked against VITE_PROMO_CODES, which ships inside
// the public JavaScript bundle — anyone could read the valid codes. And the
// grant only ever reached localStorage, because the
// protect_server_only_profile_columns trigger (correctly) refuses subscription
// writes from a user session, so a redeemed coupon vanished on another device.
//
// Here the code is matched against the database and the grant is written with
// the service-role key, which the trigger permits.
// ============================================

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  // Tighter than the payment endpoint: guessing codes is the attack here, and
  // 5 attempts a minute makes brute force pointless.
  if (entry.count >= 5) return true
  entry.count++
  return false
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

const REFUSAL_MESSAGE: Record<string, string> = {
  not_found: 'Invalid or expired coupon code.',
  inactive: 'This coupon is no longer active.',
  expired: 'This coupon has expired.',
  exhausted: 'This coupon has reached its usage limit.',
  already_redeemed: 'You have already used this coupon.',
  // Both of these are permanent for the account, so the wording must not
  // suggest waiting and trying again will help.
  not_new_customer: 'Coupons are for first-time users only. Your account has had a paid plan before.',
  coupon_already_used: 'You have already used a coupon on this account. Only one coupon per account.',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' })
  }

  // The account is taken from the token, never from the request body.
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const rawCode = (req.body ?? {}).code
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    return res.status(400).json({ error: 'Coupon code is required.' })
  }
  const code = normalisePromoCode(rawCode)

  try {
    const { data: promo } = await supabaseAdmin
      .from('promo_codes')
      .select('code, plan_type, duration_days, active, max_uses, used_count, expires_at')
      .eq('code', code)
      .maybeSingle()

    // Every redemption this account has ever made, for ANY code — not just
    // this one. The UNIQUE (code, user_id) constraint only stops re-using the
    // same code, so one-coupon-per-account has to be enforced here.
    const { data: redemptions } = await supabaseAdmin
      .from('promo_redemptions')
      .select('code')
      .eq('user_id', user.id)

    // A real payment, ever. Restricted to source 'razorpay' on purpose:
    // 'promo' rows are written by this very endpoint (so counting them would
    // make every coupon self-disqualifying) and 'admin' rows are hand-granted
    // plans where no money changed hands.
    const { data: paidRows } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('user_id', user.id)
      .eq('source', 'razorpay')
      .eq('status', 'captured')
      .limit(1)

    const priorRedemptions = redemptions || []
    const ineligible = checkCouponEligibility({
      hasPaidBefore: (paidRows || []).length > 0,
      hasRedeemedAnyCoupon: priorRedemptions.length > 0,
    })
    if (ineligible) {
      return res.status(400).json({ error: REFUSAL_MESSAGE[ineligible] })
    }

    const alreadyRedeemedThisCode = priorRedemptions.some((r: { code: string }) => r.code === code)
    const refusal = checkRedeemable(promo as PromoCodeRow | null, alreadyRedeemedThisCode)
    if (refusal) {
      // Deliberately vague on not_found so the endpoint cannot be used to
      // discover which codes exist.
      return res.status(400).json({ error: REFUSAL_MESSAGE[refusal] })
    }

    const row = promo as PromoCodeRow

    // Claim the redemption FIRST. UNIQUE (code, user_id) is what makes two
    // simultaneous requests — a double-clicked button — grant only once.
    const { error: claimError } = await supabaseAdmin
      .from('promo_redemptions')
      .insert({ code, user_id: user.id })

    if (claimError) {
      if (claimError.code === '23505') {
        return res.status(400).json({ error: REFUSAL_MESSAGE.already_redeemed })
      }
      throw claimError
    }

    const expiresAt = grantExpiryFrom(row.duration_days)

    const { data: updated, error: grantError } = await supabaseAdmin
      .from('profiles')
      .update({
        subscription_status: 'active',
        subscription_expires_at: expiresAt,
        subscription_plan_type: row.plan_type,
        promo_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select('id')

    if (grantError) throw grantError
    if (!updated || updated.length === 0) {
      // No profile row matched. Release the claim so the user can retry once
      // their profile exists, rather than being locked out of the code.
      await supabaseAdmin.from('promo_redemptions').delete().eq('code', code).eq('user_id', user.id)
      throw new Error('No matching profile found to update.')
    }

    // Bookkeeping past this point must never fail the redemption — the user
    // already has their access.
    await supabaseAdmin
      .from('promo_codes')
      .update({ used_count: row.used_count + 1 })
      .eq('code', code)
      .then(({ error }) => { if (error) console.warn('Failed to increment promo used_count:', error.message) })

    await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.id,
        plan_type: row.plan_type,
        amount_inr: 0,
        source: 'promo',
        promo_code: code,
        status: 'captured',
      })
      .then(({ error }) => { if (error) console.warn('Failed to record promo grant in payments:', error.message) })

    return res.status(200).json({
      success: true,
      planType: row.plan_type,
      durationDays: row.duration_days,
      expiresAt,
    })
  } catch (error) {
    console.error('Promo redemption failed for code', code, error)
    return res.status(500).json({ error: 'Could not redeem this coupon. Please try again.' })
  }
}
