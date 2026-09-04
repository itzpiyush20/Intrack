# Subscription & auto-renewal ruleset

Decided by the owner on 2026-09-04. This document is the ruleset only — **no code has
been written and none should be until this is scheduled.** Position in the queue: *next
after the current queue* (items 3–9 and the balances block).

This **supersedes** the 2026-08-16 decision that auto-renewal is deferred until "some
serious users come". The owner reopened it deliberately: renewal is the revenue.

It does **not** supersede the 2026-08-18 plan-change rules wholesale — see *Deferred*.

## What exists today

- One-time payments only. `api/create-order.ts` uses the Razorpay **Orders** API. No plan
  id, no mandate, `razorpay_subscription_id` is never written.
- `api/webhook.ts` handles exactly one event: `order.paid`.
- `api/verify-payment.ts` accepts `captured` **or** `authorized` on purpose — Razorpay is
  on automatic capture with a 12-minute authorisation window. **Never tighten this.**
- Five user-facing places promise in writing that nothing renews and no mandate is placed:
  `src/pages/PricingPage.tsx:112`, `PricingPage.tsx:495`,
  `src/pages/PaymentSuccessPage.tsx:146`, `src/pages/RefundPage.tsx:36`,
  `src/pages/TermsPage.tsx:53`. Two of those are legal copy.

## Settled rules

### 1. Both payment paths are offered

One-time purchase stays available alongside auto-renew. The subscription is the
**pre-selected, visually dominant choice**, with copy that inclines the user towards it.
One-time is not removed.

### 2. Price at renewal is the prevailing rate

A running paid term is never repriced. When the renewal date arrives — monthly or annual
— the debit is at whatever the rate is **on that date**, not the rate originally paid.
No grandfathering past the current term. The pre-debit notice must state the new amount.

### 3. Existing one-time customers are untouched

Their access runs exactly as sold. At their renewal date they are shown both options
again, with the subscription offered at current rates.

### 4. The trial stays card-free

No mandate is required to start or run the 7-day trial. The mandate is set up when the
user chooses to subscribe.

**Blocking dependency:** the trial-expiry flow is broken today. `ProtectedRoute` sends
every user without an active subscription to `/pricing`, so the "manual entry stays free
after the trial" promise on the pricing page cannot be used by anyone. That is queue item
9, and the owner identified it as the issue that must be examined as part of this flow.
Billing work must not ship on top of a trial exit that does not work.

### 5. Failed debit — 3-day grace, aligned to Razorpay

Razorpay's retry schedule for cards and UPI is a **T+3 cycle**: charge day is T=0, with
reattempts on T+1, T+2 and T+3. After the T+3 failure the subscription moves to `halted`.
(E-mandate retries differently — only as bank confirmations arrive, shifting to T-1 or
T-3 around bank holidays.)

Access grace is therefore **3 days, ending exactly when Razorpay halts**. No window
exists where a customer is locked out while a paid-for retry is still pending. This
revises the owner's initial 2-day figure, chosen before the retry schedule was known.

The **mandate survives failure.** In `halted`, invoices keep generating, no auto-charge is
attempted, and the skipped invoice stays chargeable via *Attempt Charge* without consuming
retries. Fixing the payment method returns the subscription to `active`. Past charges are
never re-attempted once active — only future cycles.

### 6. Cancellation — access to the end of the paid period

The mandate stops; access runs to the date already paid for. No immediate cutoff, no
refund of unused time.

Note: customers can pause or revoke a UPI Autopay mandate from their UPI app at any time
and the merchant cannot override that. The app must handle a mandate revoked outside it.

### 7. No refunds on a renewal charge

The RBI-mandated 24-hour pre-debit notification is the warning, and it is sufficient.
"I forgot to cancel" is not grounds for a refund. This must be stated explicitly in the
Refund policy.

### 8. Pre-debit notification — Razorpay's, plus our own email

The 24-hour notice is a shared obligation between merchant and aggregator; the bank or
UPI app also notifies. Razorpay ships configurable pre-debit notification flows, so the
regulatory notice is not built in-house.

A **branded email is sent in addition**, because rule 2 means the amount can differ from
what the customer last paid. The notice must carry amount, date and mandate reference.

### 9. Legal and marketing copy — all five places rewritten

Every "nothing renews / no mandate" claim comes out. Terms gains mandate, renewal,
cancellation and price-revision clauses. Refund states plainly that renewal charges are
not refundable. **This is a hard blocker before any mandate goes live.**

## Deferred — do not treat as settled

- **Pricing rework.** ₹31 with gateway fees is a thin margin and the owner flagged the
  loss risk explicitly. Revisit before launch; several decisions below depend on it.
- **Upgrade rule under a mandate.** Today monthly→annual resets the expiry and drops
  remaining paid days. The owner reopened this and then postponed the decision. Note the
  reason it needs revisiting: with automatic billing the customer no longer controls the
  timing of the forfeiture.
- **Downgrade rule.** Bundled with the upgrade decision.
- **Coupon × subscription interaction.** The new-customer-only, once-per-account, 30-day
  coupon has no defined behaviour when the account then subscribes.
- **Which rails.** "Offer both" settled one-time vs auto-renew, not UPI Autopay vs card
  e-mandate vs both. Unasked and open. UPI Autopay is the obvious fit for a ₹31 ticket;
  confirm against Razorpay's actual rate card rather than assumption.

## Implementation notes for whoever builds this

- Razorpay **Subscriptions** API, not Orders — plan ids, `subscription.charged`,
  `subscription.pending`, `subscription.halted`, `subscription.cancelled` webhooks. The
  existing `order.paid` handler stays for the one-time path.
- `razorpay_subscription_id` already exists on `profiles` in `schema.sql`. Per the repo
  convention, confirm it exists in **production** before relying on it — a column present
  only in `schema.sql` has broken `UPDATE`s on `profiles` twice before.
- Two billing paths now coexist permanently. Every subscription-state check must not
  break the one-time path, and vice versa.
- The 2026-08-18 queueing machinery (`activate_pending_plan()`, pending-plan blocking)
  was designed for manual renewal. Its interaction with an active mandate is undefined
  until the deferred upgrade/downgrade rules are settled.
