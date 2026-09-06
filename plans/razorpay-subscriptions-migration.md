# Razorpay Subscriptions Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell auto-renewing plans through Razorpay Subscriptions so renewal, retries, mandates, customer notifications and per-cycle invoices are handled by Razorpay instead of by hand.

**Architecture:** Entitlement does not change. `profiles.subscription_status` plus `subscription_expires_at` stay the single source of truth, so `ProtectedRoute`, `AuthContext` and `AccessEnded` are untouched. A Razorpay subscription is simply a machine that produces a paid period on a schedule; each `subscription.charged` webhook extends the expiry through a new, dedicated RPC. The existing one-time path stays intact so customers who already bought a fixed period keep it to the day.

**Tech Stack:** Razorpay Subscriptions API + webhooks, Vercel serverless functions (`api/`), Supabase Postgres (RPC + RLS + guard trigger), React 19 + TypeScript, vitest.

---

## Scope

**In scope:** Razorpay plan/subscription creation, the webhook path that turns a
charge into access, cancellation, and the pricing UI that sells it.

**Out of scope, tracked separately:**
- Policy rewrites — `plans/policy-audit-and-industry-standard.md`. **These must
  ship with or before this change**: all three documents currently promise
  "nothing renews, no mandate is placed on your card", which this plan makes
  false.
- Receipts and billing history — `plans/receipts-and-billing-history.md`.
  Razorpay now delivers per-cycle invoices to customers, so that plan's
  customer-facing half shrinks; the in-app history does not.
- The `/payment-success` defects — `plans/payment-success-audit.md`.

## Key decisions

**1. Coexistence, not cutover.** Existing one-time customers keep their paid
period. `api/create-order.ts` and `api/verify-payment.ts` stay working and
tested. The pricing page simply stops selling new one-time plans. Delete that
path only once no profile holds a future `subscription_expires_at` from it.

**2. The trial stays in-app and card-free.** Razorpay subscriptions support a
trial via a future `start_at`, but that still requires mandate authorisation up
front. Keeping the 7-day trial exactly where it is — in the app, no card —
protects trial conversion. A Razorpay subscription is created only at purchase.

**3. A dedicated RPC, not an overload of `apply_plan_purchase()`.** That function
encodes the owner's one-time plan-change rules: an upgrade drops remaining days,
a same-plan repurchase queues behind the running plan. A renewal wants neither —
it wants a straight extension from `GREATEST(now(), expiry)`. Overloading it
would make a renewal land in the `queued` branch and depend on
`activate_pending_plan()` firing later. `apply_subscription_charge()` states the
renewal semantic directly, and leaves the hardened one-time rules untouched.

**4. Idempotency key is the invoice id.** Razorpay retries webhooks. Each cycle
carries its own `invoice.id`, which is stored and checked the same way
`razorpay_order_id` is today.

**5. `razorpay_subscription_id` already exists.** Migration 021 delivered it to
production and `035`'s guard trigger already protects it. No new column is
needed for the link between a profile and its subscription.

## File structure

| File | Responsibility |
|---|---|
| `supabase/044_subscription_renewals.sql` | New: `subscription_charges` table, `apply_subscription_charge()` RPC, grants |
| `api/_lib/subscriptionPlans.ts` | New: maps `'monthly' \| 'annual'` to Razorpay plan id and duration. Single source, imported by both the creator and the webhook |
| `api/create-subscription.ts` | New: authenticated endpoint that creates a Razorpay subscription and returns its id for checkout |
| `api/cancel-subscription.ts` | New: authenticated endpoint that cancels at cycle end |
| `api/webhook.ts` | Modify: handle `subscription.charged`, `subscription.cancelled`, `subscription.halted` alongside the existing `order.paid` |
| `src/services/subscriptionBilling.ts` | New: browser-side calls to the two endpoints above |
| `src/pages/PricingPage.tsx` | Modify: checkout opens a subscription instead of an order |
| `src/pages/ProfilePage.tsx` | Modify: show renewal state and a cancel control |

---

## Task 1: Plan mapping

