import crypto from 'crypto'
import { PLAN_DURATION_DAYS } from './pricing.js'

/** Verifies an HMAC-SHA256 signature using a timing-safe comparison. */
export function verifyHmacSignature(payload: string, secret: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const signatureBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== signatureBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, signatureBuf)
}

/** The only paid plans that exist: monthly and yearly. There is no lifetime tier. */
export type PlanType = 'monthly' | 'annual'

/** Subscription length in days for each plan type. */
export function planDurationDays(planType: PlanType): number {
  return planType === 'annual' ? PLAN_DURATION_DAYS.annual : PLAN_DURATION_DAYS.monthly
}
