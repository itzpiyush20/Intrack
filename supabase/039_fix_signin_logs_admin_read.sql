-- 039_fix_signin_logs_admin_read.sql
--
-- Replaces a SELECT policy that granted every user's email address to anyone
-- who controlled an unregistered vanity domain.
--
-- Production's signin_logs carried this, from an early emergency migration
-- (since removed from supabase/archive/):
--
--   CREATE POLICY "Creators can view all signin logs"
--     ON public.signin_logs FOR SELECT
--     USING ((auth.jwt() ->> 'email') LIKE '%@<vanity-domain>');
--
-- signin_logs holds user_id, email, device_name and created_at for EVERY
-- sign-in. So that policy handed the complete user email list, plus device
-- names, to anybody whose JWT email ended in that domain.
--
-- The app has never run on that domain — it is served from www.intrack.co.in —
-- and the mailbox referenced there was never live. The attack would have been:
-- register the domain, sign up with any address on it, confirm the verification
-- mail, sign in, then SELECT the table using the anon key that already ships in
-- the public bundle. No other access required, nothing anomalous-looking.
--
-- Not exploited: the domain was confirmed still unregistered with the .in
-- registry on 2026-08-25, and it never had an MX record, so no verification
-- mail could have been received. Treat as closed, not as disclosed.
--
-- WHY IT SURVIVED. schema.sql line ~493 had the correct version for some time:
--
--   USING (public.is_admin())
--
-- but schema.sql only runs when a database is CREATED. Production predates it,
-- and no numbered migration ever shipped the change. Migration 032 touched this
-- very table and replaced its INSERT policy, but left the SELECT policy alone.
-- This is the third time this exact trap has bitten the project, after
-- razorpay_subscription_id and is_admin — see the schema.sql note in CLAUDE.md.
--
-- is_admin() is the right check: it is SECURITY DEFINER, reads
-- profiles.is_admin, and is what every other admin surface already uses
-- (022_admin_metrics, 024, 025, 026).

BEGIN;

-- Idempotent, and drops BOTH spellings: the archived domain-based policy and
-- any correct one already applied, so re-running cannot leave two SELECT
-- policies OR'd together — which would silently keep the domain grant alive.
DROP POLICY IF EXISTS "Creators can view all signin logs" ON public.signin_logs;
DROP POLICY IF EXISTS "Admins can view all signin logs" ON public.signin_logs;

CREATE POLICY "Creators can view all signin logs"
  ON public.signin_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMIT;

-- Verify afterwards:
--
--   -- expect exactly one SELECT policy, whose qual is is_admin() and which
--   -- mentions no email domain at all
--   SELECT policyname, roles, qual
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename  = 'signin_logs'
--      AND cmd = 'SELECT';
--
--   -- expect zero rows; any hit here means a domain check survived somewhere
--   SELECT tablename, policyname, qual
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND qual ILIKE '%@%';   -- any email-domain check at all
--
-- Historical rows are left alone, consistent with 032. If the domain was ever
-- registered by someone else, assume the email list was readable and treat it
-- as disclosed; there is no audit trail that would show whether it was read.
