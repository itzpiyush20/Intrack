# Policy audit and industry standard

2026-09-05. Competitor research plus a line-by-line reading of the three
published policies against what the code actually does.

These documents are the contract with every paying user, so this separates three
things carefully: **what competitors do**, **what the policies promise**, and
**what the code delivers**. The defects are all in the third gap.

---

## 1. What competitors actually do

### The Indian mass market is free

Money View, axio (formerly Walnut), ET Money, INDmoney, Jupiter and Fi do not
charge for expense tracking. They monetise by cross-selling credit — axio's Play
Store listing now foregrounds Pay Later, personal loans and fixed deposits, and
it was acquired by Amazon in 2025.

**This is the single most important competitive fact.** Intrack's direct Indian
competitors are not competing on price; they are free, and they earn from
lending. Charging ₹31 puts Intrack in a different business, not a cheaper
version of theirs — one where the product has to be worth paying for on its own.

### Small paid Indian peers exist and look like Intrack

**FinArt** is the closest comparable: an Indian SMS/email expense tracker
charging roughly $2.99/month or $29.99/year, plus **Lifetime one-time plans**.
Billing runs through Google Play. Its refund line is *"contact us directly and we
will review your request for refund of unused subscription period"* — case by
case, unused portion. It also warns that Google may not refund the current
period on cancellation.

Note what FinArt does that Intrack does not: it sells a **one-time lifetime
tier alongside** recurring plans, rather than instead of them.

### Western paid trackers are auto-renewing and refund pro-rata

| Product | Price | Refund |
|---|---|---|
| YNAB | $109/yr | No refund on monthly; **prorated refund on annual**, from account deletion date |
| Monarch Money | $99/yr ($14.99/mo), Plus $199/yr | **Prorated refund for the unused portion** on annual bought direct; data accessible 30 days after cancellation. App Store / Play purchases go through Apple or Google |
| Copilot Money | $95/yr ($13/mo) | Not published in the sources found |

All three auto-renew. Where they are sold through Apple or Google, the platform
handles refunds and the merchant's own policy barely matters.

### The regulatory backdrop matters more than it looks

RBI's **Digital Payments E-mandate Framework, 2026** (issued 21 April 2026)
governs recurring debits in India. Recurring transactions up to ₹15,000 no longer
need per-transaction authentication, but collecting entities must send a
**pre-debit notification at least 24 hours before every debit**, with an opt-out,
and a **post-debit confirmation** after every successful collection.

At ₹31 and ₹365 the AFA threshold is irrelevant, but the notification
infrastructure is not — auto-renewal would oblige Intrack to build and operate
two mandatory notification paths it does not have today.

## 2. So what is "the standard"?

| Axis | Industry standard | Where Intrack sits |
|---|---|---|
| **Subscription model** | Auto-renewing annual, sold via platform billing | One-time, no mandate. **Outlier — deliberately, and defensibly** |
| **Trial** | Free trial, no card, then a hard paywall (YNAB 34 days, Monarch 7) | 7 days, no card, hard stop. **Matches** |
| **Refund** | Platform-handled, or **pro-rata on the unused portion** for direct annual | Three conditional clauses, 48-hour window, no pro-rata. **Below standard** |
| **Receipts** | Platform receipt email, plus in-app billing history — universal | None. **Absent** |

### On the subscription model: keep it

The one-time model is the right call and should not change. It sidesteps the
entire RBI e-mandate surface — no mandate registration, no 24-hour pre-debit
notices, no post-debit confirmations, no involuntary churn from failed mandates.
For a solo operator that is a large amount of compliance machinery avoided. It is
also the honest version of what the marketing already says, and FinArt proves an
Indian audience will buy a one-time tier.

The cost is real and should be stated plainly: no renewal revenue, so every
period must be re-sold. That is a business tradeoff, not a defect.

### On refunds: the current policy is below standard

Terms §4 says *"Intrack does not offer refunds for unused portions of a period."*
YNAB and Monarch both refund unused portions on annual plans — while charging
roughly thirty times more. On a ₹365 plan, refusing pro-rata is a harsher
position than the premium US products take, in exchange for amounts around ₹1
per day.

## 3. Defects found in the published policies

### P1 — HIGH · the Terms grant no right to terminate, and the Refund Policy forbids it

