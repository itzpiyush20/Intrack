# Refund policy — final draft

Owner decision, 2026-09-05. One published promise, nothing else committed to.

> **Contact us within 7 days of a charge and we will refund it in full.**

No pro-rata. No period-length threshold. No conditions to check, no arithmetic.
Anything beyond 7 days is decided case by case and is deliberately **not**
published — that keeps the freedom to refund a forgotten renewal without having
promised it to everyone.

Price-independent by construction: "in full" carries no number, so ₹31 or ₹1,999
reads identically.

Earlier drafts of a two-rule pro-rata scheme were considered and rejected as
over-engineered. Do not reintroduce them.

---

## Customer-facing text

### 1. What you are buying

Intrack subscriptions renew automatically. You choose a billing period when you
subscribe, and at the end of each period your subscription renews and you are
charged again, until you cancel.

Before every charge you receive a notification at least 24 hours in advance,
showing the amount and the date, with the option to cancel. Your bank sends its
own alert as well. You are never charged without warning.

### 2. Cancelling

You can cancel at any time from Settings → Plan & Billing. No reason is needed
and there is no cancellation fee.

Cancelling stops future charges. It does not end your current period — you keep
full access until the period you have already paid for runs out, and then access
stops. Your data is retained, so subscribing again later restores everything as
you left it.

### 3. Refunds

If you contact us within 7 days of a charge, we will refund that charge in full.
No reason is needed. This applies to your first payment and to every renewal, on
every plan.

The 7 days is counted from when you contact us, not from when we reply. If you
write to us on day six and we answer on day nine, you are still within the
window.

When a refund is issued your subscription is cancelled and your access ends. You
do not need to cancel separately, and you will not be charged again.

After 7 days we do not offer refunds as a rule, but if something has gone wrong,
write to us anyway and we will look at it.

### 4. How refunds reach you

Refunds are processed through Razorpay, our payment provider, and are returned
to the original payment method — the same card, UPI ID, or bank account you paid
from.

Refunds usually take five to seven business days to appear on your statement, in
line with standard banking timelines.

### 5. Before you contact your bank

If something looks wrong with a charge, please contact us first. We can almost
always resolve it faster than a bank dispute can, and refunds we issue directly
reach you sooner.

Contact: {SUPPORT_EMAIL}. We respond to billing queries within {SLA}.

---

## What this replaces

The current `src/pages/RefundPage.tsx` §3 has three conditional clauses. All
three go:

- *"Accidental Subscription Upgrades ... have not used the parsing service since
  upgrading ... within forty-eight (48) hours"* — required checking scan logs per
  claim, and a 48-hour window shorter than the published support response time.
- *"Technical Failures ... unable to resolve the issue within three (3) business
  days"* — a dated engineering SLA committed by a one-person operation.
- *"Duplicate Billings ... refunded in full"* — a promise with no mechanism
  behind it. Under Razorpay Subscriptions the duplicate-charge case
  (`queue_extended`) stops existing at all, so the clause has nothing to cover.

§2's *"Access you have already paid for is never withdrawn early"* also has to
change: a refund now ends access, and the Terms need a termination right for
breach. See `plans/policy-audit-and-industry-standard.md`.

---

## Open before publishing

- **Do not publish until Razorpay confirms Subscriptions is available on the
  account.** Section 1 describes auto-renewal; the live policy currently promises
  the opposite.
- `{SLA}` needs a number that can actually be sustained. Currently published as
  24 to 48 hours. It must stay comfortably under 7 days or the window and the
  promise collide.
- **Still undecided: is the refund self-serve or by email?** The policy text
  works either way — "contact us" covers a button as well as an inbox. If it
  becomes a button, an abuse guard is needed, because a human refunding by hand
  notices repeat patterns and a button does not.
- Have a lawyer read the final text. India requires a clearly disclosed refund
  policy and grievance redressal under the Consumer Protection (E-Commerce)
  Rules, 2020; this is written to satisfy that, but it is not legal advice.
