# Remove what Razorpay handles

Owner directive, 2026-09-05: *"Whatever functionality can be handled directly by
Razorpay or any other payment aggregator should be removed from my app. There
should be no codebase which caters to that."* No self-issued receipts. Refunds
are Razorpay's job.

## The boundary

**Reacting to Razorpay is not duplicating Razorpay.**

Razorpay cannot write to Supabase. It cannot know whether a user still has
access. So a webhook handler that turns a charge into a paid period, or a refund
into a revoked one, is required — it is the only thing that can do that job.

The line that follows from this, and it is a clean one:

- **Money is Razorpay's.** Amounts, payment references, invoices, receipts,
  refunds, retries, mandates, dunning emails. None of it belongs in this app.
- **Entitlement is ours.** Which plan is active, when access ends, who may use
  the scanner. Razorpay cannot answer any of those.

A screen that says "Yearly plan, access until 4 September 2027" is entitlement.
The same screen showing "₹365 paid, payment ref pay_xyz" is a receipt. The first
stays. The second never gets built.

## Delete / never build

| Thing | Status | Why |
|---|---|---|
| `plans/receipts-and-billing-history.md` | **Superseded** | Its whole premise was building receipts in-app. Retained only for the competitor and policy research the policy audit cites. |
| In-app receipt with amount and payment reference | Never build | Razorpay's job |
| In-app billing history | Never build | Razorpay's dashboard and its customer emails hold this |
| `api/refund.ts`, refund-request UI, pro-rata calculator | Never build | Refunds are issued in the Razorpay dashboard |
| The receipt-shaped details on `/payment-success` | Trim to entitlement only | Keep plan and access-until; never add amount or reference |

## Delete once Subscriptions ships

Razorpay Subscriptions handles renewal, upgrade, downgrade and proration
natively. That makes the entire one-time queue machinery redundant:

| Thing | Why it goes |
|---|---|
| `profiles.pending_plan_type`, `pending_duration_days`, `pending_order_id`, `pending_activates_at` | The queue exists because nothing renewed. Razorpay now schedules the next period. |
| `activate_pending_plan()` (035) and its carve-out in the guard trigger | Nothing left to activate |
| The `PLAN_ALREADY_QUEUED` 409 in `api/create-order.ts` | No queue to collide with |
| `apply_plan_purchase()`'s `queued` and `queue_extended` branches | Both are one-time semantics |
| `supabase/041`'s double-charge review, `admin_charges_needing_review()`, `src/pages/admin/RefundReviewCard.tsx` | `queue_extended` cannot occur without a queue. **This deletes the duplicate-charge problem rather than solving it.** |
| `api/create-order.ts`, `api/verify-payment.ts` | Replaced by `create-subscription` + webhook. Keep until no profile holds a one-time period. |

That is a large amount of hardened, subtle code retired — and it is retired
because the aggregator does the job, not because it was wrong.

## Must stay

- **Webhook handlers.** `subscription.charged`, `subscription.cancelled`,
  `subscription.halted`, and a new `refund.processed`. These are the reaction,
  not the duplication.
- **Entitlement columns** on `profiles` and everything gating on them.
- **`payments` rows for promo grants** (`source = 'promo'`). Razorpay has no
  record of a free grant, so this is not duplication. Razorpay-sourced rows can
  go once nothing reads them.
- **Admin grant/revoke tooling.** Operator actions Razorpay knows nothing about.

## The one refund defect that is still ours

Refunding in the Razorpay dashboard returns the money and leaves the plan
running. Razorpay cannot fix that — it does not control access.

Fix: subscribe to `refund.processed`, look the payment up, end the access it
paid for. That is roughly thirty lines and it is not a refund system. It is the
app reacting to a refund that happened elsewhere.

**Sequencing caveat:** Razorpay's automated receipts are currently enabled only
for Payment Links, and this app uses Standard Checkout — so today customers
receive nothing. Removing receipt plans is right, but confirm Razorpay actually
sends something once Subscriptions is live, or the outcome is no receipt from
anyone.
