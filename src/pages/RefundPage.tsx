// ============================================
// RefundPage — Cancellation & Refund Policy
// Tailored for Razorpay merchant verification
//
// Rewritten for auto-renewing subscriptions (owner decisions, 2026-09-05).
// The published refund promise is deliberately ONE sentence: contact us within
// 7 days of a charge and it is refunded in full. Nothing beyond that is
// committed to in public, which keeps the discretion to refund a forgotten
// renewal without being obliged to. The three conditional clauses this replaced
// each required the operator to adjudicate a claim — checking scan logs, or
// meeting a three-business-day engineering deadline — on a transaction worth
// less than the time spent deciding.
//
// DO NOT PUBLISH until Razorpay Subscriptions is confirmed live on the account.
// Section 1 describes auto-renewal; while the product still sells one-time
// plans, this document would be the false one.
// ============================================

import { APP_CONFIG } from '@/constants'
import { MarketingLayout } from '@/layouts'

export default function RefundPage() {
  return (
    <MarketingLayout
      title="Cancellation & Refund Policy"
      description="How Intrack subscriptions renew, how to cancel in one click, and our 7-day full-refund promise on any charge."
    >
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-sb-ink">Cancellation & Refund Policy</h1>
        <p className="text-xs mt-1 text-sb-ink-muted">Last updated: September 5, 2026 · Effective immediately</p>
      </div>

      <div className="prose max-w-none space-y-10">
        {/* Note Section */}
        <section>
          <div className="rounded-[12px] bg-brand-500/10 border border-brand-500/20 p-5 mb-8 shadow-sm">
            <p className="text-sm leading-relaxed text-sb-ink-secondary">
              <strong className="text-sb-ink">In short:</strong> your plan renews automatically until you cancel, you can cancel at any time in one click, and if you contact us within 7 days of any charge we refund it in full — no reason needed.
            </p>
          </div>
        </section>

        {/* Section 1: What you are buying */}
        {section("1. What You Are Buying", `
          Intrack subscriptions renew automatically. You choose a billing period when you subscribe, and at the end of each period your subscription renews and you are charged again, until you cancel.

          - Before every charge you receive a notification at least 24 hours in advance, showing the amount and the date, with an option to cancel. Your bank sends its own alert as well. You are never charged without warning.
          - New users get a 7-day free trial first. No card is required to start it, and you are not charged during it.
          - There is no free tier. When the trial ends, access stops unless you subscribe. Your data is retained, so subscribing later restores everything as you left it.
        `)}

        {/* Section 2: Cancellation */}
        {section("2. Cancelling", `
          You can cancel at any time from Settings → Plan & Billing. No reason is needed, there is no cancellation fee, and you do not have to contact us to do it.

          - Cancelling stops future charges. It does not end your current period.
          - You keep full access until the period you have already paid for runs out. After that, access stops.
          - Your data is retained after access ends, so subscribing again restores it as you left it. If you want it removed instead, you can delete your account from Profile → Delete Account.
        `)}

        {/* Section 3: Refunds */}
        {section("3. Refunds", `
          If you contact us within 7 days of a charge, we will refund that charge in full. No reason is needed. This applies to your first payment and to every renewal, on every plan.

          - The 7 days is counted from when you contact us, not from when we reply. If you write on day six and we answer on day nine, you are still within the window.
          - When a refund is issued, your subscription is cancelled and your access ends. You do not need to cancel separately, and you will not be charged again.
          - After 7 days we do not offer refunds as a rule. If something has gone wrong, write to us anyway and we will look at it.
        `)}

        {/* Section 4: Processing */}
        {section("4. How Refunds Reach You", `
          Refunds are processed through our licensed payment gateway partners and returned to the original payment method — the same card, UPI ID, or bank account you paid from.

          - Refunds usually take five to seven business days to appear on your statement, in line with standard banking timelines.
          - You will receive confirmation from the payment provider when the refund is initiated.
        `)}

        {/* Section 5: Contact */}
        {section("5. Before You Contact Your Bank", `
          If a charge looks wrong, please contact us first. We can almost always resolve it faster than a bank dispute can, and a refund we issue directly reaches you sooner.

          - Email: ${APP_CONFIG.SUPPORT_EMAIL}
          - Expected response time: we review and respond to billing queries within 24 to 48 hours.
        `)}
      </div>
    </MarketingLayout>
  )
}

function section(title: string, body: string) {
  return (
    <section key={title} className="space-y-3">
      <h2 className="text-lg font-bold text-sb-ink">{title}</h2>
      <div className="text-sm leading-relaxed whitespace-pre-line text-sb-ink-secondary">
        {body.trim()}
      </div>
    </section>
  )
}
