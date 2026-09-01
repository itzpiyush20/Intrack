# Subscription Plan-Change Queue — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute
> task-by-task, in order. Tasks 1–3 are database work and must be applied to Supabase
> before the API tasks deploy, or every payment fails.

**Goal:** Make buying a plan while another is running do the right thing — upgrades take
effect immediately and drop the remaining days, renewals and downgrades are paid for now
and activate automatically when the current plan expires, and a second purchase is
refused while anything is queued.

**Architecture:** All plan-change logic lives in one `SECURITY DEFINER` Postgres function
so that the browser callback and the Razorpay webhook — which fire for the same order and
can arrive together — cannot double-credit. A second function activates a queued plan
when its date arrives, called from the client on profile load so activation is instant.
The pre-payment block lives in `api/create-order.ts`; the post-payment function never
rejects money.

**Tech Stack:** Postgres/plpgsql (Supabase), Vercel serverless TypeScript, React.

---

## The rules being implemented

Source of truth: the owner's decisions of 2026-08-18. Restated here so this document
stands alone.

| Situation | Behaviour |
|---|---|
| No active plan (new, or lapsed) | Activate now, `now() + duration` |
| **Upgrade** — monthly → annual, while monthly is running | **Immediate.** Remaining days dropped. `now() + 365` |
| **Renewal** — same plan while it is running | **Queued.** Activates at current expiry |
| **Downgrade** — annual → monthly, while annual is running | **Queued.** Activates at current expiry |
| Anything already queued | **Checkout refused** |

Dropping the remaining days on upgrade is deliberate and was chosen over proration with
the numbers in hand. It is not a bug. Do not "fix" it.

**Coupons are out of scope.** The owner is redesigning coupon criteria separately. Task 6
reverts `api/redeem-promo.ts` to its committed behaviour so promo redemption keeps
working exactly as it does in production today.

## Two money edges needing an owner decision before Task 3 ships

**Both decided by the owner on 2026-09-01. Recorded here rather than left open —
the code had already shipped the behaviour described below without the
confirmation this section asked for.**