**Files:**
- Create: `api/_lib/subscriptionPlans.ts`
- Test: `api/_lib/subscriptionPlans.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { planIdFor, durationDaysFor, planTypeForPlanId } from './subscriptionPlans.js'

describe('subscriptionPlans', () => {
  const env = { RAZORPAY_PLAN_MONTHLY: 'plan_mon', RAZORPAY_PLAN_ANNUAL: 'plan_ann' }

  it('maps plan types to configured Razorpay plan ids', () => {
    expect(planIdFor('monthly', env)).toBe('plan_mon')
    expect(planIdFor('annual', env)).toBe('plan_ann')
  })

  it('throws when a plan id is not configured, rather than charging the wrong plan', () => {
    expect(() => planIdFor('monthly', {})).toThrow(/not configured/i)
  })

  it('rejects an unknown plan type', () => {
    expect(() => planIdFor('lifetime' as any, env)).toThrow(/unknown plan type/i)
  })

  it('reports the duration each plan buys', () => {
    expect(durationDaysFor('monthly')).toBe(30)
    expect(durationDaysFor('annual')).toBe(365)
  })

  it('maps a Razorpay plan id back to a plan type', () => {
    expect(planTypeForPlanId('plan_ann', env)).toBe('annual')
    expect(planTypeForPlanId('plan_unknown', env)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run api/_lib/subscriptionPlans.test.ts`
Expected: FAIL — cannot resolve `./subscriptionPlans.js`

- [ ] **Step 3: Write the implementation**

```ts
export type PlanType = 'monthly' | 'annual'

type Env = Record<string, string | undefined>

const DURATION_DAYS: Record<PlanType, number> = { monthly: 30, annual: 365 }

const ENV_KEY: Record<PlanType, string> = {
  monthly: 'RAZORPAY_PLAN_MONTHLY',
  annual: 'RAZORPAY_PLAN_ANNUAL',
}

/**
 * Plan ids come from the environment, never from the request body. The body is
 * what verify-payment.ts already exists to distrust, and a caller who could
 * choose the Razorpay plan could choose its price.
 */
export function planIdFor(planType: PlanType, env: Env = process.env): string {
  const key = ENV_KEY[planType]
  if (!key) throw new Error(`Unknown plan type: ${planType}`)
  const planId = env[key]
  if (!planId) throw new Error(`Razorpay plan id not configured for ${planType} (${key})`)
  return planId
}

export function durationDaysFor(planType: PlanType): number {
  const days = DURATION_DAYS[planType]
  if (!days) throw new Error(`Unknown plan type: ${planType}`)
  return days
}

/**
 * The webhook receives a plan id and must decide what was bought. Returns null
 * rather than guessing, so an unrecognised plan is logged and ignored instead
 * of silently granting the wrong period.
 */
export function planTypeForPlanId(planId: string, env: Env = process.env): PlanType | null {
  for (const type of Object.keys(ENV_KEY) as PlanType[]) {
    if (env[ENV_KEY[type]] === planId) return type
  }
  return null
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run api/_lib/subscriptionPlans.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add api/_lib/subscriptionPlans.ts api/_lib/subscriptionPlans.test.ts
git commit -m "feat: map plan types to Razorpay subscription plan ids"
```

---

## Task 2: The renewal migration

**Files:**
- Create: `supabase/044_subscription_renewals.sql`
- Modify: `supabase/schema.sql` (safety-net block + table definition)

Per `CLAUDE.md`, anything added to `schema.sql` reaches production only if a
numbered migration delivers it too. Both are edited in this task, and the
migration runs before any code merges.

- [ ] **Step 1: Write the migration**