Terms §5 lists prohibited uses — API abuse, circumventing the session limit,
**creating multiple accounts to obtain additional free trials or coupon
redemptions**, reselling access. It attaches **no consequence whatsoever**. There
is no termination clause, no suspension clause, and no right to close an account
anywhere in the Terms.

Refund Policy §2 goes further and affirmatively promises: *"Access you have
already paid for is never withdrawn early. It runs to the end of the period you
purchased."*

Meanwhile `api/admin.ts` ships an operator endpoint that immediately sets
`subscription_status = 'expired'`, backdates the expiry to now, and clears any
queued plan.

So the tooling can do something the contract promises will never happen, and
the one behaviour the Terms explicitly prohibit is one they give no power to
punish. Ban a trial abuser and you breach your own refund policy.

This is also the clause that blocks the refund design in
`plans/receipts-and-billing-history.md`: a refund that revokes the access it
paid for is, by the current wording, forbidden.

### P2 — HIGH · the Refund Policy promises things no mechanism delivers

**Duplicate billings.** §3: *"duplicate charges will be refunded in full."* The
code detects this case (`outcome = 'queue_extended'`), `supabase/041` flags it
for review, and the admin card's own text reads *"your refund policy covers
duplicate charges, and the customer has not been told."* There is no automatic
refund and no notification. The promise is real; the delivery depends on the
operator noticing an admin card.

**Technical failures.** §3 commits to a full refund if *"our engineering team is
unable to resolve the issue within three (3) business days of your report."*
Plus §5: *"we review and respond to all billing inquiries within 24 to 48
hours."* These are hard, dated SLAs published by a single-person operation.
They should say what can actually be sustained during a holiday or an illness.

### P3 — HIGH · a refund does not take back what it paid for

No code path anywhere calls Razorpay's refund API. `payments.status` allows
`'refunded'` and nothing ever writes it. Nothing adjusts
`subscription_expires_at`. Refunds happen by hand in the Razorpay dashboard, and
the customer keeps the full paid period afterwards unless the operator
separately remembers to end access in the admin tool.

### P4 — MEDIUM · the Terms have no governing law or jurisdiction clause

There is no statement of which law governs the agreement or where disputes are
heard. Every competitor's terms carry one, and it is expected of an Indian
merchant. India's Consumer Protection (E-Commerce) Rules, 2020 also require
clear, prominent disclosure of refund and grievance-redressal terms — the
Privacy Policy already names a Grievance Officer, which is the harder half.

### P5 — MEDIUM · the 48-hour refund window is out of step, and self-defeating

§3 grants a refund for an accidental upgrade *"within forty-eight (48) hours"*
and only if you *"have not used the parsing service since upgrading."* That
second condition requires someone to check scan logs per claim, on a ₹31
transaction. The adjudication costs more than the refund, and a refused ₹31
refund invites a chargeback whose dispute fee is many times the ticket.

### P6 — MEDIUM · the Privacy Policy sets no retention period for transaction data

Scan diagnostics correctly state 30 days. Nothing else does. Transaction data,
account data and payment records have no stated retention limit, and DPDPA 2023
expects retention to be purpose-limited. The deletion rights are well written;
what is missing is what happens to data you never ask about — for example, an
account left dormant for years.

### P7 — LOW · "servers in India/Europe" is imprecise

Privacy §4 names two regions for one database. Say which one. Verify the actual
region in the Supabase dashboard before publishing a correction — it is a
factual claim about where personal data lives.

### P8 — LOW · wording

Privacy §3 mentions *"subscription renewal reminders"* in a product where nothing
renews. Wording only. (Not reopening the separate, already-settled question of
whether notifications ship — this is just the word "renewal".)

## 4. What is already correct

Worth recording, because these are the parts most products get wrong:

- **The Google API Services Disclosure (Privacy §10) is right**, including the
  explicit Limited Use commitment, the statement that email bodies are not
  stored, the narrow scan-diagnostics exception, and the "not used to train
  models" line. This is the clause the Gmail verification review turns on, and
  it is correctly written.
- **Terms §3 is unusually honest**: *"We do not claim to read only transactional
  email; we claim to KEEP only transactional email."* That is the truthful
  description of how a keyword-search scanner works, and most competitors fudge
  it.
- **The Grievance Officer block** (Privacy §11) with name, designation, email,
  address and a 30-day resolution commitment satisfies what DPDPA expects.
