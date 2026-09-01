import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  normalisePromoCode,
  validateNewPromoCode,
  canDeletePromoCode,
  grantExpiryFrom,
} from './_lib/promo.js'

// ============================================
// Every admin write, behind one function.
//
// Coupon management and subscription operations were originally two files.
// Vercel's Hobby plan allows 12 serverless functions and the project had
// reached 13, so every deployment failed. Merging them is not cosmetic — it is
// what makes the project deployable.
//
// GET                      list coupons
// POST { action: ... }     create | set_active | delete   (coupons)
//                          grant  | expire                (subscriptions)
//
// The admin gate is applied ONCE, here, before any action runs: the caller's
// id comes from their token and profiles.is_admin is re-read from the database.
// The browser claiming to be an admin means nothing.
//
// This cannot set is_admin. Granting admin stays a manual SQL step by design.
// ============================================

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'

/**
 * ALLOWED_ORIGIN may carry several comma-separated hosts, so a domain move can
 * serve the old and the new origin at once instead of cutting over in one
 * breaking step. Same parsing as api/gemini-proxy.ts.
 */
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

// Capped so a typo cannot recreate the hundred-year "lifetime" subscription
// this whole line of work started with.
const MAX_GRANT_DAYS = 365

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // The gate. Everything past this line assumes a verified admin.
  const { data: caller, error: callerError } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (callerError || !caller?.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' })
  }

  try {
    // ── Coupons: list ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // Expired codes drop out of the list on their own. The rows stay in the
      // database so the history of what was offered survives.
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .select('code, plan_type, duration_days, active, max_uses, used_count, note, created_at, expires_at')
        // The timestamp is quoted because PostgREST splits an or() filter on
        // dots, and an ISO timestamp is full of them (2026-08-15T21:40:00.000Z).
        .or(`expires_at.is.null,expires_at.gt."${new Date().toISOString()}"`)
        .order('created_at', { ascending: false })

      if (error) throw error
      return res.status(200).json({ codes: data ?? [] })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const { action } = req.body ?? {}

    // ── Coupons: create ───────────────────────────────────────────────────
    if (action === 'create') {
      const { code: rawCode, durationDays, maxUses, planType, note } = req.body ?? {}

      if (typeof rawCode !== 'string') return res.status(400).json({ error: 'Code is required.' })

      const days = Number(durationDays)
      const uses = maxUses === null || maxUses === undefined || maxUses === '' ? null : Number(maxUses)

      const problem = validateNewPromoCode({ code: rawCode, durationDays: days, maxUses: uses })
      if (problem) return res.status(400).json({ error: problem })

      if (planType !== undefined && planType !== 'monthly' && planType !== 'annual') {
        return res.status(400).json({ error: 'Plan must be monthly or annual.' })
      }

      // How long the CODE stays redeemable, as opposed to durationDays, which
      // is how long the access it grants lasts.
      const validForDays = req.body?.codeValidDays
      let codeExpiresAt: string | null = null
      if (validForDays !== undefined && validForDays !== null && validForDays !== '') {
        const validDays = Number(validForDays)
        if (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650) {
          return res.status(400).json({ error: 'Code validity must be a whole number of days between 1 and 3650, or left empty to never expire.' })
        }
        codeExpiresAt = grantExpiryFrom(validDays)
      }

      const { error } = await supabaseAdmin.from('promo_codes').insert({
        code: normalisePromoCode(rawCode),
        plan_type: planType || 'monthly',
        duration_days: days,
        max_uses: uses,
        expires_at: codeExpiresAt,
        note: typeof note === 'string' && note.trim() ? note.trim() : null,
      })

      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'That code already exists.' })
        throw error
      }

      return res.status(200).json({ success: true, code: normalisePromoCode(rawCode) })
    }

    // ── Coupons: enable / disable ─────────────────────────────────────────
    if (action === 'set_active') {
      const { code: rawCode, active } = req.body ?? {}
      if (typeof rawCode !== 'string' || typeof active !== 'boolean') {
        return res.status(400).json({ error: 'Code and active flag are required.' })
      }

      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .update({ active })
        .eq('code', normalisePromoCode(rawCode))
        .select('code')

      if (error) throw error
      if (!data || data.length === 0) return res.status(404).json({ error: 'No such code.' })

      return res.status(200).json({ success: true })
    }

    // ── Coupons: delete ───────────────────────────────────────────────────
    if (action === 'delete') {
      const { code: rawCode } = req.body ?? {}
      if (typeof rawCode !== 'string') return res.status(400).json({ error: 'Code is required.' })

      // Only codes nobody has used — typos and abandoned tests. Once redeemed,
      // deleting would throw away the record of who was given free access, so
      // those are disabled instead. Checked here because the UI is not a gate.
      const { data: existing } = await supabaseAdmin
        .from('promo_codes')
        .select('used_count')
        .eq('code', normalisePromoCode(rawCode))
        .maybeSingle()

      if (!existing) return res.status(404).json({ error: 'No such code.' })

      if (!canDeletePromoCode(existing)) {
        return res.status(400).json({
          error: 'This code has already been redeemed, so it cannot be deleted. Disable it instead — that stops anyone else using it.',
        })
      }

      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .delete()
        .eq('code', normalisePromoCode(rawCode))
        .select('code')

      if (error) throw error
      if (!data || data.length === 0) return res.status(404).json({ error: 'No such code.' })

      return res.status(200).json({ success: true })
    }

    // ── Subscriptions: grant / end ────────────────────────────────────────
    if (action === 'grant' || action === 'expire') {
      const { userId, days, planType } = req.body ?? {}

      if (typeof userId !== 'string' || !userId) {
        return res.status(400).json({ error: 'A target account is required.' })
      }

      // An admin granting themselves access makes the audit trail meaningless.
      if (userId === user.id) {
        return res.status(400).json({ error: 'You cannot change your own subscription here.' })
      }

      if (action === 'grant') {
        const grantDays = Number(days)
        if (!Number.isInteger(grantDays) || grantDays < 1 || grantDays > MAX_GRANT_DAYS) {
          return res.status(400).json({ error: `Days must be a whole number between 1 and ${MAX_GRANT_DAYS}.` })
        }
        if (planType !== 'monthly' && planType !== 'annual') {
          return res.status(400).json({ error: 'Plan must be monthly or annual.' })
        }

        // The expiry is computed in the DATABASE, for the same reason
        // verify-payment.ts computes it there: this used to write
        // `now() + grantDays` absolutely, so granting a goodwill 30 days to
        // someone holding 300 paid days left them with 30 and destroyed the
        // time they had paid for. admin_grant_subscription() extends from
        // GREATEST(now(), current expiry), which also does the right thing for
        // a lapsed account — 30 days from today, not from an expiry already in
        // the past. See supabase/040.
        //
        // The admin panel spec scoped this phase as "grant/extend plans"
        // (docs/superpowers/specs/2026-08-15-admin-panel-design.md); only the
        // grant half was ever implemented.
        const { data: grantResult, error } = await supabaseAdmin.rpc('admin_grant_subscription', {
          p_user_id: userId,
          p_plan_type: planType,
          p_duration_days: grantDays,
        })

        if (error) throw error
        // NULL means no profile row matched, the same contract
        // apply_plan_purchase uses. Without this check a missing account would
        // report a successful grant while granting nothing.
        if (!grantResult) return res.status(404).json({ error: 'No such account.' })

        const expiresAt = new Date(grantResult.expires_at as string).toISOString()

        // Auditable: who got free access, when, and for how long.
        await supabaseAdmin
          .from('payments')
          .insert({
            user_id: userId,
            plan_type: planType,
            amount_inr: 0,
            source: 'admin',
            status: 'captured',
          })
          .then(({ error: paymentError }: { error: { message?: string } | null }) => {
            if (paymentError) console.warn('Failed to record admin grant in payments:', paymentError.message)
          })

        // `extended` lets the panel say "extended to" rather than implying the
        // account was empty before the grant.
        return res.status(200).json({
          success: true,
          email: grantResult.email,
          expiresAt,
          extended: grantResult.extended === true,
        })
      }

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'expired',
          subscription_expires_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id, email')

      if (error) throw error
      if (!data || data.length === 0) return res.status(404).json({ error: 'No such account.' })

      return res.status(200).json({ success: true, email: data[0].email })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (error) {
    console.error('Admin operation failed:', error)
    return res.status(500).json({ error: 'Operation failed. Please try again.' })
  }
}