```sql
-- 044_subscription_renewals.sql
--
-- Auto-renewing plans via Razorpay Subscriptions.
--
-- Entitlement is unchanged: profiles.subscription_status and
-- subscription_expires_at remain the only thing the app gates on. A renewal is
-- just another paid period arriving on a schedule.
--
-- apply_plan_purchase() is deliberately NOT reused. It encodes the owner's
-- one-time plan-change rules (035): an upgrade drops remaining days, a
-- same-plan repurchase QUEUES behind the running plan. A renewal wants a plain
-- extension, and routing it through the queue would make continuity depend on
-- activate_pending_plan() firing later.

BEGIN;

-- Every charge Razorpay reports, once. The unique index is the idempotency
-- key: Razorpay retries webhooks until acknowledged, and a retry must never
-- buy a second period.
CREATE TABLE IF NOT EXISTS public.subscription_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  razorpay_subscription_id TEXT NOT NULL,
  razorpay_invoice_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'annual')),
  duration_days INT NOT NULL,
  amount_inr NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_charges_invoice
  ON public.subscription_charges(razorpay_invoice_id);

CREATE INDEX IF NOT EXISTS idx_subscription_charges_user
  ON public.subscription_charges(user_id, created_at DESC);

ALTER TABLE public.subscription_charges ENABLE ROW LEVEL SECURITY;

-- Same shape as payments (025): the owner reads, an admin reads everything,
-- nobody writes from a browser.
DROP POLICY IF EXISTS "Users can view own subscription charges" ON public.subscription_charges;
CREATE POLICY "Users can view own subscription charges"
  ON public.subscription_charges FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_subscription_charge(
  p_user_id         UUID,
  p_subscription_id TEXT,
  p_invoice_id      TEXT,
  p_plan_type       TEXT,
  p_duration_days   INT,
  p_amount_inr      NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.profiles%ROWTYPE;
  v_base    TIMESTAMPTZ;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 3650 THEN
    RAISE EXCEPTION 'apply_subscription_charge: implausible duration_days %', p_duration_days;
  END IF;
  IF p_plan_type IS NULL OR p_plan_type NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'apply_subscription_charge: unknown plan_type %', p_plan_type;
  END IF;
  IF p_invoice_id IS NULL OR p_invoice_id = '' THEN
    RAISE EXCEPTION 'apply_subscription_charge: invoice id is required for idempotency';
  END IF;

  -- Same locking discipline as apply_plan_purchase (035). Two concurrent
  -- deliveries of one invoice serialise here; the second sees the row the
  -- first inserted.
  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;   -- caller treats NULL as a hard failure
  END IF;

  IF EXISTS (SELECT 1 FROM public.subscription_charges
              WHERE razorpay_invoice_id = p_invoice_id) THEN
    RETURN jsonb_build_object(
      'outcome',    'already_applied',
      'expires_at', v_row.subscription_expires_at
    );
  END IF;

  -- Extend from whichever is later. A renewal that arrives before the current
  -- period ends must not delete the remaining days; one that arrives after a
  -- lapse must not backdate into the past.
  v_base := GREATEST(now(), COALESCE(v_row.subscription_expires_at, now()));
  v_expires := v_base + make_interval(days => p_duration_days);

  INSERT INTO public.subscription_charges (
    user_id, razorpay_subscription_id, razorpay_invoice_id,
    plan_type, duration_days, amount_inr
  ) VALUES (
    p_user_id, p_subscription_id, p_invoice_id,
    p_plan_type, p_duration_days, COALESCE(p_amount_inr, 0)
  );

  UPDATE public.profiles SET
    subscription_status      = 'active',
    subscription_plan_type   = p_plan_type,
    subscription_expires_at  = v_expires,
    razorpay_subscription_id = p_subscription_id,
    updated_at               = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('outcome', 'charged', 'expires_at', v_expires);
END;
$$;

-- Supabase projects carry ALTER DEFAULT PRIVILEGES granting EXECUTE to anon and
-- authenticated DIRECTLY, and REVOKE ... FROM PUBLIC does not strip a direct
-- role grant. Both roles are revoked by name, same as 035 and 012.
REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) TO service_role;

COMMIT;

-- Verify afterwards, in the Supabase SQL editor.
--
-- Each Run is a separate pooled session, so the impersonation line must lead
-- EVERY Run it applies to — a set_config from a previous Run is gone. Put the
-- SELECT whose output you want to read last.
--
--   -- expect prosecdef true and search_path pinned
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'apply_subscription_charge';
--
--   -- expect service_role ONLY
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public' AND routine_name = 'apply_subscription_charge';
--
-- On a throwaway account (substitute its uuid):
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles
--      SET subscription_status = 'expired',
--          subscription_expires_at = now() - interval '10 days',
--          razorpay_subscription_id = NULL
--    WHERE id = '<uuid>';
--   SELECT public.apply_subscription_charge('<uuid>','sub_1','inv_1','monthly',30,31);
--   -- expect outcome 'charged', expires ~30 days from NOW (not from the lapse).
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>','sub_1','inv_1','monthly',30,31);
--   -- expect 'already_applied' and the SAME expires_at. This is the retry case.
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>','sub_1','inv_2','monthly',30,31);
--   -- expect 'charged', expires ~60 days out: the remaining days were KEPT.
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('00000000-0000-0000-0000-000000000000',
--                                           'sub_x','inv_x','monthly',30,31);
--   -- expect NULL, nothing written.
--
--   SELECT set_config('request.jwt.claims', '', false);
```

- [ ] **Step 2: Mirror it into `schema.sql`**

Add the `subscription_charges` table definition next to `payments`, and add
this to the safety-net `ALTER` block so a database built from `schema.sql`
matches production:

