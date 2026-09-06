# Receipts and billing history

Plan, 2026-09-05. Follows `plans/payment-success-audit.md`.

The question that started this: **should the receipt be built from Razorpay's
browser callback at all — and is a receipt page necessary in the first place?**

Short answer: the callback is the wrong source, and the page as it exists today
is doing half a job. But the moment it occupies is real and should not be
deleted. The fix is to make it durable and to stop it being the only place that
information lives.

---

## 1. What exists today

**A payments table that already holds everything a receipt needs.**
`supabase/025_payments.sql` created `public.payments` with `amount_inr`,
`plan_type`, `razorpay_order_id`, `razorpay_payment_id`, `created_at`, `source`,
`status`, and (via `041`) `outcome`. It is written server-side only — there is
deliberately no INSERT policy, so nothing on it can be forged by a browser.

**A read policy for users that nothing uses.** `025` ships
`"Users can view own payments"` — *"A user may read their own receipts"*. Grep
says the only client that ever reads `payments` is the admin panel
(`src/pages/admin/RefundReviewCard.tsx`, `api/admin.ts`). **There is no
user-facing billing view anywhere in the app.** The policy has been dead since
the day it was written.

**A refund policy that asks for information the customer is never shown.**
`RefundPage` §3 grants a refund for an accidental upgrade *"within forty-eight
(48) hours of the transaction timestamp"*, and promises full refunds for
duplicate billings. The customer is shown no timestamp, no amount, and no
payment reference — not on the receipt, not afterwards, nowhere. Every one of
those refund claims currently starts with the customer and support guessing.

**A receipt page that cannot survive a refresh.** `/payment-success` is built
entirely from React Router state. Refresh, bookmark, or open it later and the
guard correctly redirects to `/pricing`, because the router state was the only
evidence the purchase happened. Correct behaviour given the design; the design
is the problem.

**A page that re-derives what the server already told it.** It polls the profile
up to six times over ~12 seconds asking whether the subscription went active —
but `api/verify-payment.ts` already returned `outcome` (`activated`,
`already_applied`, `queued`, `queue_extended`) in the response body, and the
`payments` row is written *before* that response returns. One authoritative read
replaces up to six speculative ones.

**A double charge the customer is not told about.** `queue_extended` is
described in `api/verify-payment.ts` as *"a double charge the published refund
policy says is refundable"*, and `supabase/041` flags it for operator review.
`PricingPage` handles it identically to an ordinary queued purchase — same
toast, same receipt, same wording. The admin panel knows; the person who was
charged twice does not. This is rare rather than routine — `create-order.ts`
returns 409 while a plan is already queued (`PricingPage.tsx:166-169`), so it
takes a race to reach — but it is recorded precisely because it does happen.

## 2. Is the page necessary?

The moment after payment has a job nothing else in the app can do:

- **Confirm the money arrived.** Verification is genuinely asynchronous —
  browser and webhook race — and the customer needs a definite answer.
- **Explain a queued purchase.** "You paid, and nothing changes today" is a
  surprising outcome. It needs a stable explanation, not a toast that vanishes.
- **Say when access ends.** Both plans are one-time payments with no renewal.
  That date is the thing the customer just bought.

A toast cannot do those jobs — it disappears, and the queued explanation is too
important to lose. So: keep the moment. The weakness is not that the page
exists, it is that it is ephemeral and duplicated nowhere.

## 3. Options considered

| Option | Verdict |
|---|---|
| **Keep as is, add amount from the Razorpay callback** | Rejected. Keeps the browser as the source of truth for money, and still dies on refresh. This was the original F2 suggestion and it was the wrong call. |
| **Delete the page, land on Dashboard with a banner** | Rejected. Loses the queued explanation, and a banner is not a record. |
| **Modal on PricingPage instead of a route** | Rejected. Same ephemerality, plus it cannot be linked to from an email or a support thread. |
| **Rely on Razorpay's own confirmation email** | Rejected as the sole answer. It confirms a charge, but says nothing about which Intrack plan, when access ends, or that a purchase was queued. Whether it is even enabled is a Razorpay dashboard setting this repo cannot see. Keep it as a supplement. |
| **Read from `payments`, keyed by order id in the URL, and reuse the same view as a permanent billing history** | **Recommended.** |

## 4. Recommended design

Collapse two needs into one thing rather than building them twice.

- **A receipt is a row in `payments`.** One component renders it. There is one
  data path, server-owned, un-forgeable.
