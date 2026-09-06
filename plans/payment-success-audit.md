# `/payment-success` audit

Read-only pass, 2026-09-05. Report only — nothing changed.

Scope: `src/pages/PaymentSuccessPage.tsx` (183 lines) read in full, plus every
edge it depends on: `src/pages/PricingPage.tsx` (the Razorpay handler that is its
only caller), `api/verify-payment.ts`, `api/webhook.ts`,
`src/context/AuthContext.tsx` (`refreshProfile`, `updateSubscriptionStatus`),
`src/components/auth/ProtectedRoute.tsx`, `src/layouts/AppLayout.tsx`.

## Context: this page has been audited before

The premise that it was never looked at is out of date. Commit `44101f1`
("fix: subscription, coupon and backup correctness…") landed five fixes here and
documented each in the file:

- typing/bookmarking `/payment-success` no longer shows a fabricated
  "Subscription Activated!" with an invented renewal date
- a queued purchase no longer announces access that has not started
- polling no longer spins for ten seconds on a queued plan that will never
  flip to `active` today
- "Renewal Date" became "Access until", because both plans are one-time payments
- the plan-label match became case-insensitive

Those fixes hold. What follows is what survived them.

---

## F1 — HIGH · the receipt prints a plan name the product does not sell

`src/pages/PaymentSuccessPage.tsx:47`

```ts
const planName = /^(monthly|starter monthly|basic)$/i.test(rawState?.planName ?? '')
  ? 'Basic'
  : 'Pro'
```

The product has exactly two plans, **Monthly** and **Yearly**
(`src/pages/PricingPage.tsx:105`). "Basic" and "Pro" appear nowhere else in the
application — a repo-wide grep returns only this file and one trial banner
(F3). They are not a tier system; they are a leftover.

So the customer's path reads:

| Step | What it says |
|---|---|
| Pricing card | Yearly |
| Razorpay sheet | "Upgrade to Yearly Plan" |
| Success toast | "Yearly features unlocked" |
| **Receipt page** | **Pro** |

Buy Monthly, the receipt says **Basic**. The one screen that functions as a
payment record is the only screen using a name the customer has never seen. It
does not read as a cosmetic label — it reads as being charged for the wrong
thing.

Not a money defect: the correct plan and duration are applied server-side by
`apply_plan_purchase()`, derived from the order's own notes and cross-checked
against the request body (`api/verify-payment.ts:126-140`). Entitlement is
correct. Only the printed label is wrong.

Fix: render `rawState.planName` directly, delete the map.

## F2 — MEDIUM · the receipt is not a receipt

The file's own comment calls it "a RECEIPT for a purchase that just happened".
It shows plan, status, and a date. It does not show:

- the amount paid
- the Razorpay payment id or order id
- the date the payment was made

A customer disputing a charge, or forwarding proof of purchase to support, has
nothing to forward. Every one of those values is already in hand at navigation
time — `paymentResponse.razorpay_payment_id` and `planPrice` are both in scope
in the handler at `src/pages/PricingPage.tsx:194-229`, and the same values are
persisted to the `payments` table by both `verify-payment.ts` and `webhook.ts`.

## F3 — LOW · phantom names in body copy, and a button that doesn't exist

`src/pages/PaymentSuccessPage.tsx:175`

> "If your Pro or Basic access doesn't unlock immediately, click return and
> refresh the page."

Two problems. Same non-existent tier names as F1. And there is no "return"
control anywhere on the page — the only button reads **Go to Dashboard**.

`src/layouts/AppLayout.tsx:884` carries the same phantom name in the trial
banner: "full Pro access".

## F4 — LOW · the verification spinner almost never verifies anything

Worth understanding before anyone trusts this safety net.

`PricingPage` calls `await updateSubscriptionStatus('active', selectedPlan)`
*before* navigating. That writes `intrack_sub_status_<uid> = 'active'` to
localStorage (`AuthContext.tsx:975-978`), and `refreshProfile` paints `profile`
from that cache before the database read returns (`AuthContext.tsx:232-251`).

So by the time this page mounts, `profile.subscription_status` is already
`'active'`, the effect takes its `else` branch, and `verifying` flips false on
the first run. The polling ladder, the `attempts` counter, and the "Status
syncing in background" fallback only execute in the narrow case where the
database read comes back non-active.

That is fine behaviour — but it means the `attempts > 5` path has most likely
never run in production, and should be treated as untested rather than proven.

## F5 — LOW · the interval is rebuilt on every tick

`src/pages/PaymentSuccessPage.tsx:52-88`. Effect deps are
`[profile, attempts, queued, hasReceipt]`; `checkStatus` calls `setAttempts`,
which changes a dep, so cleanup clears the interval and a fresh one is created
each cycle. It still polls roughly every 2s, so nothing is broken — it just is
not doing what `setInterval` implies.

Related: `checkStatus` reads `profile` from a stale closure. Harmless only
because the effect re-run replaces it. If the deps are ever trimmed to quiet
the churn, that staleness becomes a real bug.

## F6 — LOW, dev-only · absolute expiry overwrites the server's extension

`AuthContext.tsx:938-940` computes `expiresAt` as `now + 30/365 days`, ignoring
any time the customer already had.

In production this only touches localStorage, and `refreshProfile` overwrites it
from the database seconds later (`AuthContext.tsx:311-313`) — worst case a brief
flash of a shortened date in the header.

Under `import.meta.env.DEV` it writes that value **into the `profiles` row**
(`AuthContext.tsx:947-960`), overwriting the server's
`GREATEST(now(), expiry) + duration` extension. So an early renewal tested
locally loses the remaining time, and the defect does not reproduce in
production. A trap for whoever tests renewals next.

## F7 — INFO · no `document.title`

`/payment-success` is an app route (`AppLayout.tsx:104-115`) but does not set a
title. App routes do; marketing routes do not. Minor inconsistency.

## F8 — INFO · date format deviates from repo convention

`toLocaleDateString('en-IN', { day, month: 'long', year })` renders
"5 September 2026", not the repo's dd/mm/yyyy. Unambiguous, and arguably the
right call on a receipt. Noted, not recommended for change.

---

## Verified clean

Checked, and correct:

- **The fabricated-receipt guard.** No router state → redirect to `/pricing` and
  render `null`. No placeholder frame leaks.
- **The queued path.** A purchase that starts later never claims active access;
  polling is correctly skipped; wording, icon and status pill all switch.
- **The server owns the expiry.** `apply_plan_purchase()` extends from
  `GREATEST(now(), current expiry)` and is idempotent per order, so the race
  between `verify-payment.ts` and a retried `webhook.ts` cannot double-credit
  (supabase/035). The receipt displays the server's date, not a client guess.
- **The `ProtectedRoute` exemption opens nothing.** `/payment-success` is exempt
  from the entitlement gate, but the page self-guards on router state, so an
  expired account cannot use it to reach anything.
- **Reduced motion** is handled by the global rule at `src/index.css:574`; the
  `animate-ping` and `animate-pulse` here are covered.
- **`text-white` / `text-zinc-*` are not dark-mode leftovers.** `src/index.css`
  remaps `--color-white` and the zinc ramp under `.light` (lines 118-128,
  207-214), so these render as dark text on light ground as intended.

## Not verifiable from here

- A live Razorpay purchase end to end.
- Real webhook-vs-browser race timing.
- Whether the `attempts > 5` branch has ever rendered for a real customer.