```sql
CREATE TABLE IF NOT EXISTS public.subscription_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  razorpay_subscription_id TEXT NOT NULL,
  razorpay_invoice_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'annual')),
  duration_days INT NOT NULL,
  amount_inr NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Run the migration against production and verify the grants**

Run `supabase/044_subscription_renewals.sql` in the Supabase SQL editor, then
run every verification query in its trailing comment block. **Do not merge any
code from later tasks until the grants query returns `service_role` and nothing
else.** This ordering is the standing rule in `CLAUDE.md`, and it exists because
a missing grant has broken production twice.

- [ ] **Step 4: Commit**

```bash
git add supabase/044_subscription_renewals.sql supabase/schema.sql
git commit -m "feat: add subscription_charges and apply_subscription_charge for renewals"
```

---

## Task 3: Create-subscription endpoint

**Files:**
- Create: `api/create-subscription.ts`
- Test: `api/create-subscription.test.ts`

Model the structure on `api/create-order.ts` — same CORS parsing, same
in-memory rate limiter, same "derive the user id from the token, never the
body" rule.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockGetUser = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('razorpay', () => ({
  default: class { subscriptions = { create: mockCreate } },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

const { default: handler } = await import('./create-subscription.js')

function res() {
  const r: any = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k: string, v: string) => { r.headers[k] = v }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  r.end = () => r
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RAZORPAY_PLAN_MONTHLY = 'plan_mon'
  process.env.RAZORPAY_PLAN_ANNUAL = 'plan_ann'
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: null } })
})

describe('create-subscription', () => {
  it('rejects an unauthenticated caller', async () => {
    const r = res()
    await handler({ method: 'POST', headers: {}, body: { planType: 'monthly' } } as any, r)
    expect(r.statusCode).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown plan type before calling Razorpay', async () => {
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'lifetime' },
    } as any, r)
    expect(r.statusCode).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a subscription on the configured plan and tags it with the user id', async () => {
    mockCreate.mockResolvedValue({ id: 'sub_1', status: 'created' })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'annual' },
    } as any, r)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan_ann',
      total_count: expect.any(Number),
      customer_notify: 1,
      notes: { userId: 'user-1', planType: 'annual' },
    }))
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ id: 'sub_1', planType: 'annual' })
  })

  it('refuses to create a second subscription while one is already active', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: 'sub_existing' } })
    const r = res()
    await handler({
      method: 'POST', headers: { authorization: 'Bearer t' }, body: { planType: 'monthly' },
    } as any, r)
    expect(r.statusCode).toBe(409)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run api/create-subscription.test.ts`
Expected: FAIL — cannot resolve `./create-subscription.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'
import { planIdFor, type PlanType } from './_lib/subscriptionPlans.js'

const razorpayKeyId = [process.env.RAZORPAY_KEY_ID, process.env.VITE_RAZORPAY_KEY_ID]
  .find(k => k && k.startsWith('rzp_')) || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || ''

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
})

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 10) return true
  entry.count++
  return false
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

// 100 years of monthly cycles is Razorpay's documented maximum; these are the
// counts that mean "until cancelled" for each cadence.
const TOTAL_COUNT: Record<PlanType, number> = { monthly: 120, annual: 10 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  // The subscription's notes.userId is later trusted by webhook.ts to attribute
  // a charge to an account, so it is derived from the caller's own token here.
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = user.id

  const { planType } = req.body ?? {}
  if (planType !== 'monthly' && planType !== 'annual') {
    return res.status(400).json({ error: 'Invalid planType. Must be monthly or annual.' })
  }

  // One subscription at a time. A second mandate would charge the customer
  // twice for the same product, which is the failure the refund policy calls a
  // duplicate billing — refused here, before any money moves.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('razorpay_subscription_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileRow?.razorpay_subscription_id) {
    return res.status(409).json({
      error: 'You already have an active subscription. Cancel it before starting a new one.',
      code: 'SUBSCRIPTION_ALREADY_ACTIVE',
    })
  }

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: planIdFor(planType),
      total_count: TOTAL_COUNT[planType as PlanType],
      // Razorpay sends the customer the authorisation, charge, failure and
      // cancellation emails. This is the flag that turns them on.
      customer_notify: 1,
      notes: { userId, planType },
    })

    return res.status(200).json({ id: subscription.id, planType })
  } catch (error: any) {
    console.error('Error creating Razorpay subscription:', error)
    const isAuthError = error.statusCode === 401 || /auth|key/i.test(error.message || '')
    return res.status(isAuthError ? 401 : 500).json({
      error: error.message || 'Failed to create subscription',
    })
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run api/create-subscription.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add api/create-subscription.ts api/create-subscription.test.ts
git commit -m "feat: add create-subscription endpoint for auto-renewing plans"
```

