// ============================================
// TermsPage — Terms of Service & User Agreement
//
// Rewritten for auto-renewing subscriptions (owner decisions, 2026-09-05).
// Three changes beyond the billing model itself:
//
//  * §6 Suspension & Termination is NEW. §5 listed prohibited uses and attached
//    no consequence, so the Terms banned behaviour they gave no power to act on
//    — while api/admin.ts ships an endpoint that ends an account's access. The
//    tooling could do what the contract said would never happen.
//  * §10 Governing Law is NEW. There was none.
//  * The Refund Policy no longer has "limited cases" to point at; §4 now states
//    the single 7-day promise directly.
//
// §10 Governing Law names India only — no city, no exclusive-jurisdiction
// court (owner decision, 2026-09-08).
// ============================================

import { MarketingLayout } from '@/layouts'

export default function TermsPage() {
  return (
    <MarketingLayout
      title="Terms of Service"
      description="The terms governing your use of Intrack, covering Gmail scanning, the 7-day trial, auto-renewing subscriptions, cancellation, and limitations of liability."
    >
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-sb-ink">Terms of Service</h1>
        <p className="text-xs mt-1 text-sb-ink-muted">Last updated: September 8, 2026 · Effective immediately</p>
      </div>

      <div className="prose max-w-none space-y-10">

        <section>
          <div className="sb-card-light p-5 mb-8 leading-relaxed text-sb-ink-secondary">
            Please read these Terms of Service ("Terms") carefully before using Intrack (the "Service" or "App").
            By signing up for or using Intrack, you agree to be bound by these Terms and our Privacy Policy.
          </div>
        </section>

        {section("1. The Service", `
          Intrack is a personal financial intelligence platform designed to parse bank transactions, help users monitor expenses, maintain budgets, and receive financial forecasts.

          The Service is provided "as is" and "as available". We do not warrant that the Service will always be uninterrupted, timely, secure, or free from error.
        `)}

        {section("2. Account Creation & Verification", `
          To use the Service, you must create an account using a valid email address or via Google OAuth.
          - You represent that all information provided is accurate and truthful.
          - You are responsible for keeping your account credentials secure.
          - We limit account usage to a maximum of 2 active concurrent browser sessions/devices per user to prevent abuse.
        `)}

        {section("3. Email Tracking & Google API Data", `
          If you connect your Google Account (Gmail) to allow the email scanner engine to scan and extract transactions:
          - You explicitly grant Intrack permission to search your inbox for financial transaction alerts and to read and parse the messages that search returns.
          - Deciding whether a message is a genuine transaction requires reading it. The scanner therefore reads the subject and the first part of the body of every message its search matches — which necessarily includes some that turn out to be newsletters, promotions or other non-financial mail. Those are discarded rather than saved. We do not claim to read only transactional email; we claim to KEEP only transactional email.
          - Parsing uses a combination of client-side pattern matching and Google's own Gemini AI, reached through a server-side proxy we operate so that the API credentials never reach your browser. That text passes through the proxy in real time, is not logged or retained by us, and is never used to train any model.
          - One narrow exception, described in full in the Privacy Policy: when the scanner REJECTS a message, we retain the sender's domain, the subject line and an extract of up to 200 characters, deleted automatically after 30 days, so a transaction you report as missing can be traced to the reason it was skipped.
          - You can disconnect your Google account and revoke access at any time.
        `)}

        {section("4. Subscriptions, Trials & Billing", `
          Intrack offers subscription plans to access advanced automated tracking features:
          - 7-Day Free Trial: New users receive 7 days of free trial access starting from registration. No payment method is required to start it and you are not charged during it. During the trial the service gives full access, including the Gmail scans you run yourself and manual entries. There is no free tier: when the trial ends, access stops unless you subscribe. Data you have already entered is retained, not deleted.
          - Paid Plans: Choose the Monthly plan or the Yearly plan to continue using manual entry and Gmail inbox scanning. Current prices are shown on the Pricing page. Every scan is started by you: Intrack performs no background, scheduled or automatic scanning of any kind.
          - Automatic Renewal: Subscriptions RENEW AUTOMATICALLY at the end of each billing period and your payment method is charged again, until you cancel. Before every charge you receive a notification at least 24 hours in advance showing the amount and date, with an option to cancel, and your bank sends its own alert. You are never charged without warning.
          - Billing: All payments and the recurring mandate are handled securely by our licensed payment gateway partner. We never see or store your card details.
          - Cancellation: You can cancel at any time from Settings → Plan & Billing, without contacting us and without a fee. Cancelling stops future charges; it does not end the period you have already paid for, which runs to its end date.
          - Refunds: If you contact us within 7 days of a charge we refund that charge in full, no reason required, on your first payment and on every renewal. A refund cancels your subscription and ends your access. After 7 days we do not offer refunds as a rule. See the Cancellation & Refund Policy for the full statement.
          - Price Changes: We may change prices. A change never affects a period you have already paid for, and we will tell you before a new price applies to a renewal, so you can cancel first if you prefer.
        `)}

        {section("5. Prohibited Uses", `
          You agree not to use the Service to:
          - Abuse or overload our API endpoints, for example by scripting repeated scans or automated request loops.
          - Circumvent the session limit, or create multiple accounts to obtain additional free trials or coupon redemptions.
          - Resell, sublicense or redistribute access to the Service.
        `)}

        {section("6. Suspension & Termination", `
          We may suspend or terminate an account that breaches these Terms, in particular the Prohibited Uses above, or where we are required to by law.

          - Where it is practical to do so, we will tell you first and give you a chance to put things right. Where the breach is causing active harm — for example an automated request loop degrading the service for others — we may act immediately and tell you afterwards.
          - If we terminate an account for breach, any remaining paid time is forfeited at our discretion; this is not refunded automatically.
          - You may close your account at any time from Profile → Delete Account. Doing so ends your access immediately and erases your data as described in the Privacy Policy; it does not by itself entitle you to a refund outside the 7-day window in section 4.
        `)}

        {section("7. Limitations of Liability", `
          Intrack is a financial tool, not a financial advisor. All insights, cash flow forecasts, and subscription lists are provided for informational purposes only.
          - We are not liable for any financial decisions, loss of money, or investment decisions you make based on data displayed in the app.
          - Under no circumstances shall Intrack or its creator be liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the Service.
        `)}

        {section("8. Data Ownership & Rights", `
          Your financial data belongs entirely to you.
          - You can request a full export of your data (as CSV or JSON) at any time.
          - You can permanently delete your account and all associated transaction records directly from the app interface.
        `)}

        {section("9. Amendments to Terms", `
          We reserve the right to modify these Terms at any time. We will alert you to major updates via an in-app notice. Continued use of the Service after changes constitute acceptance of the updated Terms.

          Where a change affects what you pay or how your subscription renews, we will tell you before it takes effect on a renewal, so that you can cancel first if you prefer.
        `)}

        {section("10. Governing Law & Jurisdiction", `
          These Terms are governed by the laws of India.

          Nothing in these Terms limits any right you have under the Consumer Protection Act, 2019 or other consumer protection law that cannot be waived by agreement.
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
