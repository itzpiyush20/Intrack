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

REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) TO service_role;

COMMIT;

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

-- Verify afterwards:
--
--   -- expect two rows, both prosecdef = true with search_path pinned
--   SELECT p.proname, p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('apply_subscription_charge', 'clear_subscription_link');
--
--   -- expect service_role only, for BOTH functions
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name IN ('apply_subscription_charge', 'clear_subscription_link');
--
-- IMPERSONATE THE SERVICE ROLE FIRST. Without this every write below fails
-- with 'Cannot modify server-managed subscription/admin fields directly' — the
-- guard trigger (033/035) only waves through writes made as service_role, and
-- SECURITY DEFINER changes the executing ROLE, not that JWT claim.
-- EACH "Run" IN THE SUPABASE SQL EDITOR IS A SEPARATE SESSION on a pooled
-- connection, so a set_config from an earlier Run is GONE by the next one —
-- confirmed the hard way in 035. The impersonation line must be the FIRST
-- STATEMENT OF EVERY RUN, pasted together with the statements it applies to,
-- and the SELECT whose output you want to read goes LAST in that Run (the
-- editor only displays the final statement's result):
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   <the step's UPDATE / SELECT here, in the same Run>
--
-- Then, on a throwaway account (substitute its uuid):
--
--   -- 0. Reset it to lapsed, nothing linked yet.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles
--      SET subscription_status = 'expired', subscription_plan_type = 'monthly',
--          subscription_expires_at = now() - interval '10 days',
--          razorpay_subscription_id = NULL, razorpay_order_id = NULL,
--          pending_plan_type = NULL, pending_duration_days = NULL,
--          pending_order_id = NULL, pending_activates_at = NULL
--    WHERE id = '<uuid>';
--
--   -- 1. First charge on a lapsed account: ~30 days from NOW, not from the
--   -- old expiry.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>', 'sub_test_1', 'inv_1', 'monthly', 30, 199);
--   -- expect outcome 'charged', expires_at ~30 days out.
--
--   -- 2. The same invoice again, as a webhook retry delivers it.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>', 'sub_test_1', 'inv_1', 'monthly', 30, 199);
--   -- expect outcome 'already_applied', expires_at UNCHANGED from step 1.
--
--   -- 3. A different invoice extends further: ~60 days out, remaining days
--   -- from step 1 kept (not overwritten to 30).
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>', 'sub_test_1', 'inv_2', 'monthly', 30, 199);
--   -- expect outcome 'charged', expires_at ~60 days out.
--
--   -- 4. No such profile.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('00000000-0000-0000-0000-000000000000',
--                                           'sub_none', 'inv_none', 'monthly', 30, 199);
--   -- expect NULL, and no row written to subscription_charges for 'inv_none'.
--
--   -- 5. clear_subscription_link nulls the id and leaves expiry untouched.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.clear_subscription_link('<uuid>', 'sub_test_1');
--   -- expect true. Then:
--   SELECT razorpay_subscription_id, subscription_expires_at
--     FROM public.profiles WHERE id = '<uuid>';
--   -- expect razorpay_subscription_id NULL, subscription_expires_at STILL
--   -- ~60 days out (the same value step 3 produced).
--
--   -- 6. A mismatched subscription id changes nothing.
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles SET razorpay_subscription_id = 'sub_current' WHERE id = '<uuid>';
--   SELECT public.clear_subscription_link('<uuid>', 'sub_stale');
--   -- expect false.
--   SELECT razorpay_subscription_id FROM public.profiles WHERE id = '<uuid>';
--   -- expect 'sub_current', unchanged.
--
--   -- Reset the session before using it for ordinary queries:
--   SELECT set_config('request.jwt.claims', '', false);