---

## Task 4: Handle subscription webhooks

**Files:**
- Modify: `api/webhook.ts`
- Test: `api/webhook.subscriptions.test.ts`

The existing `order.paid` branch is untouched — one-time customers still in
their paid period depend on it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockInsert = vi.fn(() => ({ then: (fn: any) => fn({ error: null }) }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc, from: () => ({ insert: mockInsert }) }),
}))
vi.mock('./_lib/razorpaySignature.js', () => ({
  verifyHmacSignature: () => true,
  planDurationDays: (p: string) => (p === 'annual' ? 365 : 30),
}))

const { default: handler } = await import('./webhook.js')

function reqWith(event: any) {
  const body = JSON.stringify(event)
  return {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'sig' },
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(body) },
  } as any
}

function res() {
  const r: any = { statusCode: 0, body: null }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RAZORPAY_PLAN_MONTHLY = 'plan_mon'
  process.env.RAZORPAY_PLAN_ANNUAL = 'plan_ann'
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
})

describe('webhook — subscription events', () => {
  const charged = {
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: 'sub_1', plan_id: 'plan_ann', notes: { userId: 'user-1' } } },
      payment: { entity: { invoice_id: 'inv_1', amount: 36500 } },
    },
  }

  it('extends access through apply_subscription_charge', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'charged' }, error: null })
    const r = res()
    await handler(reqWith(charged), r)
    expect(mockRpc).toHaveBeenCalledWith('apply_subscription_charge', {
      p_user_id: 'user-1',
      p_subscription_id: 'sub_1',
      p_invoice_id: 'inv_1',
      p_plan_type: 'annual',
      p_duration_days: 365,
      p_amount_inr: 365,
    })
    expect(r.statusCode).toBe(200)
  })

  it('ignores a charge whose plan id is not one of ours rather than guessing', async () => {
    const unknown = JSON.parse(JSON.stringify(charged))
    unknown.payload.subscription.entity.plan_id = 'plan_someone_else'
    const r = res()
    await handler(reqWith(unknown), r)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(r.statusCode).toBe(200)
    expect(r.body.status).toBe('ignored_unknown_plan')
  })

  it('ignores a charge with no userId in notes', async () => {
    const orphan = JSON.parse(JSON.stringify(charged))
    orphan.payload.subscription.entity.notes = {}
    const r = res()
    await handler(reqWith(orphan), r)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(r.body.status).toBe('ignored_missing_notes')
  })

  it('clears the stored subscription id on cancellation but leaves access alone', async () => {
    const cancelled = {
      event: 'subscription.cancelled',
      payload: { subscription: { entity: { id: 'sub_1', notes: { userId: 'user-1' } } } },
    }
    mockRpc.mockResolvedValue({ data: true, error: null })
    const r = res()
    await handler(reqWith(cancelled), r)
    expect(mockRpc).toHaveBeenCalledWith('clear_subscription_link', {
      p_user_id: 'user-1',
      p_subscription_id: 'sub_1',
    })
    expect(r.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run api/webhook.subscriptions.test.ts`
Expected: FAIL — `mockRpc` not called with `apply_subscription_charge`

- [ ] **Step 3: Add `clear_subscription_link` to the migration**

Append to `supabase/044_subscription_renewals.sql`, then re-run it:

```sql
BEGIN;

-- Cancellation unlinks the mandate. It deliberately does NOT touch
-- subscription_expires_at: the customer paid for the period they are in and
-- keeps it to the day, which is what the Refund Policy promises. Access simply
-- lapses when that date arrives, because nothing renews it any more.
CREATE OR REPLACE FUNCTION public.clear_subscription_link(
  p_user_id         UUID,
  p_subscription_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET razorpay_subscription_id = NULL,
         updated_at = now()
   WHERE id = p_user_id
     AND razorpay_subscription_id = p_subscription_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_subscription_link(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_subscription_link(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_subscription_link(UUID, TEXT) TO service_role;

COMMIT;
```

- [ ] **Step 4: Add the subscription branches to `api/webhook.ts`**

Add the import at the top, beside the existing ones:

```ts
import { planTypeForPlanId, durationDaysFor } from './_lib/subscriptionPlans.js'
```

Then, inside the `try` block, after the existing `if (event.event === 'order.paid') { ... }` block and before `return res.status(200).json({ status: 'ok' })`:

```ts
    if (event.event === 'subscription.charged') {
      const sub = event.payload.subscription.entity
      const payment = event.payload.payment?.entity
      const { userId } = sub.notes || {}

      if (!userId) {
        console.warn('Webhook subscription.charged missing userId in notes')
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      // Never guess a plan. An unrecognised plan id means someone else's plan
      // or a plan created outside this app, and granting a period for it would
      // hand out access nobody paid us for.
      const planType = planTypeForPlanId(sub.plan_id)
      if (!planType) {
        console.warn('Webhook subscription.charged for unknown plan:', sub.plan_id)
        return res.status(200).json({ status: 'ignored_unknown_plan' })
      }

      // The invoice id is the idempotency key: Razorpay retries this webhook
      // until acknowledged, and each cycle has exactly one invoice.
      const invoiceId = payment?.invoice_id
      if (!invoiceId) {
        console.warn('Webhook subscription.charged missing invoice id for', sub.id)
        return res.status(200).json({ status: 'ignored_missing_invoice' })
      }

      const { data: result, error } = await supabaseAdmin.rpc('apply_subscription_charge', {
        p_user_id: userId,
        p_subscription_id: sub.id,
        p_invoice_id: invoiceId,
        p_plan_type: planType,
        p_duration_days: durationDaysFor(planType),
        // Razorpay reports paise; amount_inr holds rupees.
        p_amount_inr: typeof payment?.amount === 'number' ? payment.amount / 100 : 0,
      })

      if (error) throw error
      if (!result) {
        console.error('Subscription charge matched no profile for userId:', userId, 'sub:', sub.id)
        throw new Error('No matching profile found to update.')
      }
      console.log(`Webhook applied ${invoiceId} for user ${userId}: ${result.outcome}`)
    }

    // 'halted' means Razorpay has exhausted its retries. Nothing is revoked
    // here: the period already paid for runs to its end date and then lapses on
    // its own. Razorpay has already emailed the customer an "Update Card" link.
    if (event.event === 'subscription.cancelled' || event.event === 'subscription.halted') {
      const sub = event.payload.subscription.entity
      const { userId } = sub.notes || {}
      if (!userId) {
        console.warn(`Webhook ${event.event} missing userId in notes`)
        return res.status(200).json({ status: 'ignored_missing_notes' })
      }

      const { error } = await supabaseAdmin.rpc('clear_subscription_link', {
        p_user_id: userId,
        p_subscription_id: sub.id,
      })
      if (error) throw error
      console.log(`Webhook ${event.event} unlinked subscription ${sub.id} for user ${userId}`)
    }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run api/webhook.subscriptions.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Run the whole suite to prove `order.paid` still works**

Run: `npm test -- --run`
Expected: PASS, no regressions in the existing webhook tests

- [ ] **Step 7: Commit**

```bash
git add api/webhook.ts api/webhook.subscriptions.test.ts supabase/044_subscription_renewals.sql
git commit -m "feat: apply Razorpay subscription charges and cancellations from the webhook"
```

---

## Task 5: Cancel endpoint

**Files:**
- Create: `api/cancel-subscription.ts`
- Test: `api/cancel-subscription.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCancel = vi.fn()
const mockGetUser = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('razorpay', () => ({
  default: class { subscriptions = { cancel: mockCancel } },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

const { default: handler } = await import('./cancel-subscription.js')

function res() {
  const r: any = { statusCode: 0, body: null, headers: {} }
  r.setHeader = (k: string, v: string) => { r.headers[k] = v }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  r.end = () => r
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

describe('cancel-subscription', () => {
  it('cancels at cycle end so paid-for access is not withdrawn early', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: 'sub_1' } })
    mockCancel.mockResolvedValue({ id: 'sub_1', status: 'cancelled' })
    const r = res()
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' } } as any, r)
    // `false` is Razorpay's cancel_at_cycle_end = false; we pass true.
    expect(mockCancel).toHaveBeenCalledWith('sub_1', true)
    expect(r.statusCode).toBe(200)
  })

  it('returns 404 when the account has no subscription', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { razorpay_subscription_id: null } })
    const r = res()
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' } } as any, r)
    expect(r.statusCode).toBe(404)
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    const r = res()
    await handler({ method: 'POST', headers: {} } as any, r)
    expect(r.statusCode).toBe(401)
    expect(mockCancel).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run api/cancel-subscription.test.ts`
Expected: FAIL — cannot resolve `./cancel-subscription.js`

- [ ] **Step 3: Write the implementation**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'

const razorpayKeyId = [process.env.RAZORPAY_KEY_ID, process.env.VITE_RAZORPAY_KEY_ID]
  .find(k => k && k.startsWith('rzp_')) || process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || ''

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
})

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.intrack.co.in'
const ALLOWED_ORIGINS = ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // The subscription id comes from the caller's own profile row, never from the
  // request body. Otherwise one account could cancel another's subscription.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('razorpay_subscription_id')
    .eq('id', user.id)
    .maybeSingle()

  const subscriptionId = profileRow?.razorpay_subscription_id
  if (!subscriptionId) {
    return res.status(404).json({ error: 'No active subscription found on this account.' })
  }

  try {
    // cancel_at_cycle_end = true. Cancelling immediately would withdraw access
    // the customer has already paid for, which the Refund Policy forbids.
    // profiles.razorpay_subscription_id is cleared by the subscription.cancelled
    // webhook, not here, so one path owns that write.
    await razorpay.subscriptions.cancel(subscriptionId, true)
    return res.status(200).json({ cancelled: true, atCycleEnd: true })
  } catch (error: any) {
    console.error('Error cancelling Razorpay subscription:', subscriptionId, error)
    return res.status(500).json({ error: error.message || 'Failed to cancel subscription' })
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run api/cancel-subscription.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add api/cancel-subscription.ts api/cancel-subscription.test.ts
git commit -m "feat: let a customer cancel their subscription at cycle end"
```

---

## Task 6: Browser-side billing service

**Files:**
- Create: `src/services/subscriptionBilling.ts`
- Test: `src/services/subscriptionBilling.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubscription, cancelSubscription } from './subscriptionBilling'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as any
})

describe('subscriptionBilling', () => {
  it('sends the access token and returns the subscription id', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_1', planType: 'annual' }) })
    const result = await createSubscription('annual', 'token-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/create-subscription', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      body: JSON.stringify({ planType: 'annual' }),
    }))
    expect(result).toEqual({ id: 'sub_1', planType: 'annual' })
  })

  it('throws the server message so the toast says what actually went wrong', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'You already have an active subscription.' }),
    })
    await expect(createSubscription('monthly', 'token-1'))
      .rejects.toThrow('You already have an active subscription.')
  })

  it('cancels through the endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ cancelled: true }) })
    await expect(cancelSubscription('token-1')).resolves.toEqual({ cancelled: true })
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/services/subscriptionBilling.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
export type PlanType = 'monthly' | 'annual'

async function post<T>(path: string, accessToken: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = await response.json()
  // The server's message is the useful one — it distinguishes "already
  // subscribed" from "payments are not configured". A generic string here
  // would throw that away.
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Request failed')
  }
  return data as T
}

