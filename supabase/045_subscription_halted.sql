-- 045_subscription_halted.sql
--
-- A failed renewal is not a cancellation.
--
-- When Razorpay exhausts its auto-charge retries a subscription moves to the
-- 'halted' state. 044's webhook treated that exactly like a cancellation and
-- unlinked the subscription, which was wrong in a way that costs money: a
-- halted subscription can be REVIVED by the customer authenticating a new card
-- (Razorpay emails them the link), and once revived it charges again. Throwing
-- away razorpay_subscription_id meant the app forgot a mandate that was still
-- alive, and Settings could not tell the customer why their renewal failed.
--
-- So halted now records a flag instead of unlinking, and the flag clears itself
-- the moment a charge succeeds.
--
-- Entitlement is untouched, as everywhere else in this migration series: the
-- period already paid for runs to its end date and then lapses on its own.
-- Nothing here revokes access early.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_halted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.subscription_halted_at IS
  'Set when Razorpay reports subscription.halted (renewal failed, retries exhausted). Cleared on the next successful charge or on cancellation. Display-only: it never gates access.';

COMMIT;

BEGIN;

-- The guard trigger is recreated in full rather than patched, because it is a
-- single function and a partial edit would silently drop the other columns it
-- protects. subscription_halted_at joins the server-managed set: a customer who
-- could clear it themselves could hide their own failed-payment warning.
CREATE OR REPLACE FUNCTION public.protect_server_only_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.jwt() ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status       IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.subscription_plan_type  IS DISTINCT FROM OLD.subscription_plan_type
     OR NEW.razorpay_subscription_id IS DISTINCT FROM OLD.razorpay_subscription_id
     OR NEW.razorpay_order_id        IS DISTINCT FROM OLD.razorpay_order_id
     OR NEW.subscription_halted_at   IS DISTINCT FROM OLD.subscription_halted_at
     OR NEW.is_admin                 IS DISTINCT FROM OLD.is_admin
  THEN
    RAISE EXCEPTION 'Cannot modify server-managed subscription/admin fields directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS protect_server_only_profile_columns ON public.profiles;
CREATE TRIGGER protect_server_only_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_server_only_profile_columns();

COMMIT;

BEGIN;

-- Record a failed renewal against the subscription that actually failed.
-- Matching on razorpay_subscription_id means a late webhook for a subscription
-- the customer has since replaced cannot flag the new one.
CREATE OR REPLACE FUNCTION public.mark_subscription_halted(
  p_user_id         UUID,
  p_subscription_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET subscription_halted_at = now(),
         updated_at = now()
   WHERE id = p_user_id
     AND razorpay_subscription_id = p_subscription_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_subscription_halted(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_subscription_halted(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_halted(UUID, TEXT) TO service_role;

COMMIT;

BEGIN;

-- Replaces 044's version. The only change is that a successful charge also
-- clears subscription_halted_at: a payment going through IS the recovery, and
-- leaving the warning up afterwards would tell a paying customer their billing
-- is broken.
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

  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.subscription_charges
              WHERE razorpay_invoice_id = p_invoice_id) THEN
    RETURN jsonb_build_object(
      'outcome',    'already_applied',
      'expires_at', v_row.subscription_expires_at
    );
  END IF;

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
    subscription_halted_at   = NULL,
    updated_at               = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('outcome', 'charged', 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_charge(UUID, TEXT, TEXT, TEXT, INT, NUMERIC) TO service_role;

-- Replaces 044's version. Cancelling now also clears the halted flag: the
-- mandate is gone, so a stale "renewal failed" warning would be noise the
-- customer can do nothing about.
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
         subscription_halted_at = NULL,
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

-- Verify afterwards, in the Supabase SQL editor.
--
-- Each Run is a separate pooled session, so an impersonation line must lead
-- EVERY Run it applies to. Put the SELECT whose output you want to read last.
--
--   -- expect the column to exist
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'profiles'
--      AND column_name = 'subscription_halted_at';
--
--   -- expect service_role ONLY, for both functions
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name IN ('mark_subscription_halted', 'apply_subscription_charge',
--                           'clear_subscription_link');
--
-- On a throwaway account (substitute its uuid):
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   UPDATE public.profiles SET razorpay_subscription_id = 'sub_h', subscription_halted_at = NULL
--    WHERE id = '<uuid>';
--   SELECT public.mark_subscription_halted('<uuid>', 'sub_h');
--   -- expect true, and subscription_halted_at now set.
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.mark_subscription_halted('<uuid>', 'sub_other');
--   -- expect false: a webhook for a different subscription must not flag this one.
--
--   SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   SELECT public.apply_subscription_charge('<uuid>','sub_h','inv_recover','monthly',30,199);
--   SELECT subscription_halted_at FROM public.profiles WHERE id = '<uuid>';
--   -- expect NULL: a successful charge clears the warning.
--
-- And the guard, as the CUSTOMER rather than the service role:
--
--   SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"<uuid>"}', false);
--   UPDATE public.profiles SET subscription_halted_at = NULL WHERE id = '<uuid>';
--   -- expect: ERROR, cannot modify server-managed subscription/admin fields directly
--
--   -- Reset the session before using it for ordinary queries:
--   SELECT set_config('request.jwt.claims', '', false);
