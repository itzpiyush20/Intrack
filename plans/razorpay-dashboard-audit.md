# Razorpay dashboard audit

Observations only, recorded from owner-supplied screenshots, 2026-09-05.
Fixes and step-by-step guidance come after every screen has been seen.

## Screens seen so far

### Account & Settings → Receipt settings

- "Send receipt automatically after payment" — **ON**. Receipt PDF sent to the
  email and phone the customer entered.
- "Enable receipts for" — only **Payment Links** is listed and ticked.
- "Add message for customer" — ON, text reads `Thankyou for your Purchase`
  (missing space in "Thank you").
- No unsaved changes (Save button greyed).
- **Preview shows "Bill From: Dhanrakshak"** — the retired brand name, coming
  from the Razorpay account's business profile, not from app code.

Implications noted:
- The app uses Standard Checkout, not Payment Links, so **no receipt currently
  reaches customers** on that path. Razorpay Subscriptions delivers per-cycle
  invoices, which is how this closes — see
  `plans/razorpay-subscriptions-migration.md`.
- The business name is customer-visible on receipts and typically on the card or
  bank statement line. `options.name` in `PricingPage.tsx` overrides only the
  checkout sheet, not this.
- Recheck this screen after Subscriptions is enabled — subscription invoices are
  delivered on a different path.

### Account & Settings → Capture and refund settings

- Payment Capture: **AUTOMATIC**, within 12 minutes. Note on screen: capture
  settings apply only when the Orders API is used — the app does use it.
- Default Refund Speed: **Normal Refund** (5–7 days). Instant Refund available
  at a fee, not selected.

Implications noted:
- Correct as-is; no change recommended.
- The tolerant branch in `api/verify-payment.ts` that accepts an `authorized`
  payment when the order is not yet `paid` will rarely fire on this account. Keep
  it as a safety net, but it is not load-bearing here.
- **Validates a policy claim:** `RefundPage` §4 states refunds take five to seven
  business days. Accurate.

### Sidebar (partial)

Visible: Payment Links, Payment Pages, Razorpay.me Link, **"+9 More"** (not yet
expanded). Banking: X Payroll. Customer products: Reviews, Customers, Developers.
A **Test Mode** toggle is present, so a rehearsal environment exists.

**Subscriptions not yet confirmed present.** Still the gating unknown.

### Account & Settings → Business details

- Business Name: `PIYUSH KHANDELWAL`
- **Brand Name: `Dhanrakshak`** ← this is the source of the name on the receipt
  preview.
- Business Type: **Individual**
- Registration Date: Jun 05 2026
- Registered By: `--`
- Tabs present: Account details, Activation details, Business details, GST
  details, Customer support details, Manage team, Support Tickets.

Implications noted:
- The retired brand is a single editable field, not a code change.
- **Business Type "Individual" is a risk flag for the gating question.**
  Razorpay Subscriptions availability can depend on account type; an individual
  (non-registered-business) account may need approval. Confirm before planning
  around it.
- A GST details tab exists. Owner has decided against GST registration, so
  nothing is expected here — noted only so it is not mistaken for a gap later.

### Account & Settings → Transaction limits

- Limit per domestic transaction: **₹50,000**
- International transactions: **not enabled** ("Apply for international")

Implications noted:
- ₹50,000 is far above both plan prices. No constraint.
- International is off. The app has a dynamic INR/USD display preference
  (commit `37210e2`), while `api/create-order.ts` hardcodes `currency: 'INR'`.
  Display-only, so probably fine — worth confirming no path attempts a non-INR
  charge.

### Account & Settings → Credits

- Amount Credits: ₹0.00
- Fee Credits: ₹0.00
- Refund Credits: ₹0.00

Implications noted:
- With zero refund credits, refunds are taken from settled amounts. Relevant to
  the refund plan, not a problem at these amounts.

## Still needed

- Sidebar with "+9 More" expanded — is Subscriptions enabled?
- Subscriptions → Plans (if present)
- Configuration → Payment Methods (which are enabled for recurring; UPI AutoPay)
- Account & Settings → Webhooks (current URL and subscribed events)
- Account & Settings → Notifications (Email / SMS)
- Pricing / Fees (MDR, and whether the fee is returned on refund)
- Account activation status and business/KYC type