export function createSubscription(planType: PlanType, accessToken: string) {
  return post<{ id: string; planType: PlanType }>('/api/create-subscription', accessToken, { planType })
}

export function cancelSubscription(accessToken: string) {
  return post<{ cancelled: boolean; atCycleEnd: boolean }>('/api/cancel-subscription', accessToken)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/services/subscriptionBilling.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/subscriptionBilling.ts src/services/subscriptionBilling.test.ts
git commit -m "feat: add browser-side subscription billing service"
```

---

## Task 7: Sell subscriptions from the pricing page

**Files:**
- Modify: `src/pages/PricingPage.tsx:150-240` (the `handlePayment` Razorpay block)

- [ ] **Step 1: Replace the order flow with the subscription flow**

In the checkout handler, replace the `/api/create-order` call and the
`options` object's `order_id` with a subscription. The Razorpay checkout takes
`subscription_id` in place of `order_id`; everything else about the sheet is
unchanged.

```ts
const { id: subscriptionId } = await createSubscription(selectedPlan, session.access_token)

const options = {
  key: clientKey,
  // Razorpay derives the amount and cadence from the plan, so no amount or
  // currency is passed for a subscription.
  subscription_id: subscriptionId,
  name: APP_CONFIG.APP_NAME,
  description: `${planName} plan`,
  prefill: { name: profile?.full_name || '', email: user.email || '' },
  theme: { color: '#0e7a5d' },
  handler: async () => {
    // There is no verify step any more. The authorisation payment and every
    // renewal arrive as subscription.charged webhooks, and the webhook is the
    // only thing that grants access — a browser that closes early, or a
    // handler that never runs, no longer costs the customer their plan.
    await refreshProfile()
    showToast(`Payment received. Your ${planName} plan activates in a moment.`, 'success')
    navigate('/payment-success', { state: { planName, subscription: true } })
  },
  modal: { ondismiss: () => setProcessing(false) },
}
```

Import the service at the top of the file:

```ts
import { createSubscription } from '@/services/subscriptionBilling'
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Verify in the browser**

Use Razorpay **test mode** keys and test plan ids. Open the pricing page, buy
the monthly plan, and confirm: the sheet shows a mandate authorisation, the
profile flips to active once the webhook lands, and `subscription_charges` holds
exactly one row.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PricingPage.tsx
git commit -m "feat: sell auto-renewing subscriptions from the pricing page"
```

---

## Task 8: Renewal state and cancel control

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Add the plan card**

Show, from `profile`: the plan name, `subscription_expires_at` as the next
renewal date when `razorpay_subscription_id` is set, and as the access-until
date when it is not. Add a cancel button, visible only when
`razorpay_subscription_id` is set, that calls `cancelSubscription` and then
`refreshProfile`.

The confirmation copy must state what actually happens, because the whole point
of cancelling at cycle end is that nothing is lost today:

> "Cancel renewal? Your plan stays active until {date}. You will not be charged
> again, and nothing is deleted."

- [ ] **Step 2: Type-check and test**

Run: `npx tsc -b && npm test -- --run`
Expected: no errors, no regressions

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProfilePage.tsx
git commit -m "feat: show renewal state and let a customer cancel from Profile"
```

---

## Task 9: Full verification

Per `CLAUDE.md`, run the checks rather than assuming them.

- [ ] **Step 1: Type-check, test, build**

```bash
npx tsc -b && npm test -- --run && npm run build
```

- [ ] **Step 2: Lint delta**

Run lint on every file touched and compare counts against the pre-change state.
The repo has a documented baseline of `@typescript-eslint/no-explicit-any` and
`setState`-in-effect errors — those are not regressions, but a new one must not
hide among them.

- [ ] **Step 3: Prove the new tests fail against the old behaviour**

For `apply_subscription_charge`'s idempotency test in particular: drop the
unique index on `razorpay_invoice_id`, re-run the SQL verification block, and
confirm a repeated invoice grants a second period. Restore the index.

- [ ] **Step 4: Webhook end-to-end in Razorpay test mode**

Confirm each of these against a throwaway account:
- authorisation charge grants the first period
- a redelivered `subscription.charged` for the same invoice grants nothing extra
- cancelling clears `razorpay_subscription_id` and leaves `subscription_expires_at` alone
- a failed renewal (`subscription.halted`) revokes nothing early

- [ ] **Step 5: Confirm the one-time path still works**

An existing profile with a future `subscription_expires_at` from a one-time
purchase must keep its access, and `order.paid` must still apply.

---

## Deployment order

1. Create the two plans in the Razorpay dashboard; record their ids.
2. Set `RAZORPAY_PLAN_MONTHLY` and `RAZORPAY_PLAN_ANNUAL` in Vercel.
3. Subscribe the webhook endpoint to `subscription.charged`,
   `subscription.cancelled` and `subscription.halted` in the Razorpay dashboard.
   **The existing `order.paid` subscription stays.**
4. Run `supabase/044_subscription_renewals.sql`; verify the grants.
5. **Publish the rewritten policies** — see
   `plans/policy-audit-and-industry-standard.md`. All three currently promise
   that nothing renews. Merging this code before that wording changes puts the
   product in direct contradiction with its own contract.
6. Merge the code.

## Open questions

1. **Do one-time plans stay on sale?** This plan assumes not — new purchases are
   subscriptions, and the one-time path exists only to honour periods already
   bought. Offering both means two billing paths and two sets of policy wording.
2. **`total_count`** — 120 monthly cycles and 10 annual are placeholders meaning
   "until cancelled". Confirm against Razorpay's current maximum.
3. **What happens to a customer mid-way through a one-time period who wants to
   switch to auto-renewal?** Simplest answer: they subscribe, and the first
   charge extends from their existing expiry, which
   `apply_subscription_charge()` already does correctly.
