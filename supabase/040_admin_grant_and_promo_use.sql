-- 040_admin_grant_and_promo_use.sql
--
-- Two money bugs, both the same shape: a value that has to be computed from
-- the row's CURRENT contents was being computed in TypeScript from a value
-- read moments earlier. Both move into the database, where the read and the
-- write are one statement.
--
--   1. admin_grant_subscription()  — an admin grant EXTENDS paid time instead
--      of replacing it. api/admin.ts wrote `now() + days` absolutely, so
--      granting a goodwill 30 days to someone holding 300 paid days left them
--      with 30. The admin panel spec scoped this phase as "grant/extend plans"
--      (docs/superpowers/specs/2026-08-15-admin-panel-design.md); the code
--      only ever did the first half.
--
--   2. claim_promo_use()           — max_uses is enforced atomically. The
--      endpoint read used_count, compared it to max_uses in JS, and later
--      wrote `used_count + 1` from the value it had read. Two people redeeming
--      a max_uses:1 code at the same moment both read 0, both passed, and both
--      were granted. UNIQUE (code, user_id) never covered this: it stops ONE
--      account redeeming twice, not TWO accounts racing.
--
-- Both are service_role only. Neither can be reached from a browser: they
-- write subscription columns and coupon inventory, which is exactly what
-- protect_server_only_profile_columns exists to keep out of user sessions.

BEGIN;

