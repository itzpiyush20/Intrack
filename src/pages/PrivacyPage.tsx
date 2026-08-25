// ============================================
// PrivacyPage — Privacy Policy & Data Rights
// ============================================

import { APP_CONFIG } from '@/constants'
import { MarketingLayout } from '@/layouts'

export default function PrivacyPage() {
  return (
    <MarketingLayout
      title="Privacy Policy"
      description="How Intrack handles your data: read-only Gmail access, what is kept and what is discarded, where it is stored, and your rights under India's DPDPA 2023."
    >
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-sb-ink">Privacy Policy</h1>
        <p className="text-xs mt-1 text-sb-ink-muted">Last updated: August 20, 2026 · Effective immediately</p>
      </div>

      <div className="prose max-w-none space-y-10">

        {/* Intro */}
        <section>
          <div className="rounded-[12px] bg-brand-500/10 border border-brand-500/20 p-5 mb-8">
            <p className="text-sm leading-relaxed text-sb-ink-secondary">
              <strong className="text-sb-ink">Our commitment:</strong> Intrack is built on a foundation of trust. We never sell your financial data, never store your banking passwords, and never share your personal information with advertisers. Your financial data belongs to you — always.
            </p>
          </div>
        </section>

        {section("1. Who We Are", `
          Intrack ("we", "us", "our") is a personal financial intelligence platform operated by its founder. The platform is accessible at www.intrack.co.in and any associated domains.

          For privacy-related queries, contact us via the in-app Support page.
        `)}

        {section("2. What Data We Collect", null, [
          { title: "Account Information", body: "When you sign up, we collect your email address and optionally your name and profile photo (if you sign in with Google)." },
          { title: "Transaction Data", body: "Financial transactions you enter manually, or that are automatically extracted from your Gmail bank alert emails. This includes: amount, date, merchant name, category, and payment method type (e.g., credit card last 4 digits). We never store full card numbers, PINs, or banking passwords." },
          { title: "Email Content (Gmail Only)", body: "If you connect Gmail, we use a read-only OAuth scope and search your inbox for financial keywords. To decide whether a matching email is a real transaction, its subject and the first part of its body are read — this necessarily includes emails that turn out to be newsletters or promotions, which are then discarded. We do not store the body of any email. Only the extracted transaction data is saved permanently." },
          { title: "Scan Diagnostics", body: "When the scanner rejects an email, we store the sender's domain, the subject line, and a short extract (up to 200 characters) of the text that caused the rejection. This exists so a transaction you report as missing can be traced to the reason it was skipped. These records are automatically deleted after 30 days, and you can see your own at any time." },
          { title: "Usage Data", body: "None. We do not use any third-party product analytics, advertising, or behavioural tracking service. We removed the analytics tool this app previously loaded." },
          { title: "Device Information", body: "A unique device identifier is stored locally to support our 2-device session limit. This is never transmitted to our servers." },
        ])}

        {section("3. How We Use Your Data", null, [
          { title: "To provide the service", body: "Your transaction data is used exclusively to show you your financial dashboard, insights, budgets, and reports." },
          { title: "To improve accuracy", body: "Your category corrections teach the system to better categorize future transactions for your account only. Your learning data is not used to train global models." },
          { title: "To send you alerts", body: "If you opt in, we may send budget overspend alerts and subscription renewal reminders to your registered email." },
          { title: "We never:", body: "Sell your data · Share data with advertisers · Use your data to train AI for other users · Access emails beyond bank alert parsing" },
        ])}

        {section("4. Data Storage & Security", null, [
          { title: "Database", body: "Your data is stored in Supabase (a Postgres-based cloud database) on servers in India/Europe. Supabase is SOC 2 Type II compliant." },
          { title: "Row Level Security", body: "Every database table has Row Level Security enabled. Your data is physically isolated — no user can access another user's data, even accidentally." },
          { title: "Encryption", body: "All data in transit is encrypted via TLS 1.3. Your optional encrypted backup files use AES-GCM encryption — only you hold the password." },
          { title: "Gmail OAuth", body: "We use OAuth 2.0 with read-only scopes. Your Gmail password is never seen or stored by us." },
        ])}

        {section("5. Your Rights & Consent Control", null, [
          { title: "Access & Portability", body: "You can export all your transaction data anytime as a CSV or JSON file from the Settings page or the dashboard." },
          { title: "Deletion & Erasure", body: "You can permanently delete your account from Settings → Account → Delete Account. This immediately erases your profile, transaction history, budgets, cards, learned categorisation rules, scan logs and diagnostics, payment records, and your stored Gmail token. One thing survives, and only in anonymised form: any feedback you submitted or support ticket you filed. We keep the message, its date, and its rating or subject — so a bug you reported or a complaint you raised does not disappear the moment you leave — but at the point of deletion your name and email address on those records are replaced with a placeholder that cannot be traced back to you, and the link to your account is removed. Because we keep the message text itself, anything personal you typed into a feedback or support message stays in that message; if you want a specific message removed as well, ask us before or after deleting and we will remove it." },
          { title: "Correction", body: "You can edit, categorize, or delete any transaction, rule, or profile parameter at any time." },
          { title: "Revoke Gmail Access", body: "You can revoke Gmail inbox access at any time from your Google Account → Security → Third-party apps, or from Settings → Disconnect Gmail in the app." },
          { title: "Withdraw Consent (DPDPA 2023)", body: "Under the Digital Personal Data Protection Act 2023, you have the right to withdraw your consent to data processing at any time by deleting your account. Deletion halts all processing of your data and erases your records, with the single exception described under Deletion & Erasure above: feedback and support messages are retained without your name, email, or any link to your account." },
        ])}

        {section("6. Third-Party Services", null, [
          { title: "Supabase", body: "Database, authentication, and file storage. Privacy policy: supabase.com/privacy" },
          { title: "Google OAuth", body: "Sign-in and Gmail access. Privacy policy: policies.google.com/privacy" },
          { title: "Vercel", body: "Web hosting and CDN. Privacy policy: vercel.com/legal/privacy-policy" },
          { title: "Google Gemini", body: "Classifies scanned emails as transactions or not. Email text passes through in real time and is not retained. Privacy policy: policies.google.com/privacy" },
          { title: "Razorpay", body: "Payment processing. We never see or store your card details. Privacy policy: razorpay.com/privacy" },
        ])}

        {section("7. Cookies", `
          We use only what is strictly necessary to keep you signed in. We run no advertising cookies, no tracking cookies, and no third-party analytics.

          Session storage: Required for you to stay logged in. Cleared when you log out.
          localStorage: Your theme preference, a device ID for the 2-device limit, your Gmail access token, and cached merchant rules. Never transmitted to third parties.
        `)}

        {section("8. Children's Privacy", `
          Intrack is not intended for children under 18. We do not knowingly collect data from minors. If you believe a minor has created an account, please contact us and we will delete it.
        `)}

        {section("9. Changes to This Policy", `
          We will notify you of material changes to this policy via in-app notification or email. The "Last updated" date at the top of this page always reflects the most recent revision.
        `)}

        {section("10. Google API Services Disclosure", `
          Intrack's use and transfer of information received from Google APIs to any other app will adhere to Google API Services User Data Policy, including the Limited Use requirements.

          Specifically:
          • We access your Gmail inbox only to read transaction alert emails from banking institutions.
          • We do not store the body of your emails. Transaction emails are parsed using a combination of client-side pattern matching and Google's own Gemini AI (called via a server-side proxy we control solely to keep API credentials secure) — email text passes through this proxy in real time to extract transaction details and is never logged or retained afterward. The one exception is the scan diagnostics described in section 2: for an email the scanner REJECTED, we keep the sender domain, the subject line and an extract of up to 200 characters, deleted automatically after 30 days, so that a transaction you report as missing can be traced.
          • We do not share, transfer, or sell your Google user data to third-party databases, marketing platforms, or ad networks.
          • We do not use your Google user data to train machine learning or artificial intelligence models.
        `)}

        {section("11. Contact Us & Grievance Officer", `
          If you have privacy questions, wish to exercise your data rights, or have complaints, please contact our designated Grievance Officer:

          • Name: ${APP_CONFIG.SUPPORT_NAME}
          • Designation: ${APP_CONFIG.SUPPORT_DESIGNATION}
          • Contact Email: ${APP_CONFIG.SUPPORT_EMAIL}
          • Address: ${APP_CONFIG.SUPPORT_ADDRESS}

          We will address and resolve any complaints or data queries within 30 days of receipt.
        `)}
      </div>
    </MarketingLayout>
  )
}

function section(title: string, body: string | null, items?: { title: string; body: string }[]) {
  return (
    <section key={title} className="space-y-3">
      <h2 className="text-lg font-bold text-sb-ink">{title}</h2>
      {body && (
        <div className="text-sm leading-relaxed whitespace-pre-line text-sb-ink-secondary">
          {body.trim()}
        </div>
      )}
      {items && (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.title} className="sb-card-light p-4">
              <p className="text-sm font-semibold text-sb-ink">{item.title}</p>
              <p className="text-sm leading-relaxed mt-1 text-sb-ink-secondary">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
