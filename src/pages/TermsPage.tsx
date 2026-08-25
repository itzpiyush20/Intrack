// ============================================
// TermsPage — Terms of Service & User Agreement
// ============================================

import { MarketingLayout } from '@/layouts'

export default function TermsPage() {
  return (
    <MarketingLayout
      title="Terms of Service"
      description="The terms governing your use of Intrack, covering Gmail scanning, the 7-day trial, one-time subscription payments, and limitations of liability."
    >
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-sb-ink">Terms of Service</h1>
        <p className="text-xs mt-1 text-sb-ink-muted">Last updated: August 20, 2026 · Effective immediately</p>
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
          
          The Service is provided "as is" and "as available". We do not guarantee that the Service will always be uninterrupted, timely, secure, or free from error.
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
          - 7-Day Free Trial: New users receive 7 days of free trial access starting from registration. During the trial period, the service gives full Pro access, including automated Gmail scanning and manual entries. Access will be limited or locked after the trial period ends unless upgraded to a subscription plan.
          - Paid Plans: Users can choose the Monthly plan (₹31 for 30 days) or the Yearly plan (₹365 for 365 days) to unlock full background and manual Gmail inbox synchronization.
          - Billing: All payments are processed securely via Razorpay, a licensed payment gateway. Every plan is a ONE-TIME payment for a fixed period. Nothing renews automatically, no mandate is placed on your card, and you are never charged again without making a new purchase.
          - Cancellation: Because nothing recurs, there is no cancellation step and no cancellation fee. Access runs to the end of the period you paid for and then stops. Intrack does not offer refunds for unused portions of a period; see the Refund Policy for the limited cases in which a refund is available.
        `)}

        {section("5. Prohibited Uses", `
          You agree not to use the Service to:
          - Abuse or overload our API endpoints, for example by scripting repeated scans or automated request loops.
          - Circumvent the session limit, or create multiple accounts to obtain additional free trials or coupon redemptions.
          - Resell, sublicense or redistribute access to the Service.
        `)}

        {section("6. Limitations of Liability", `
          Intrack is a financial tool, not a financial advisor. All insights, cash flow forecasts, and subscription lists are provided for informational purposes only.
          - We are not liable for any financial decisions, loss of money, or investment decisions you make based on data displayed in the app.
          - Under no circumstances shall Intrack or its creator be liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the Service.
        `)}

        {section("7. Data Ownership & Rights", `
          Your financial data belongs entirely to you. 
          - You can request a full export of your data (as CSV or JSON) at any time.
          - You can permanently delete your account and all associated transaction records directly from the app interface.
        `)}

        {section("8. Amendments to Terms", `
          We reserve the right to modify these Terms at any time. We will alert you to major updates via an in-app notice. Continued use of the Service after changes constitute acceptance of the updated Terms.
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