1. **Customer away past their activation date.** A queued plan activates on the calendar
   date the previous one expired, so someone who does not open the app for 10 days after
   expiry loses those 10 days. If they stay away longer than the queued plan's whole
   duration, they get **zero** days for money paid. This plan implements the strict
   calendar rule; flag it to the owner and confirm before Task 3 is applied.

   **DECIDED: keep the strict calendar rule.** Dates run on the calendar, not on
   attendance. `activate_pending_plan()` in `supabase/035` implements exactly this
   and is correct as written — the comment there ("a customer who stays away
   loses that time") is the intended behaviour, not an oversight to be fixed
   later. Do not change it to "starts on next login" without a new owner
   decision; that variant would hand a customer who stays away a month of free
   calendar time.
2. **Queue occupied when a grant arrives.** `create-order.ts` refuses this before payment,
   so it means a race. Money has been taken, so the function adds the duration to the
   queued plan rather than dropping it (`queue_extended`). Never lose a payment.

## Why `035` is rewritten rather than superseded

`supabase/035_extend_subscription.sql` has never been run in production and is not
committed. Its premise — always extend — is correct only for a lapsed account under these
rules. Rewriting it in place avoids shipping a migration that is wrong on arrival. The
function is renamed `extend_subscription` → `apply_plan_purchase` because it no longer
only extends.

## File structure

| File | Responsibility |
|---|---|
| `supabase/035_extend_subscription.sql` | **Rewritten.** Pending columns, guard-trigger carve-out, `apply_plan_purchase`, `activate_pending_plan` |
| `supabase/schema.sql` | Pending columns added to the table body **and** the safety-net `ALTER` block |
| `api/create-order.ts` | Refuse checkout when a plan is queued |
| `api/verify-payment.ts` | Call `apply_plan_purchase` |
| `api/webhook.ts` | Call `apply_plan_purchase` |
| `api/redeem-promo.ts` | **Reverted** to committed behaviour — coupons out of scope |
| `src/context/AuthContext.tsx` | Call `activate_pending_plan` before reading the profile |
| `src/pages/PricingPage.tsx` | Show the queued plan; disable buying |
| `api/create-order.test.ts` | **New.** Tests for the checkout block |

---

### Task 1: Pending columns and the guard-trigger carve-out

The guard trigger `protect_server_only_profile_columns` refuses any client write to
subscription columns. The new `pending_*` columns must join that protected set, or a user
could queue themselves a free annual plan from the browser console. Activation then needs
an explicit, tightly-scoped exemption — modelled on the self-expiry carve-out migration
027 added for the same reason.

**Files:**
- Modify: `supabase/035_extend_subscription.sql` (full rewrite, Tasks 1–3 land in this one file)
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Replace the whole of `supabase/035_extend_subscription.sql`**

```sql
-- 035_extend_subscription.sql
--
-- Plan-change semantics: upgrade now, renewal and downgrade queued.
--
-- Owner's rules, 2026-08-18:
--   * monthly -> annual while monthly runs: activate NOW, DROP the remaining
--     days. Chosen deliberately over proration. Not a bug.
--   * same plan bought again, or annual -> monthly: take the money, do NOT
--     activate. The running plan finishes untouched and the paid-for plan
--     activates by itself at that expiry.
--   * anything already queued: checkout is refused (api/create-order.ts).
--   * no active plan: activate now.
--
-- Coupons are NOT routed through here. The owner is redeciding their criteria;
-- api/redeem-promo.ts keeps its existing behaviour until then.

BEGIN;

-- ── 1. Where a queued plan lives ──────────────────────────────────────────
-- All four are NULL together or set together. pending_plan_type IS NOT NULL is
-- the single "something is queued" test used by every caller.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_plan_type TEXT
    CHECK (pending_plan_type IS NULL OR pending_plan_type IN ('monthly', 'annual'));
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_duration_days INT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_order_id TEXT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_activates_at TIMESTAMPTZ;

-- ── 2. Guard the new columns, and carve out activation ────────────────────
-- Body is 033's, plus the pending_* columns in both lists and one new allowed
-- transition. Keep the SET search_path clause — 033 exists to pin it.
CREATE OR REPLACE FUNCTION public.protect_server_only_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Server-side code (webhook.ts, verify-payment.ts, redeem-promo.ts) uses the
  -- service-role key and is trusted with everything.
  IF auth.jwt() ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Pending-plan activation, called by the account's owner via
  -- activate_pending_plan(). Deliberately narrow: the row must have carried a
  -- pending plan whose date has actually arrived, and NEW must be exactly what
  -- activating it produces. A client cannot fabricate the precondition because
  -- the pending_* columns are themselves guarded below — only server code can
  -- ever set them.
  IF OLD.pending_plan_type IS NOT NULL
     AND OLD.pending_activates_at IS NOT NULL
     AND OLD.pending_activates_at <= now()
     AND NEW.pending_plan_type       IS NULL
     AND NEW.pending_duration_days   IS NULL
     AND NEW.pending_activates_at    IS NULL
     AND NEW.subscription_status      = 'active'
     AND NEW.subscription_plan_type   = OLD.pending_plan_type
     AND NEW.subscription_expires_at  = OLD.pending_activates_at
                                        + make_interval(days => OLD.pending_duration_days)
     AND NEW.is_admin                 IS NOT DISTINCT FROM OLD.is_admin
     AND NEW.razorpay_subscription_id IS NOT DISTINCT FROM OLD.razorpay_subscription_id
  THEN
    RETURN NEW;
  END IF;

  -- Self-expiry: a strict downgrade, only after the date has passed, with no
  -- other guarded column moving.
  IF NEW.subscription_status = 'expired'
     AND OLD.subscription_status IN ('active', 'trial')
     AND OLD.subscription_expires_at IS NOT NULL
     AND OLD.subscription_expires_at <= now()
     AND NEW.subscription_expires_at  IS NOT DISTINCT FROM OLD.subscription_expires_at
     AND NEW.subscription_plan_type   IS NOT DISTINCT FROM OLD.subscription_plan_type
     AND NEW.razorpay_subscription_id IS NOT DISTINCT FROM OLD.razorpay_subscription_id
     AND NEW.razorpay_order_id        IS NOT DISTINCT FROM OLD.razorpay_order_id
     AND NEW.is_admin                 IS NOT DISTINCT FROM OLD.is_admin
     AND NEW.pending_plan_type        IS NOT DISTINCT FROM OLD.pending_plan_type
     AND NEW.pending_duration_days    IS NOT DISTINCT FROM OLD.pending_duration_days
     AND NEW.pending_order_id         IS NOT DISTINCT FROM OLD.pending_order_id
     AND NEW.pending_activates_at     IS NOT DISTINCT FROM OLD.pending_activates_at
  THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status        IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_expires_at  IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.subscription_plan_type   IS DISTINCT FROM OLD.subscription_plan_type
     OR NEW.razorpay_subscription_id IS DISTINCT FROM OLD.razorpay_subscription_id
     OR NEW.razorpay_order_id        IS DISTINCT FROM OLD.razorpay_order_id
     OR NEW.is_admin                 IS DISTINCT FROM OLD.is_admin
     OR NEW.pending_plan_type        IS DISTINCT FROM OLD.pending_plan_type
     OR NEW.pending_duration_days    IS DISTINCT FROM OLD.pending_duration_days
     OR NEW.pending_order_id         IS DISTINCT FROM OLD.pending_order_id
     OR NEW.pending_activates_at     IS DISTINCT FROM OLD.pending_activates_at
  THEN
    RAISE EXCEPTION 'Cannot modify server-managed subscription/admin fields directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

COMMIT;
```

- [ ] **Step 2: Add the same columns to `supabase/schema.sql`**

In the `CREATE TABLE public.profiles` body, immediately after `razorpay_order_id TEXT,`:

```sql
  -- A plan bought while another was still running. All four are NULL together
  -- or set together; pending_plan_type IS NOT NULL means "something is queued".
  -- See migration 035.
  pending_plan_type TEXT CHECK (pending_plan_type IS NULL OR pending_plan_type IN ('monthly', 'annual')),
  pending_duration_days INT,
  pending_order_id TEXT,
  pending_activates_at TIMESTAMPTZ,
```

And in the safety-net block, beside the existing `razorpay_order_id` line:

```sql
-- protect_server_only_profile_columns reads all four, so a database that
-- predates them fails every UPDATE on profiles with error 42703 until they exist.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_plan_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_duration_days INT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_order_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_activates_at TIMESTAMPTZ;
```

This matters more than it looks. `schema.sql` is only run when a database is created, so
without both edits a fresh install and production diverge — which has broken every
`UPDATE` on `profiles` twice before via this exact trigger.

- [ ] **Step 3: Commit**

```bash
git add supabase/035_extend_subscription.sql supabase/schema.sql
git commit -m "feat: add pending-plan columns and guard them"
```

---

### Task 2: `apply_plan_purchase`

**Files:**
- Modify: `supabase/035_extend_subscription.sql` (append before its final verification block)

- [ ] **Step 1: Append the function, inside its own transaction**

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.extend_subscription(UUID, TEXT, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.apply_plan_purchase(
  p_user_id       UUID,
  p_plan_type     TEXT,
  p_duration_days INT,
  p_order_id      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.profiles%ROWTYPE;
  v_active  BOOLEAN;
  v_upgrade BOOLEAN;
  v_outcome TEXT;
BEGIN
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 3650 THEN
    RAISE EXCEPTION 'apply_plan_purchase: implausible duration_days %', p_duration_days;
  END IF;
  IF p_plan_type IS NULL OR p_plan_type NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'apply_plan_purchase: unknown plan_type %', p_plan_type;
  END IF;

  -- FOR UPDATE is what makes this safe against the verify-payment/webhook race
  -- for one order, and against Razorpay's webhook retries. The second caller
  -- blocks here, then re-reads the row the first one wrote and takes the
  -- already-applied branch below. A read followed by a separate write would
  -- let both callers see "not yet applied" and both credit.
  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;   -- caller treats NULL as a hard failure
  END IF;

  IF p_order_id IS NOT NULL
     AND (v_row.razorpay_order_id = p_order_id OR v_row.pending_order_id = p_order_id)
  THEN
    RETURN jsonb_build_object(
      'outcome',              'already_applied',
      'expires_at',           v_row.subscription_expires_at,
      'pending_plan_type',    v_row.pending_plan_type,
      'pending_activates_at', v_row.pending_activates_at
    );
  END IF;

  -- A trial is not a paid plan: 'trial' must not park a purchase behind it, so
  -- it is deliberately excluded here rather than relying on
  -- subscription_status alone.
  v_active := v_row.subscription_status = 'active'
              AND v_row.subscription_plan_type IN ('monthly', 'annual')
              AND v_row.subscription_expires_at IS NOT NULL
              AND v_row.subscription_expires_at > now();

  v_upgrade := v_active
               AND v_row.subscription_plan_type = 'monthly'
               AND p_plan_type = 'annual';

  IF NOT v_active OR v_upgrade THEN
    -- Not active: nothing to preserve. Upgrade: the owner's rule is that the
    -- remaining days are dropped. Both land on now() + duration.
    UPDATE public.profiles SET
      subscription_status     = 'active',
      subscription_plan_type  = p_plan_type,
      -- Any queued plan is FOLDED IN, not discarded — it was paid for, and the
      -- same "never drop money already taken" rule that justifies the
      -- queue_extended branch below applies here. Note this does not conflict
      -- with the upgrade rule: what an upgrade drops is the unconsumed time on
      -- the plan being replaced, not a separate purchase that never started.
      --
      -- Clearing the four pending_* columns is not optional. Leaving them set
      -- would strand a pending_activates_at in the past, and
      -- activate_pending_plan() would then overwrite this very purchase with an
      -- expiry anchored to that old date.
      subscription_expires_at = now()
                                + make_interval(days => p_duration_days
                                    + COALESCE(v_row.pending_duration_days, 0)),
      razorpay_order_id       = COALESCE(p_order_id, razorpay_order_id),
      pending_plan_type       = NULL,
      pending_duration_days   = NULL,
      pending_order_id        = NULL,
      pending_activates_at    = NULL,
      updated_at              = now()
    WHERE id = p_user_id;
    v_outcome := 'activated';

  ELSIF v_row.pending_plan_type IS NOT NULL THEN
    -- create-order.ts refuses a purchase while anything is queued, so getting
    -- here means a race beat that check. The money is already taken and must
    -- not be dropped: add the duration to what is queued.
    UPDATE public.profiles SET
      pending_duration_days = COALESCE(v_row.pending_duration_days, 0) + p_duration_days,
      -- Keep the FIRST order's id: COALESCE(p_order_id, ...) would overwrite it,
      -- and a Razorpay retry for that order would then miss the idempotency
      -- check and credit twice. The incoming order is recorded in
      -- razorpay_order_id instead, so both ids stay matchable.
      pending_order_id      = COALESCE(pending_order_id, p_order_id),
      razorpay_order_id     = COALESCE(p_order_id, razorpay_order_id),
      updated_at            = now()
    WHERE id = p_user_id;
    v_outcome := 'queue_extended';

  ELSE
    -- Same-plan renewal, or annual -> monthly downgrade. Take the money, leave
    -- the running plan alone, activate at its expiry.
    UPDATE public.profiles SET
      pending_plan_type     = p_plan_type,
      pending_duration_days = p_duration_days,
      pending_order_id      = p_order_id,
      pending_activates_at  = v_row.subscription_expires_at,
      razorpay_order_id     = COALESCE(p_order_id, razorpay_order_id),
      updated_at            = now()
    WHERE id = p_user_id;
    v_outcome := 'queued';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id;
  RETURN jsonb_build_object(
    'outcome',              v_outcome,
    'expires_at',           v_row.subscription_expires_at,
    'pending_plan_type',    v_row.pending_plan_type,
    'pending_activates_at', v_row.pending_activates_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plan_purchase(UUID, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_plan_purchase(UUID, TEXT, INT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_purchase(UUID, TEXT, INT, TEXT) TO service_role;

COMMIT;
```

`service_role` only, exactly as 035 originally reasoned: this function grants paid time on
the strength of its arguments alone, so a client able to call it directly could hand
itself a decade of premium.

- [ ] **Step 2: Commit**

```bash
git add supabase/035_extend_subscription.sql
git commit -m "feat: apply_plan_purchase replaces extend_subscription"
```

---

### Task 3: `activate_pending_plan`

**Files:**
- Modify: `supabase/035_extend_subscription.sql`

- [ ] **Step 1: Append the function**

```sql
BEGIN;

-- Called by the account's own browser on profile load, so a queued plan starts
-- the moment its owner next opens the app rather than waiting for a nightly
-- job. Safe to grant to `authenticated`: it takes no arguments, works only on
-- auth.uid()'s own row, activates only a plan that was already paid for, and
-- only once its stored date has passed. The matching carve-out in
-- protect_server_only_profile_columns is what lets the write through, and it
-- permits exactly this transition and nothing else.
CREATE OR REPLACE FUNCTION public.activate_pending_plan()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_row.pending_plan_type IS NULL THEN RETURN false; END IF;
  IF v_row.pending_activates_at IS NULL OR v_row.pending_activates_at > now() THEN
    RETURN false;
  END IF;

  -- Dates run on the calendar, not on attendance: the queued plan starts when
  -- the previous one ended, so a customer who stays away loses that time. See
  -- the open question at the top of the plan document.
  UPDATE public.profiles SET
    subscription_status     = 'active',
    subscription_plan_type  = v_row.pending_plan_type,
    subscription_expires_at = v_row.pending_activates_at
                              + make_interval(days => v_row.pending_duration_days),
    razorpay_order_id       = COALESCE(v_row.pending_order_id, razorpay_order_id),
    pending_plan_type       = NULL,
    pending_duration_days   = NULL,
    pending_order_id        = NULL,
    pending_activates_at    = NULL,
    updated_at              = now()
  WHERE id = v_row.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_pending_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_pending_plan() TO authenticated, service_role;

COMMIT;
```

- [ ] **Step 2: Replace the file's verification block**

```sql
-- Verify afterwards:
--
--   -- expect two rows, both prosecdef = true with search_path pinned
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('apply_plan_purchase', 'activate_pending_plan');
--
--   -- expect service_role only for apply_plan_purchase
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name IN ('apply_plan_purchase', 'activate_pending_plan');
--
-- IMPERSONATE THE SERVICE ROLE FIRST. Without this every statement below fails
-- with 'Cannot modify server-managed subscription/admin fields directly'. The
-- guard trigger waves through writes to the subscription columns only when
-- auth.jwt() ->> 'role' is 'service_role', and auth.jwt() reads
-- request.jwt.claims — a per-request setting PostgREST supplies and the SQL
-- editor does not. SECURITY DEFINER changes the executing ROLE, not that claim.
-- Session-scoped (false), not transaction-scoped, because the steps below are
-- separate statements:
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--
-- Then, on a throwaway account (substitute its uuid):
--
--   -- 1. UPGRADE drops the remaining days. Give it a monthly with 13 days left.
--   UPDATE public.profiles
--      SET subscription_status = 'active', subscription_plan_type = 'monthly',
--          subscription_expires_at = now() + interval '13 days',
--          razorpay_order_id = NULL, pending_plan_type = NULL,
--          pending_duration_days = NULL, pending_order_id = NULL,
--          pending_activates_at = NULL
--    WHERE id = '<uuid>';
--   SELECT public.apply_plan_purchase('<uuid>', 'annual', 365, 'order_up_1');
--   -- expect outcome 'activated', expires_at ~365 days out, NOT 378.
--
--   -- 2. The same order again, as a webhook retry delivers it.
--   SELECT public.apply_plan_purchase('<uuid>', 'annual', 365, 'order_up_1');
--   -- expect outcome 'already_applied' and the SAME expires_at as step 1.
--
--   -- 3. RENEWAL queues. Same plan bought again while it runs.
--   SELECT public.apply_plan_purchase('<uuid>', 'annual', 365, 'order_ren_1');
--   -- expect outcome 'queued', expires_at UNCHANGED from step 1,
--   -- pending_plan_type 'annual', pending_activates_at = that expires_at.
--
--   -- 4. Queue occupied. Never drops the money.
--   SELECT public.apply_plan_purchase('<uuid>', 'monthly', 30, 'order_ren_2');
--   -- expect outcome 'queue_extended', pending_duration_days now 395.
--
--   -- 5. DOWNGRADE queues. Reset to a clean annual first.
--   UPDATE public.profiles
--      SET subscription_status = 'active', subscription_plan_type = 'annual',
--          subscription_expires_at = now() + interval '200 days',
--          razorpay_order_id = NULL, pending_plan_type = NULL,
--          pending_duration_days = NULL, pending_order_id = NULL,
--          pending_activates_at = NULL
--    WHERE id = '<uuid>';
--   SELECT public.apply_plan_purchase('<uuid>', 'monthly', 30, 'order_down_1');
--   -- expect outcome 'queued', expires_at still ~200 days out.
--
--   -- 6. Activation is refused while the date is in the future.
--   SELECT set_config('request.jwt.claims',
--                     json_build_object('sub','<uuid>','role','authenticated')::text, false);
--   SELECT public.activate_pending_plan();   -- expect false, nothing changed
--
--   -- 7. Activation fires once the date has passed.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles
--      SET subscription_expires_at = now() - interval '1 day',
--          pending_activates_at    = now() - interval '1 day'
--    WHERE id = '<uuid>';
--   SELECT set_config('request.jwt.claims',
--                     json_build_object('sub','<uuid>','role','authenticated')::text, false);
--   SELECT public.activate_pending_plan();   -- expect true
--   -- expect plan_type 'monthly', expires ~29 days out, all pending_* NULL.
--
--   -- 8. A lapsed account activates from today, not from its old expiry.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles
--      SET subscription_status = 'expired',
--          subscription_expires_at = now() - interval '400 days',
--          razorpay_order_id = NULL, pending_plan_type = NULL,
--          pending_duration_days = NULL, pending_order_id = NULL,
--          pending_activates_at = NULL
--    WHERE id = '<uuid>';
--   SELECT public.apply_plan_purchase('<uuid>', 'monthly', 30, 'order_lapsed_1');
--   -- expect outcome 'activated', ~30 days from NOW.
--
--   -- 9. No such profile.
--   SELECT public.apply_plan_purchase('00000000-0000-0000-0000-000000000000',
--                                     'monthly', 30, 'order_none');
--   -- expect NULL, nothing written anywhere.
--
--   -- Reset the session before using it for ordinary queries:
--   SELECT set_config('request.jwt.claims', '', false);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/035_extend_subscription.sql
git commit -m "feat: activate_pending_plan and verification steps"
```

- [ ] **Step 4: STOP. Apply to Supabase and run every verification step above.**

Nothing past this point may deploy until step 4 passes. The API tasks call
`apply_plan_purchase`; ship them against a database without it and every payment fails.

---

### Task 4: Refuse checkout while a plan is queued

The block belongs here, before payment. Doing it after would mean taking money and then
refusing to grant anything.

**Files:**
- Create: `api/_lib/pendingPlan.ts`
- Create: `api/_lib/pendingPlan.test.ts`
- Modify: `api/create-order.ts:77-84`

The helper goes in `api/_lib/`, not in the handler. `create-order.ts` builds a `Razorpay`
client and a Supabase client at module scope, so importing it from a test executes both
against empty credentials. `verify-payment.test.ts` works around that with `vi.mock` calls
for `razorpay` and `@supabase/supabase-js` before its import — necessary there because it
tests the handler itself. This is a pure predicate, and `_lib` is where the codebase
already keeps those (`promo.ts`, `razorpaySignature.ts`), each with a colocated test and
no mocking ceremony.

- [ ] **Step 1: Write the failing test at `api/_lib/pendingPlan.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { isPurchaseBlocked } from './pendingPlan.js'

describe('isPurchaseBlocked', () => {
  it('blocks when a plan is already queued', () => {
    expect(isPurchaseBlocked({ pending_plan_type: 'monthly' })).toBe(true)
    expect(isPurchaseBlocked({ pending_plan_type: 'annual' })).toBe(true)
  })

  it('allows when nothing is queued', () => {
    expect(isPurchaseBlocked({ pending_plan_type: null })).toBe(false)
    expect(isPurchaseBlocked({})).toBe(false)
  })

  it('allows when the profile row is missing', () => {
    // A missing profile is not a queued plan. Checkout proceeds, and
    // apply_plan_purchase returns NULL later — that is where it gets reported,
    // rather than blocking a purchase for a reason that may not be true.
    expect(isPurchaseBlocked(null)).toBe(false)
    expect(isPurchaseBlocked(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run api/_lib/pendingPlan.test.ts`
Expected: FAIL — cannot resolve `./pendingPlan.js`.

- [ ] **Step 3: Create `api/_lib/pendingPlan.ts`**

```typescript
/**
 * True when the account already has a plan waiting behind its current one.
 *
 * One pending change at a time: buying again while a plan is queued would take
 * money for time the customer cannot reach for up to a year. Checked before
 * payment in create-order.ts, never after.
 */
export function isPurchaseBlocked(
  profile: { pending_plan_type?: string | null } | null | undefined
): boolean {
  return !!profile?.pending_plan_type
}
```

- [ ] **Step 4: Wire it into `api/create-order.ts`**

Add the import beside the existing ones:

```typescript
import { isPurchaseBlocked } from './_lib/pendingPlan.js'
```

Then between the `amount` block and the `try` (after line 84):

```typescript
  // One pending change at a time. Buying again while a plan is queued would
  // take money for time the customer cannot reach for up to a year, so it is
  // refused here — before payment, never after.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('pending_plan_type, pending_activates_at')
    .eq('id', userId)
    .maybeSingle()

  if (isPurchaseBlocked(profileRow)) {
    return res.status(409).json({
      error: 'You already have a plan queued to start when your current one ends. You can buy again once it begins.',
      code: 'PLAN_ALREADY_QUEUED',
      pendingActivatesAt: profileRow?.pending_activates_at ?? null,
    })
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run api/_lib/pendingPlan.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/pendingPlan.ts api/_lib/pendingPlan.test.ts api/create-order.ts
git commit -m "feat: refuse checkout while a plan is queued"
```

---

### Task 5: Point the payment paths at `apply_plan_purchase`

**Files:**
- Modify: `api/verify-payment.ts:172`
- Modify: `api/webhook.ts:88`

- [ ] **Step 1: `api/verify-payment.ts` — replace the RPC call**

```typescript
    const { data: result, error } = await supabaseAdmin.rpc('apply_plan_purchase', {
      p_user_id: userId,
      p_plan_type: planType,
      p_duration_days: durationDays,
      p_order_id: razorpay_order_id,
    })

    if (error) throw error
    // NULL means no profile row matched. Without this check a missing profile
    // would silently report payment success while granting nothing.
    if (!result) {
      console.error('Plan purchase matched no profile row for userId:', userId, 'order:', razorpay_order_id)
      throw new Error('No matching profile found to update.')
    }

    // 'queued' means the customer paid for a plan that starts later — a
    // renewal or a downgrade. The response must say so, or the UI will report
    // an active plan that has not actually changed.
    const outcome = result.outcome as string
    const subscription_expires_at = new Date(result.expires_at as string).toISOString()
    const pendingActivatesAt = result.pending_activates_at
      ? new Date(result.pending_activates_at as string).toISOString()
      : null
```

Then replace the success response — it currently reads exactly:

```typescript
    return res.status(200).json({
      success: true,
      message: 'Subscription activated successfully.',
      expiresAt: subscription_expires_at,
    })
```

with:

```typescript
    return res.status(200).json({
      success: true,
      // "Subscription activated successfully" is a lie for a queued purchase —
      // the customer paid for a plan that starts later, and the page must not
      // tell them their plan just changed.
      message:
        outcome === 'activated'
          ? 'Subscription activated successfully.'
          : 'Payment received. Your new plan starts when your current one ends.',
      expiresAt: subscription_expires_at,
      outcome,
      pendingActivatesAt,
    })
```

- [ ] **Step 2: `api/webhook.ts` — replace the RPC call**

```typescript
      const { data: result, error } = await supabaseAdmin.rpc('apply_plan_purchase', {
        p_user_id: userId,
        p_plan_type: planType,
        p_duration_days: durationDays,
        p_order_id: orderId,
      })

      if (error) throw error
      if (!result) {
        console.error('Webhook plan purchase matched no profile row for userId:', userId, 'order:', orderId)
        throw new Error('No matching profile found to update.')
      }
      console.log(`Webhook applied order ${orderId} for user ${userId}: ${result.outcome}`)
```

Leave the `payments` insert below exactly as it is — its `23505` handling is what makes
the duplicate row from the verify-payment race harmless.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc -b --force && npm test`
Expected: TSC clean. Tests: the pre-existing `emailScanner.test.ts` failure remains; nothing new fails.

- [ ] **Step 4: Commit**

```bash
git add api/verify-payment.ts api/webhook.ts
git commit -m "feat: route payments through apply_plan_purchase"
```

---

### Task 6: Take coupons back out of scope

`api/redeem-promo.ts` currently calls the deleted `extend_subscription`. The owner is
redeciding coupon criteria separately, so it reverts to its committed behaviour rather
than being pointed at `apply_plan_purchase` — routing it there would silently start
queueing coupons, which is a decision nobody has made.

**Files:**
- Modify: `api/redeem-promo.ts`

- [ ] **Step 1: Revert the file**

```bash
git checkout HEAD -- api/redeem-promo.ts
```

- [ ] **Step 2: Confirm nothing references the dropped function**

Run: `grep -rn "extend_subscription" api/ src/`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add api/redeem-promo.ts
git commit -m "chore: leave promo redemption on its existing path"
```

---

### Task 7: Activate a due plan when the customer opens the app

Ordering is load-bearing. `refreshProfile` reads the profile and then, at
`AuthContext.tsx:331`, flips an expired-looking row to `expired`. A customer whose annual
has ended with a monthly queued behind it would be marked expired and bounced to
`/pricing` before anything activated. The RPC must run **before** the `SELECT`.

**Files:**
- Modify: `src/context/AuthContext.tsx:307-313`

- [ ] **Step 1: Call the RPC before the profile read**

Immediately before the `const { data, error } = await supabase.from('profiles')` call:

```typescript
      // A queued plan (a renewal or a downgrade the customer already paid for)
      // starts on the date the previous one ended. This turns it on when they
      // next open the app. It MUST run before the SELECT below: the expiry
      // check further down would otherwise see the finished plan, mark the
      // account expired, and route a paying customer to /pricing.
      //
      // A no-op returning false on virtually every load — one cheap round trip
      // to avoid a nightly job and the lag that comes with it. A failure here
      // is not fatal: the profile read still happens and the plan activates on
      // the next load.
      try {
        await supabase.rpc('activate_pending_plan')
      } catch (e) {
        console.warn('Pending plan activation failed; will retry next load:', e)
      }
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -b --force && npm run build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/context/AuthContext.tsx
git commit -m "feat: activate a due queued plan on profile load"
```

---

### Task 8: Show the customer what they bought

Without this a downgrading customer pays and sees no change — the single most likely
support ticket this feature can generate.

**Files:**
- Modify: `src/pages/PricingPage.tsx`

- [ ] **Step 1: Read the queued plan from the profile**

`profile` already comes from `useAuth()`. Above the plan cards:

```tsx
{profile?.pending_plan_type && (
  <div role="status" className="rounded-2xl border border-border-subtle bg-surface-1 p-4 text-sm">
    <p className="font-semibold text-zinc-200">
      {profile.pending_plan_type === 'annual' ? 'Annual' : 'Monthly'} plan queued
    </p>
    <p className="text-xs text-zinc-500 mt-0.5">
      Already paid for. It starts automatically on{' '}
      {profile.pending_activates_at
        ? formatDate(profile.pending_activates_at)
        : 'your current plan\'s expiry'}
      , when your current plan ends. You can buy again once it begins.
    </p>
  </div>
)}
```

`formatDate` comes from `@/utils` — add it to the existing import if absent.

- [ ] **Step 2: Disable the buy buttons while a plan is queued**

Add `disabled={!!profile?.pending_plan_type}` to each plan's purchase button. The server
already refuses with `409 PLAN_ALREADY_QUEUED`; this stops the customer reaching a
payment sheet that cannot succeed.

- [ ] **Step 3: Stop the success handler marking a queued plan active**

This is the step that decides whether the feature works at all. In the Razorpay `handler`
callback, this line runs unconditionally today:

```typescript
            // Instantly update local subscription status and local storage to prevent override to trial
            await updateSubscriptionStatus('active', selectedPlan)

            showToast(`👑 Payment Successful! ${planName} features unlocked.`, 'success')
            navigate('/payment-success', { state: { planName, expiresAt: verifyData.expiresAt } })
```

On a queued purchase that immediately marks the account active on the new plan — writing
the change the queue exists to defer, and in local-dev mode writing it to the database
too. Replace with:

```typescript
            // Only an immediate activation may touch local subscription state.
            // A 'queued' outcome means the customer paid for a plan that starts
            // when the current one ends; marking it active now would apply the
            // change the queue exists to defer.
            if (verifyData.outcome === 'queued' || verifyData.outcome === 'queue_extended') {
              await refreshProfile()
              showToast('Payment received. Your new plan starts when your current one ends.', 'success')
              navigate('/payment-success', {
                state: {
                  planName,
                  queued: true,
                  startsAt: verifyData.pendingActivatesAt,
                },
              })
            } else {
              await updateSubscriptionStatus('active', selectedPlan)
              showToast(`👑 Payment Successful! ${planName} features unlocked.`, 'success')
              navigate('/payment-success', { state: { planName, expiresAt: verifyData.expiresAt } })
            }
```

`refreshProfile` is already destructured from `useAuth()` at line 48, so no import change
is needed. It re-reads the profile so the queued notice from Step 1 appears immediately.

- [ ] **Step 4: Handle the 409 explicitly**

The existing line

```typescript
      if (!response.ok || orderData.error) throw new Error(orderData.error || 'Could not initiate payment order')
```

does surface the message, but through the outer catch as `Checkout error: You already
have a plan queued…`, which reads like a fault. Insert directly above it:

```typescript
      // The server refuses a purchase while a plan is queued. This is an
      // expected answer, not a checkout fault, so it must not be prefixed as one.
      if (response.status === 409) {
        showToast(orderData.error || 'You already have a plan queued.', 'warning')
        setProcessing(false)
        return
      }
```

- [ ] **Step 5: Make `/payment-success` handle the queued case**

Check `src/pages/PaymentSuccessPage.tsx` (or whichever component the `/payment-success`
route renders) for its use of `state.expiresAt`. When `state.queued` is true it must say
the plan is scheduled, not active, and show `state.startsAt`. If the page only ever reads
`expiresAt`, a queued purchase would land on a page announcing access the customer does
not yet have.

- [ ] **Step 6: Build and verify in the browser**

Run: `npm run build`
Then start the preview, sign in, and confirm the queued notice renders and the buy buttons
are disabled for an account with `pending_plan_type` set.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PricingPage.tsx src/pages/PaymentSuccessPage.tsx
git commit -m "feat: show a queued plan and stop it activating early"
```

---

## Deployment order

1. Tasks 1–3 committed, then **applied to Supabase and verified** with every step in the
   file's verification block.
2. Only then push Tasks 4–8. Deploying the API code first means every payment fails.
3. Migration `036` (account-deletion anonymisation) is independent of all of this and can
   go before or after.

## Still open

- The two money edges listed at the top — confirm with the owner before Task 3 is applied.
- Coupon criteria. The owner is redeciding; `redeem-promo.ts` is untouched until they do.