-- ==========================================
-- 1. Admin subscription grant
-- ==========================================
--
-- Returns the new expiry as JSONB, or NULL when no profile matched — the same
-- "NULL means nothing was updated" contract apply_plan_purchase uses, so
-- api/admin.ts can tell a missing account from a successful grant.
--
-- The expiry extends from GREATEST(now(), current expiry):
--
--   * active with 300 days left, granted 30  -> 330 days. The paid time the
--     customer already holds is never destroyed by a goodwill grant.
--   * lapsed 60 days ago, granted 30         -> 30 days from today, not 30
--     days from an expiry that is already in the past.
--
-- FOR UPDATE for the same reason apply_plan_purchase takes it: two grants
-- issued together must stack, not overwrite each other. Rare with one
-- operator, free to be correct about.
CREATE OR REPLACE FUNCTION public.admin_grant_subscription(
  p_user_id       UUID,
  p_plan_type     TEXT,
  p_duration_days INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        public.profiles%ROWTYPE;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Mirrors the endpoint's own validation rather than trusting it. MAX_GRANT_DAYS
  -- is 365 there; 3650 here is a sanity bound, not a policy — the policy stays
  -- in api/admin.ts where the operator-facing message lives.
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 3650 THEN
    RAISE EXCEPTION 'admin_grant_subscription: implausible duration_days %', p_duration_days;
  END IF;
  IF p_plan_type IS NULL OR p_plan_type NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'admin_grant_subscription: unknown plan_type %', p_plan_type;
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- COALESCE covers a profile that has never held a plan, where
  -- subscription_expires_at is NULL and GREATEST would return NULL.
  v_expires_at := GREATEST(now(), COALESCE(v_row.subscription_expires_at, now()))
                  + make_interval(days => p_duration_days);

  UPDATE public.profiles SET
    subscription_status     = 'active',
    subscription_expires_at = v_expires_at,
    subscription_plan_type  = p_plan_type,
    updated_at              = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'email',      v_row.email,
    'expires_at', v_expires_at,
    -- What the grant actually did, so the operator's confirmation can say
    -- "extended to" rather than implying the account was empty.
    'extended',   v_row.subscription_expires_at IS NOT NULL
                  AND v_row.subscription_expires_at > now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_subscription(UUID, TEXT, INT) FROM PUBLIC;
-- anon and authenticated are revoked BY NAME, not just via PUBLIC. Supabase
-- projects carry ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, which grants those roles DIRECTLY, and REVOKE ... FROM PUBLIC
-- does not strip a direct role grant. 035 verified this against a live
-- database and 037 exists because of it.
REVOKE ALL ON FUNCTION public.admin_grant_subscription(UUID, TEXT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_grant_subscription(UUID, TEXT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_subscription(UUID, TEXT, INT) TO service_role;

-- ==========================================
-- 2. Atomic promo use claim
-- ==========================================
--
-- Returns true when this redemption is within the code's usage limit and the
-- count has been taken, false when the code is exhausted. The caller releases
-- its promo_redemptions claim and refuses on false.
--
-- The whole check lives in the UPDATE's WHERE clause: a row is only counted
-- when it still has room at the instant the write happens. Two concurrent
-- callers on a max_uses:1 code serialise on the row, and the second sees
-- used_count = 1 and matches nothing.
--
-- max_uses IS NULL means unlimited, and still increments — used_count is the
-- number the admin panel shows for every code, limited or not.
CREATE OR REPLACE FUNCTION public.claim_promo_use(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  UPDATE public.promo_codes
     SET used_count = used_count + 1
   WHERE code = p_code
     AND (max_uses IS NULL OR used_count < max_uses)
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_promo_use(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_promo_use(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_promo_use(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_promo_use(TEXT) TO service_role;

-- ==========================================
-- 3. Giving a claimed use back
-- ==========================================
--
-- The one caller is redeem-promo.ts's rollback path, where the count was taken
-- but the profile grant then matched no row. Without this a limited code
-- quietly loses one of its uses to a redemption that never happened, and on a
-- max_uses:1 code that retires it permanently.
--
-- GREATEST(used_count - 1, 0) so a double rollback — a retried request, a
-- caller that failed after already releasing — cannot drive the count
-- negative, which no CHECK constraint currently forbids.
CREATE OR REPLACE FUNCTION public.release_promo_use(p_code TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.promo_codes
     SET used_count = GREATEST(used_count - 1, 0)
   WHERE code = p_code;
$$;

REVOKE ALL ON FUNCTION public.release_promo_use(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_promo_use(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.release_promo_use(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_promo_use(TEXT) TO service_role;

COMMIT;

-- ==========================================
-- Verifying by hand
-- ==========================================
--
--   -- Grant EXTENDS rather than replaces.
--   UPDATE public.profiles
--      SET subscription_status = 'active', subscription_plan_type = 'annual',
--          subscription_expires_at = now() + interval '300 days'
--    WHERE id = '<uuid>';
--   SELECT public.admin_grant_subscription('<uuid>', 'monthly', 30);
--   -- expect expires_at ~330 days out, NOT 30. extended = true.
--
--   -- Grant to a LAPSED account counts from today, not from the old expiry.
--   UPDATE public.profiles
--      SET subscription_status = 'expired',
--          subscription_expires_at = now() - interval '60 days'
--    WHERE id = '<uuid>';
--   SELECT public.admin_grant_subscription('<uuid>', 'monthly', 30);
--   -- expect expires_at ~30 days out. extended = false.
--
--   -- No such account.
--   SELECT public.admin_grant_subscription('00000000-0000-0000-0000-000000000000', 'monthly', 30);
--   -- expect NULL.
--
--   -- Usage limit holds.
--   INSERT INTO public.promo_codes (code, duration_days, max_uses)
--        VALUES ('LIMITTEST', 30, 1);
--   SELECT public.claim_promo_use('LIMITTEST');  -- expect true,  used_count 1
--   SELECT public.claim_promo_use('LIMITTEST');  -- expect false, used_count STILL 1
--   SELECT public.claim_promo_use('NOSUCHCODE'); -- expect false
--
--   -- Unlimited codes still count.
--   INSERT INTO public.promo_codes (code, duration_days, max_uses)
--        VALUES ('UNLIMITEDTEST', 30, NULL);
--   SELECT public.claim_promo_use('UNLIMITEDTEST');  -- expect true, used_count 1
--   SELECT public.claim_promo_use('UNLIMITEDTEST');  -- expect true, used_count 2
--
--   -- Releasing gives the use back, and cannot go negative.
--   SELECT public.release_promo_use('LIMITTEST');    -- used_count back to 0
--   SELECT public.claim_promo_use('LIMITTEST');      -- expect true again
--   SELECT public.release_promo_use('LIMITTEST');
--   SELECT public.release_promo_use('LIMITTEST');    -- used_count 0, not -1
--
--   -- Neither function is reachable from a user session. Both rows must be
--   -- absent for anon and authenticated:
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name IN ('admin_grant_subscription', 'claim_promo_use');
