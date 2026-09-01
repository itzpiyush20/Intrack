import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyHmacSignature, planDurationDays } from './_lib/razorpaySignature.js'

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

    return res.status(200).json({ status: 'ok' })
  } catch (error: any) {
    console.error('Razorpay Webhook error:', error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
