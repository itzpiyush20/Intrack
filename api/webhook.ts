import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { captureError } from './_lib/monitoring.js'
import { verifyHmacSignature, planDurationDays } from './_lib/razorpaySignature.js'
import { planTypeForPlanId, durationDaysFor } from './_lib/subscriptionPlans.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

async function getRawBody(readable: any): Promise<string> {
  const chunks = []
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const isHosted = process.env.VERCEL === '1'
  const keyId = [process.env.RAZORPAY_KEY_ID, process.env.VITE_RAZORPAY_KEY_ID]
    .find(k => k && k.startsWith('rzp_')) || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || ''
  if (isHosted && keyId.startsWith('rzp_test_')) {
    console.error('Security alert: Webhook processing blocked using test keys in hosted environments.')
    return res.status(400).json({ error: 'Test payments are not allowed in hosted environments.' })
  }

  try {
    const rawBody = await getRawBody(req)
    const signature = req.headers['x-razorpay-signature'] as string

    if (!signature) {
      return res.status(400).json({ error: 'Missing webhook signature' })
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || ''
    if (!verifyHmacSignature(rawBody, secret, signature)) {
      console.error('Razorpay Webhook signature verification failed')
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const event = JSON.parse(rawBody)

    if (event.event === 'order.paid') {
      const orderEntity = event.payload.order.entity

      // There is no "already processed, skip" early return here any more. The
      // SELECT-then-UPDATE it was built from could not be made safe (see the
      // note further down), and it was also wrong in a quieter way: it matched
      // the order id against ANY profile rather than THIS user's, so it read as
      // a global "has this order ever been seen" flag. Idempotency now lives in
      // apply_plan_purchase(), and the duplicate `payments` insert below is
      // already handled by the unique index on razorpay_order_id.
      const orderId = orderEntity.id as string
      const { userId, planType } = orderEntity.notes || {}

      if (!userId || !planType) {
        console.warn('Webhook order.paid missing userId or planType in notes')
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      const durationDays = planDurationDays(planType)

      // The expiry is computed in the DATABASE. Renewing now EXTENDS from
      // GREATEST(now(), current expiry) instead of overwriting with
      // now() + duration, which used to delete whatever time a customer had
      // left when they renewed early.
      //
      // That change is only safe because the same payment cannot be credited
      // twice, and this handler is the reason it could be: verify-payment.ts
      // fires for the same order from the browser, and Razorpay retries this
      // webhook until it is acknowledged. The idempotency check that used to
      // live here — SELECT the profile by razorpay_order_id, then UPDATE if
      // nothing came back — was two statements, so two deliveries arriving
      // together both read "not processed" and both would have credited.
      // apply_plan_purchase() folds the check into the same UPDATE that
      // extends, so the second caller blocks on the row and then sees the
      // order id the first one wrote. See supabase/035.
      const { data: result, error } = await supabaseAdmin.rpc('apply_plan_purchase', {
        p_user_id: userId,
        p_plan_type: planType,
        p_duration_days: durationDays,
        p_order_id: orderId,
      })

      if (error) throw error
      if (!result) {
        console.error('Webhook plan purchase matched no profile row for userId:', userId, 'order:', orderId)
        throw new Error('No matching profile found to update.')
      }
      console.log(`Webhook applied order ${orderId} for user ${userId}: ${result.outcome}`)

      // Record the receipt. The unique index on razorpay_order_id means the
      // race with verify-payment.ts — both fire for the same order — leaves
      // exactly one row, whichever arrives first.
      await supabaseAdmin
        .from('payments')
        .insert({
          user_id: userId,
          razorpay_order_id: orderId,
          razorpay_payment_id: null,
          plan_type: planType,
          // Razorpay reports paise; payments.amount_inr holds rupees.
          amount_inr: typeof orderEntity?.amount === 'number' ? orderEntity.amount / 100 : 0,
          source: 'razorpay',
          status: 'captured',
          // See the note in verify-payment.ts: 'queue_extended' marks a double
          // charge the operator needs to see. supabase/041.
          outcome: result.outcome,
        })
        .then(({ error: paymentError }: { error: { code?: string; message?: string } | null }) => {
          if (paymentError && paymentError.code !== '23505') {
            console.warn('Webhook failed to record payment for order', orderId, paymentError.message)
          }
        })
    }

    if (event.event === 'subscription.charged') {
      const sub = event.payload.subscription.entity
      const payment = event.payload.payment?.entity
      const { userId } = sub.notes || {}

      if (!userId) {
        console.warn('Webhook subscription.charged missing userId in notes')
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      // Never guess a plan. An unrecognised plan id means someone else's plan
      // or a plan created outside this app, and granting a period for it would
      // hand out access nobody paid us for.
      const planType = planTypeForPlanId(sub.plan_id)
      if (!planType) {
        console.warn('Webhook subscription.charged for unknown plan:', sub.plan_id)
        return res.status(200).json({ status: 'ignored_unknown_plan' })
      }

      // The invoice id is the idempotency key: Razorpay retries this webhook
      // until acknowledged, and each cycle has exactly one invoice.
      const invoiceId = payment?.invoice_id
      if (!invoiceId) {
        console.warn('Webhook subscription.charged missing invoice id for', sub.id)
        return res.status(200).json({ status: 'ignored_missing_invoice' })
      }

      const { data: result, error } = await supabaseAdmin.rpc('apply_subscription_charge', {
        p_user_id: userId,
        p_subscription_id: sub.id,
        p_invoice_id: invoiceId,
        p_plan_type: planType,
        p_duration_days: durationDaysFor(planType),
        // Razorpay reports paise; amount_inr holds rupees.
        p_amount_inr: typeof payment?.amount === 'number' ? payment.amount / 100 : 0,
      })

      if (error) throw error
      if (!result) {
        console.error('Subscription charge matched no profile for userId:', userId, 'sub:', sub.id)
        throw new Error('No matching profile found to update.')
      }
      console.log(`Webhook applied ${invoiceId} for user ${userId}: ${result.outcome}`)
    }

    // 'halted' is NOT a cancellation. Razorpay has exhausted its auto-charge
    // retries, but the mandate is still alive and the customer can revive it by
    // authenticating a new card from the email Razorpay already sent them.
    // Unlinking here would make the app forget a subscription that can still
    // charge, so the failure is recorded as a flag instead and Settings shows
    // it. The flag clears itself on the next successful charge.
    //
    // Nothing is revoked either way: the period already paid for runs to its
    // end date and then lapses on its own.
    if (event.event === 'subscription.halted') {
      const sub = event.payload.subscription.entity
      const { userId } = sub.notes || {}
      if (!userId) {
        console.warn('Webhook subscription.halted missing userId in notes')
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      const { error } = await supabaseAdmin.rpc('mark_subscription_halted', {
        p_user_id: userId,
        p_subscription_id: sub.id,
      })
      if (error) throw error
      console.log(`Webhook flagged halted subscription ${sub.id} for user ${userId}`)
    }

    // Cancellation is terminal at Razorpay — a cancelled subscription cannot be
    // restarted, so the link is dropped and a returning customer authorises a
    // fresh mandate. subscription_expires_at is deliberately untouched: the
    // customer keeps the period they paid for, which is what the Refund Policy
    // promises.
    if (event.event === 'subscription.cancelled') {
      const sub = event.payload.subscription.entity
      const { userId } = sub.notes || {}
      if (!userId) {
        console.warn('Webhook subscription.cancelled missing userId in notes')
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      const { error } = await supabaseAdmin.rpc('clear_subscription_link', {
        p_user_id: userId,
        p_subscription_id: sub.id,
      })
      if (error) throw error
      console.log(`Webhook cancelled and unlinked subscription ${sub.id} for user ${userId}`)
    }

    return res.status(200).json({ status: 'ok' })
  } catch (error: any) {
    console.error('Razorpay Webhook error:', error)
    // A webhook that 500s is retried by Razorpay, so this is not necessarily
    // lost money — but it is the highest-stakes failure in the app and the one
    // most worth knowing about without waiting for a customer to complain.
    await captureError(error, { route: 'webhook' })
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