- **`/payment-success?order=<id>` is that receipt with celebratory framing** —
  the checkmark, the "Subscription Activated!" heading, the queued explanation.
- **A billing view lists the same rows.** Reachable from Settings or Profile at
  any time. It activates the RLS policy that has been sitting unused since `025`
  and gives refund claims something concrete to reference.
- **Promo grants appear too.** `api/redeem-promo.ts` writes `source='promo'`
  with `amount_inr` 0, so free access becomes documented instead of invisible.
  Note these rows carry no `razorpay_order_id`; the unique index is partial
  (`WHERE razorpay_order_id IS NOT NULL`) so several are fine, but they are
  reachable only through the list, never through an order-id lookup.
- **Expiry still comes from the profile**, which is already loaded. No extra
  fetch.
- **Router state survives as a paint hint only** — it lets the first frame
  render instantly while the row loads. It stops being evidence of anything.

### Why this is also cheaper

Today: up to six profile round trips to answer a question already answered.
After: one indexed read on `(user_id, created_at DESC)`, an index `025` already
created. The polling ladder, the `attempts` counter, and the interval that
rebuilds itself every tick (audit F5) all delete.

## 5. Phases

### Phase 1 — make the payment id reliable
`api/webhook.ts:106` inserts `razorpay_payment_id: null`. When the webhook wins
the race, the browser's insert loses on the unique index with `23505` and is
swallowed, so the payment id is never recorded. Backfill it: on `23505` in
`api/verify-payment.ts`, UPDATE the row to set `razorpay_payment_id` where it is
currently NULL. Nothing user-facing changes; this only stops the receipt from
sometimes having no reference to show.

### Phase 2 — a receipt service
`getPaymentByOrderId(orderId)` and `listPayments()` in `src/services/`. Reads
`payments` under the existing RLS policy. No UI change yet; unit-tested against
the shapes both writers produce (`razorpay` and `promo`, and all four
`outcome` values).

### Phase 3 — rebuild `/payment-success` on it
- Order id moves into the URL. The page reads the row.
- Show amount paid, payment date, and reference alongside plan and expiry.
- **Fix audit F1:** render the plan name the customer actually bought. Delete
  the `Basic`/`Pro` map. Fix the same phantom names at
  `PaymentSuccessPage.tsx:175` and `AppLayout.tsx:884`.
- **Fix audit F3:** the copy says "click return"; the button says "Go to
  Dashboard".
- Delete the polling ladder, the `attempts` counter and the rebuilt interval
  (audit F4, F5).
- Handle the row-not-yet-written case gracefully — the insert is deliberately
  fire-and-forget so a bookkeeping failure cannot tell a paying customer their
  payment failed, and the page must hold that line.
- Add `document.title` (audit F7).

### Phase 4 — billing history
A list view of `listPayments()`, reachable from Settings or Profile. Same row
component as Phase 3. Each entry links to its receipt.

### Phase 5 — tell the customer about a double charge
`queue_extended` currently reads to the customer as an ordinary queued purchase.
Given `RefundPage` §3 promises a refund for duplicate billings, the receipt
should say plainly that the payment landed on an already-queued plan and that
support will review it. **Owner decision needed on the wording** — this is money
and it is a published policy commitment, so it should not be drafted silently.

### Phase 6 — verify
`npx tsc -b`, `npm test -- --run`, `npm run build`, lint delta against the
pre-change baseline on every file touched. Prove each new test fails against the
old behaviour. Browser pass over: a fresh purchase, a refresh of the receipt
URL, a queued purchase, a promo grant, and a receipt URL for an order belonging
to another account (must return nothing — RLS, not UI, is what enforces that).

Per `CLAUDE.md`: no migration is required by this plan — every column and policy
it uses already ships in `025` and `041`. If that changes, the migration runs
and its grants are verified **before** any code merges.

## 6. Open questions for the owner

1. **Where does billing history live** — a Settings section, a Profile tab, or
   its own `/billing` route?
2. **What should a `queue_extended` receipt say?** (Phase 5.)
3. **Is Razorpay's own confirmation email enabled** in the dashboard? Not
   visible from this repo, and it changes how much Phase 4 needs to carry.
4. **Should a receipt be downloadable/printable?** Without GST registration
   (owner decision, recorded) there is no tax-invoice obligation, so this is a
   convenience call, not a compliance one.
