# Intrack — Personal Finance Dashboard

> Automated, privacy-first personal wealth guardian. Scans bank email alerts to track daily expenses with zero manual entry and 100% data ownership.

---

## What It Does

Intrack connects to a user's Gmail inbox (read-only) and automatically extracts debit/credit transactions from bank alert emails. All parsing happens client-side in the browser — no email content is stored on the server. Users can review, approve, or reject detected transactions before they hit the ledger.

**Key features:**
- Automatic bank email scanning (HDFC, ICICI, SBI, Axis, Kotak, and 30+ banks)
- Manual transaction entry with category and budget tracking
- Monthly budget vs. spend analysis with visual charts
- Razorpay-powered subscription (₹31/mo · ₹365/yr · ₹1000 lifetime)
- Premium gate enforced at service layer — not bypassable via UI
- 24-hour scan cooldown with live countdown timer
- Merchant learning engine — remembers your category preferences
- Dark-mode first, responsive design

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS 4 |
| Backend / Auth / DB | Supabase (PostgreSQL + RLS + Auth) |
| Serverless API | Vercel Functions (3 endpoints) |
| Payments | Razorpay (orders + webhook) |
| AI Parsing | Google Gemini 2.0 Flash |
| Email Access | Gmail API (readonly scope) |
| Mobile | Capacitor 8 (Android / iOS) |
| Analytics | PostHog |

---

## Project Structure

```
src/
  pages/          19 route pages (Dashboard, Expenses, Budgets, Pricing, …)
  services/       12 service modules (emailScanner, aiService, learningEngine, …)
  components/     Shared UI components
  contexts/       AuthContext, ToastContext
  types/          Full TypeScript type definitions
  constants/      APP_CONFIG, CATEGORIES, ROUTES
api/
  create-order.ts    Razorpay order creation
  verify-payment.ts  Payment verification + profile upgrade
  webhook.ts         Razorpay webhook handler (idempotent)
supabase/
  schema.sql         Full, current database schema — the only file you need to run
  archive/           Historical migrations, already folded into schema.sql
```

---

## Local Setup

### Prerequisites
- Node.js 20+
- A Supabase project
- A Google Cloud project with Gmail API + OAuth 2.0 enabled
- A Razorpay account (test or live)
- A Google Gemini API key

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/Dhanrakhshak.git
cd Dhanrakhshak

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Fill in all values in .env

# 4. Set up the database
# Open Supabase SQL Editor and run supabase/schema.sql — it is the complete,
# up-to-date schema. No other migration file needs to be run.

# 5. Start dev server
npm run dev
```

### Vercel Deployment

1. Connect this repo to Vercel
2. Add all `.env` variables as Vercel Environment Variables
3. Set `ALLOWED_ORIGIN` to your production domain
4. Deploy — Vercel auto-detects Vite and the `api/` serverless functions

---

## Database Schema

Run `supabase/schema.sql` on a fresh Supabase project. It creates:

| Table | Purpose |
|-------|---------|
| `profiles` | Extended user profile + subscription status |
| `transactions` | All debit/credit transactions (manual + email) |
| `budgets` | Monthly per-category budget limits |
| `email_scan_logs` | Scan history + Gmail historyId checkpoint |
| `merchant_rules` | Per-user learned merchant category rules |
| `cards` | User's saved card profiles (issuer, last 4, brand) |
| `feedback` | In-app bug/feature feedback |
| `signin_logs` | Sign-in audit log |

RLS is enabled on all tables. Users can only access their own rows. Admin/creator access (viewing all feedback, signin logs, profiles) is granted per-account via `profiles.is_admin`, not by email domain — see `TRANSFER_GUIDE.md`.

---

## Subscription Plans

| Plan | Price | Duration |
|------|-------|----------|
| Monthly | ₹31 | 30 days |
| Annual | ₹365 | 365 days |
| Lifetime | ₹1,000 | Forever |

Payments processed via Razorpay. Webhook endpoint at `/api/webhook` handles fulfillment idempotently.

---

## Security Highlights

- CORS restricted to `ALLOWED_ORIGIN` env var
- Rate limiting on all payment API endpoints
- HMAC-SHA256 webhook signature verification
- Google OAuth tokens stored in `localStorage` (deliberate — enables silent background refresh across sessions without re-prompting the user to reconnect Gmail; access token is short-lived (~58 min) and the refresh token never leaves the browser except to our own `/api/refresh-google-token` endpoint)
- No email bodies stored — only vendor, amount, date, time, card issuer/brand
- RLS enforced at the database layer on all tables
- CSP, HSTS, XSS headers set by Vercel

---

## Mobile Build (Android / iOS)

See [MOBILE_SETUP.md](MOBILE_SETUP.md) for the full Capacitor build guide.

```bash
npm run build
npx cap sync android
npx cap open android   # opens Android Studio
```

---

## Admin / Owner Access

Set `VITE_OWNER_EMAILS` to a comma-separated list of admin emails. Owner accounts:
- Bypass the premium gate
- Bypass the 24-hour scan cooldown
- Can view all feedback and signin logs, gated by `public.is_admin()` (reads `profiles.is_admin`).
  An older policy granted this to any JWT whose email matched an unregistered domain; migration
  `039_fix_signin_logs_admin_read.sql` replaced it, and production was verified clean on 2026-08-25.

---

## Transfer / Handover

See [TRANSFER_GUIDE.md](TRANSFER_GUIDE.md) for the full service handover checklist.

---

## License

Proprietary — All rights reserved.