- **The no-auto-renewal disclosure** is stated clearly and repeatedly across all
  three documents, which is exactly right for the one thing users most fear.

## 5. Recommended changes

### Terms of Service

1. **Add a termination and suspension clause.** The right to suspend or close an
   account for breach of §5, with notice where practical, and what happens to
   paid-for time in that case. Without it, §5 is decorative and the admin tool
   is unauthorised.
2. **Add governing law and jurisdiction.**
3. **Amend §4** to permit pro-rata refunds on annual plans, and to allow access
   to end when a purchase is refunded. The current wording forbids both.
4. **Soften the support SLA** to something sustainable.

### Refund Policy

5. **Replace the three conditional clauses with one rule:** full refund on
   request within 7 days of payment, no reason required, both plans.
6. **Add pro-rata for the Yearly plan after day 7**, on request. This is the
   industry standard and currently Intrack is below it.
7. **Amend §2** — "access is never withdrawn early" becomes "never withdrawn
   early except where a purchase is refunded or the account is terminated for
   breach of the Terms."
8. **Commit to proactive refunds for duplicate charges**, and mean it — this is
   the one case that should be automatic, since the code already detects it.
9. **Add a chargeback line**: ask customers to contact support before disputing,
   since a refund is faster than a dispute.

### Privacy Policy

10. **Add a retention section** — how long transaction, account and payment data
    are kept, and what happens to a dormant account.
11. **Correct the server location** to the actual region.
12. **Fix the "renewal reminders" wording.**

### Code (from `plans/receipts-and-billing-history.md`)

13. Refunds must revoke access. Automatic refund for `queue_extended`. Receipts
    and billing history, so a refund claim can reference a real payment.

## 6. Decisions needed before anything is published

1. **Refund window** — 7 days both plans, or 7 monthly and 14 yearly?
2. **Pro-rata on Yearly** — match the industry standard, or stay full-or-nothing?
3. **Termination clause** — does refunding a terminated abuser's remaining time
   happen automatically, or at your discretion?
4. **Support SLA** — what response time can you actually sustain?
5. **Governing law** — which jurisdiction.
6. **Should a Lifetime tier exist?** FinArt sells one and it fits the no-mandate
   model better than anything else. Out of scope here; worth its own thought.

Nothing in section 5 should ship without a re-read of all three documents
together — they cross-reference each other, and two of the defects above exist
precisely because one document was edited without the other.

---

## Sources

- [Best Expense Tracker Apps in India 2026 — Money View](https://moneyview.in/insights/best-personal-finance-management-apps-in-india)
- [axio: Income & Expense Tracker — Google Play](https://play.google.com/store/apps/details?id=com.daamitt.walnut.app&hl=en_IN)
- [10 Best Expense Tracker Apps in India (2026) — FinArt](https://finart.app/best-expense-tracker-apps-india/)
- [FinArt Android FAQ — billing, subscriptions, privacy](https://finart.app/faq.html)
- [TrackMyRupee](https://trackmyrupee.com/)
- [YNAB vs Monarch vs Copilot (2026) — WalletGrower](https://walletgrower.com/compare/ynab-vs-monarch-vs-copilot)
- [Monarch Money Pricing 2026 — FinCompareLab](https://www.fincomparelab.com/guides/monarch-money-pricing/)
- [YNAB Pricing 2026](https://checkthat.ai/brands/ynab/pricing)
- [Razorpay — refunds FAQ](https://razorpay.com/docs/payments/refunds/faqs/)
- [Razorpay — payment gateway refund process](https://razorpay.com/blog/payment-gateway-refund-process)
- [RBI e-Mandate Framework 2026 — compliance checklist](https://amlegals.com/upi-autopay-and-recurring-payments-compliance-checklist-under-rbis-e-mandate-framework-2026/)
- [RBI tightens auto-debit rules — ANI](https://www.aninews.in/news/business/rbi-tightens-auto-debit-rules-24-hour-prior-alert-now-mandatory-for-recurring-payments20260421202816/)
- [Consumer Protection (E-Commerce) Rules, 2020 — Khaitan & Co](https://www.khaitanco.com/thought-leaderships/Stricter-Regulations-on-E-Commerce-The-Consumer-Protection-E-Commerce-Rules-2020)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Restricted scope verification — Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
