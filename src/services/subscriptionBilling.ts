// Browser-side client for the Razorpay Subscriptions endpoints.
//
// NOTE: deliberately not re-exported from src/services/index.ts. That barrel
// already exports a `cancelSubscription` from profiles.ts — the retired
// one-time-payment model's version, which only flips subscription_status to
// 'cancelled' in the database and never talks to Razorpay. Adding this
// module to the barrel would collide with that name. Callers must import
// this module directly: `import { cancelSubscription } from
// '@/services/subscriptionBilling'`.

export type PlanType = 'monthly' | 'annual'

async function post<T>(path: string, accessToken: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = await response.json()
  // The server's message is the useful one — it distinguishes "already
  // subscribed" from "payments are not configured". A generic string here
  // would throw that away.
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Request failed')
  }
  return data as T
}

/**
 * `startsAt` is a Unix timestamp when the customer still holds paid days and
 * the first charge is scheduled for the day those run out, or null when billing
 * starts immediately. The caller needs it to tell the customer which of the two
 * happened before they authorise anything.
 */
export function createSubscription(planType: PlanType, accessToken: string) {
  return post<{ id: string; planType: PlanType; startsAt: number | null }>(
    '/api/create-subscription',
    accessToken,
    { planType },
  )
}

export function cancelSubscription(accessToken: string) {
  return post<{ cancelled: boolean; atCycleEnd: boolean }>('/api/cancel-subscription', accessToken)
}
