# Intrack — Personal Finance Dashboard

> Expense tracking for India that reads your bank's own email alerts, so the
> ledger fills itself and you only ever confirm what it found.

Built for INR and `dd/mm/yyyy`. React + TypeScript + Vite on the front, Supabase
for data and auth, a handful of Vercel serverless functions for anything holding
a secret, and Capacitor for the Android/iOS builds.

**Start here:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — the verified map of every
endpoint, service, route and table. [`CLAUDE.md`](CLAUDE.md) — the rules any
contributor (human or AI) works to.

---

## What it does

Intrack connects to Gmail with a **read-only** scope and pulls transactions out
of bank, card, UPI and merchant-receipt emails. Every detected transaction lands
in **Pending** and waits for you to approve it — nothing is ever written to your
ledger automatically.

- Bank alert scanning across 30+ Indian banks, classified by Google Gemini with
  a regex ladder as fallback
- A bank alert and a merchant receipt for the same payment merge into one entry
- Manual entry, CSV/statement import, categories, monthly budgets with
  carry-forward
- Card outstandings, available-balance tracking, loans and cash advances
- Recurring-payment detection and a Subscriptions view
- Insights: spend by category, month-on-month movement, savings
- A merchant learning engine that remembers how you categorise a vendor
- Light-mode interface, responsive, WCAG AA

**Every scan is started by you.** There is no background sync and no automatic
scanning — that was removed on 2026-08-27, deliberately, so the app holds no
always-on permission it does not use.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS v4 (tokens in `src/index.css`) |
| Backend / Auth / DB | Supabase (PostgreSQL + RLS + Auth) |
| Serverless API | Vercel Functions (12 handlers under `api/`) |
| Payments | Razorpay Subscriptions |
| AI classification | Google Gemini, server-side via `api/gemini-proxy.ts` |
| Email access | Gmail API, `gmail.readonly` scope |
| Mobile | Capacitor 8 (Android / iOS) |
| Error reporting | Sentry (browser + serverless, separate projects) |

No product-analytics SDK is bundled.

---

## Project structure

```
src/
  pages/          18 route pages + admin/, analytics/, landing/, pricing/ sections
  services/       26 modules — every Supabase call lives here, pages never query directly
  components/     Shared UI; components/ui/ holds the design-system primitives
  context/        AuthContext, ToastContext
  constants/      APP_CONFIG, CATEGORIES, ROUTES, PRICING
api/              12 serverless handlers + _lib/ helpers (see ARCHITECTURE.md)
supabase/         schema.sql and numbered migrations (047_ is the highest)
plans/            Current owner-facing specs and audits
docs/superpowers/ Historical plan/spec pairs for shipped features
```

---

## Local setup

### Prerequisites
- Node.js 20+
- A Supabase project
- A Google Cloud project with the Gmail API and an OAuth 2.0 client
- A Razorpay account (test or live) with the two subscription plans created
- A Google Gemini API key

### Steps

```bash
git clone https://github.com/itzpiyush20/Intrack.git
cd Intrack
npm install
cp .env.example .env    # then fill in every value
npm run dev
```

`.env.example` lists every variable the app reads, with a note on which are
server-side only. A `VITE_`-prefixed name is compiled into the browser bundle —
never put a secret behind one.

### Database

Run `supabase/schema.sql` in the Supabase SQL editor, then apply the numbered
migrations in `supabase/` in order.

> ⚠️ `schema.sql` alone is **not** currently sufficient — it is missing six
> tables that exist in production (`categories`, `payments`, `promo_codes`,
> `promo_redemptions`, `support_tickets`, `subscription_charges`). See
> [`ARCHITECTURE.md`](ARCHITECTURE.md) §6.

### Deployment

Push to `main` — Vercel builds and deploys. Set every `.env` variable as a Vercel
environment variable, and set `ALLOWED_ORIGIN` to your production origin (it
accepts a comma-separated list so a domain move need not be a hard cutover).
`vercel.json` carries the security headers, the SPA rewrite, and the one daily
cron.

---

## Commands

```bash
npm run dev      # vite dev server
npm test         # vitest
npm run lint     # eslint (large documented pre-existing baseline)
npm run build    # tsc -b && vite build
npx tsc -b       # type-check only
```

---

## Subscription plans

| Plan | Price | Access |
|------|-------|--------|
| Monthly | ₹199 | 30 days |
| Annual | ₹699 | 365 days |

New accounts get a **7-day trial with full access**. There is no free tier: when
the trial or a plan ends, access stops. Nothing you logged is deleted, so paying
restores everything exactly as it was.

Prices are defined once in `src/constants/pricing.ts`, mirrored in paise in
`api/_lib/pricing.ts`, and a test fails the build if the two disagree. Every
rupee figure shown to a customer is derived from that object — do not type a
price anywhere else.

Billing runs on Razorpay Subscriptions. Invoices and refunds are handled in the
Razorpay dashboard, not in the app.

### Scan limits

| Account | Scans |
|---|---|
| Trial and paid | 2 per rolling 24 hours, at least 4 hours apart |
| Owner accounts (`VITE_OWNER_EMAILS`) | Unlimited |

---

## Privacy and data handling

Read this before repeating any privacy claim in marketing copy.

- **Gmail access is read-only.** Intrack can never send, modify or delete mail,
  and has no access to SMS.
- **Email text is sent to Google Gemini for classification**, through the
  server-side proxy at `api/gemini-proxy.ts` — the subject and the start of the
  body, for messages a financial-keyword search returned. The Gemini API key
  never reaches the browser.
- **No email body, subject or sender is stored.** What is written to the
  database is the extracted transaction — vendor, amount, date, card issuer and
  brand — plus the Gmail message id, which is what makes deduplication possible.
  `email_scan_rejections` keeps a short truncated snippet for diagnostics and is
  purged after 30 days.
- **Google tokens:** access tokens live in the browser. Refresh tokens — only for
  grants issued before offline access was dropped — are stored server-side in
  `google_oauth_tokens`, readable by the service role alone. Disconnecting Gmail
  through the app revokes the grant at Google *and* deletes the stored token.
- **RLS on every table.** A user's rows are unreachable to any other user.

---

## Security

- CORS restricted to `ALLOWED_ORIGIN`
- Rate limiting on the payment endpoints
- HMAC-SHA256 verification on the Razorpay webhook; fulfillment is idempotent
  and double charges are flagged for review
- Row Level Security enforced at the database on all 19 tables
- CSP, HSTS, `X-Frame-Options: DENY` and friends set in `vercel.json`
- Admin access is per-account via `profiles.is_admin`, checked through the
  `public.is_admin()` SQL function — never by email domain

---

## Mobile build

See [`MOBILE_SETUP.md`](MOBILE_SETUP.md).

```bash
npm run build
npx cap sync android
npx cap open android
```

---

## Handover

See [`TRANSFER_GUIDE.md`](TRANSFER_GUIDE.md) for the full service transfer
checklist — Supabase, Vercel, Google Cloud, Razorpay, domain, and every
environment variable that must be rotated.

---

## License

Proprietary — all rights reserved.
