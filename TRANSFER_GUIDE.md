# Intrack — Transfer & Handover Guide

This document covers everything a new owner needs to take full control of the Intrack codebase and all connected services.

---

## 1. Services Checklist

| Service | What to transfer | Notes |
|---------|-----------------|-------|
| GitHub repo | Transfer ownership or fork | Settings → Danger Zone → Transfer |
| Vercel project | Transfer to buyer's team | Settings → Transfer Project |
| Supabase project | Invite buyer, rotate keys | See Section 3 |
| Google Cloud project | Transfer OAuth consent screen ownership | See Section 4 |
| Razorpay account | Buyer sets up their own account | See Section 5 |
| PostHog project | Invite member or transfer | Settings → Members |
| Domain (if any) | Transfer at your registrar | Update DNS / Vercel domain settings |

---

## 2. Environment Variables to Update

After transfer, the buyer must update these in Vercel (Settings → Environment Variables):

| Variable | Action |
|----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in Supabase — old key gives full DB admin access |
| `VITE_SUPABASE_ANON_KEY` | Rotate in Supabase |
| `VITE_SUPABASE_URL` | Update if moving to a new Supabase project |
| `RAZORPAY_KEY_ID` | Replace with buyer's Razorpay live key |
| `RAZORPAY_KEY_SECRET` | Replace with buyer's Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | Set a new strong secret in Razorpay dashboard |
| `VITE_RAZORPAY_KEY_ID` | Same as `RAZORPAY_KEY_ID` (used client-side) |
| `VITE_GOOGLE_CLIENT_ID` | Replace with buyer's Google Cloud OAuth client ID |
| `GEMINI_API_KEY` | Replace with buyer's Gemini API key (server-side only, consumed by `api/gemini-proxy.ts` — do NOT use a `VITE_`-prefixed name, that would expose it in the client bundle) |
| `ALLOWED_ORIGIN` | Set to buyer's production domain |
| `VITE_OWNER_EMAILS` | Set to buyer's admin email(s) |
| `VITE_PROMO_CODES` | Update or remove |

Also update in source code:
- `src/constants/index.ts` → `APP_CONFIG.SUPPORT_EMAIL`, `SUPPORT_NAME`, `SUPPORT_ADDRESS`
- `index.html` → OG/Twitter meta tag URLs
- `GOOGLE_VERIFICATION_GUIDE.md` → support email references

---

## 3. Supabase Transfer

### Option A — Transfer existing project (keeps all user data)
1. Seller: Supabase Dashboard → Settings → General → Transfer Project → enter buyer's Supabase org
2. Buyer accepts the transfer invitation
3. Both parties rotate the service role key immediately after transfer:
   - Settings → API → Reveal service role key → Regenerate
4. Update `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_ANON_KEY` in Vercel

### Option B — Fresh Supabase project (for a clean start)
1. Buyer creates a new Supabase project
2. Run `supabase/schema.sql` in the SQL editor (this is the single, complete, up-to-date schema — no other migration files need to be run)
3. Update all `VITE_SUPABASE_URL` and key env vars in Vercel
4. Note: existing user data will NOT transfer — only suitable for pre-launch sale

### Admin Access
Admin/creator access (viewing all feedback, signin logs, profiles) is granted per-account via the `profiles.is_admin` column, checked through the `public.is_admin()` SQL function — not by email domain. After transfer, the buyer should grant themselves admin access by running:
```sql
UPDATE public.profiles SET is_admin = true WHERE email = 'buyer@example.com';
```
and revoke it from the previous owner's account if it transfers with the project.

---

## 4. Google Cloud / OAuth Transfer

The Gmail read-only scope requires Google OAuth App Verification. The existing verification is tied to the current owner's Google Cloud project.

**Steps:**
1. Seller: Google Cloud Console → IAM → Add buyer as Owner
2. Buyer: Verify they can access APIs & Services → OAuth consent screen
3. Update the OAuth consent screen:
   - User Support Email → buyer's email
   - Developer contact → buyer's email
4. Credentials → OAuth 2.0 Client IDs → note the client ID
5. Update `VITE_GOOGLE_CLIENT_ID` in Vercel to the new/existing client ID
6. Add the new production domain to Authorized JavaScript Origins and Redirect URIs

**Re-verification:** If the buyer uses a different domain or Google Cloud project, they must re-submit for OAuth verification. See `GOOGLE_VERIFICATION_GUIDE.md` for the full process. This typically takes 1–4 weeks.

---

## 5. Razorpay Setup

Razorpay accounts are KYC-linked and cannot be transferred between individuals.

**Buyer steps:**
1. Create a new Razorpay account at razorpay.com
2. Complete KYC (individual or business)
3. Go to Settings → API Keys → Generate Live Key
4. Update `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `VITE_RAZORPAY_KEY_ID` in Vercel
5. Webhooks → Add webhook URL: `https://your-domain.vercel.app/api/webhook`
   - Enable events: `payment.captured`, `subscription.charged`
   - Set a strong webhook secret → update `RAZORPAY_WEBHOOK_SECRET` in Vercel
6. Update subscription plan prices if needed (currently ₹31/mo, ₹365/yr, ₹1000 lifetime)

---

## 6. Vercel Transfer

1. Vercel Dashboard → Project Settings → General → Transfer Project
2. Enter the buyer's Vercel team/account name
3. Buyer accepts the transfer
4. Buyer re-adds all environment variables (they are NOT transferred for security)
5. Trigger a redeploy after adding env vars

---

## 7. Domain Transfer (if applicable)

If a custom domain is configured:
1. Transfer the domain at your registrar (GoDaddy / Namecheap / etc.)
2. Buyer updates DNS records to point to their Vercel project
3. Update `ALLOWED_ORIGIN` in Vercel env vars to the new domain
4. Update OG/Twitter meta tags in `index.html`
5. Update `GOOGLE_VERIFICATION_GUIDE.md` domain references
6. Re-submit domain verification in Google Search Console

---

## 8. Subscription / User Data

- Existing Razorpay subscriptions are tied to the seller's Razorpay account. Active subscribers will continue billing to the seller's account until their cycle ends.
- Recommendation: seller handles refunds/cancellations for existing subscribers, or both parties agree on a revenue-split period.
- User data in Supabase is portable via the project transfer (Option A above).

---

## 9. Post-Transfer Smoke Test

After all keys are rotated and env vars are updated, verify:

- [ ] App loads at the new domain
- [ ] Google OAuth login works (Gmail connect)
- [ ] Email scan runs without errors
- [ ] Razorpay payment flow completes (use test mode first)
- [ ] Webhook receives and processes payment events
- [ ] Subscription status updates in the user profile after payment

---

## 10. Support

All contact details are centralised in `src/constants/index.ts` → `APP_CONFIG`. Update `SUPPORT_EMAIL`, `SUPPORT_NAME`, and `SUPPORT_ADDRESS` once and they propagate to Privacy Policy, Refund Policy, and Support pages automatically.

---

## Granting admin access

The admin section at `/admin` is visible only to accounts whose `profiles.is_admin`
column is `true`. There is deliberately no button for this — an app that can hand out
admin rights from its own interface is one compromised session away from losing
everything.

To make an account admin, run this once in the Supabase SQL editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

To revoke, set it back to `false`. The change takes effect the next time that user's
profile loads.
