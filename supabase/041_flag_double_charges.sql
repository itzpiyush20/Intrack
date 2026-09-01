-- 041_flag_double_charges.sql
--
-- Surfaces the one payment outcome that needs a human: a purchase that landed
-- on an already-occupied queue.
--
-- create-order.ts refuses a second purchase while a plan is queued, so the only
-- way two get through is near-simultaneous submission — a double-clicked
-- button, or gateway lag. apply_plan_purchase() returns 'queue_extended' for
-- that case and adds the duration onto the queued plan rather than dropping it,
-- on the principle that money already taken must always buy the customer time.
--
-- That principle is right, and it is not the whole answer. The published
-- Cancellation & Refund Policy (src/pages/RefundPage.tsx, section 3) commits to
-- something narrower and more specific:
--
--   "Duplicate Billings: In the event that your payment source was charged
--    multiple times for a single subscription cycle due to payment gateway lag
--    or server errors, duplicate charges will be refunded in full."
--
-- Silently converting that charge into extra days leaves the customer unaware
-- they paid twice and the operator unaware they owe a refund. Nothing here
-- decides which way it should go — refunding is a Razorpay action and stays a
-- human judgement. This makes it VISIBLE, which it was not.
--
-- Owner decision, 2026-09-01: keep adding the days, and report the double
-- charge to the operator. Same shape as the queued-plan cancellation notice in
-- api/admin.ts: the code never moves money on its own, it just refuses to be
-- quiet about money that moved.

BEGIN;

-- ==========================================
-- 1. Record what the purchase actually did
-- ==========================================
--
-- apply_plan_purchase() already returns this; nothing persisted it, so the
-- distinction between a normal purchase and a double charge lived only in a
-- serverless log line. Nullable and unconstrained on purpose: rows written
-- before this migration have no outcome, and a CHECK would have to be widened
-- every time apply_plan_purchase grows a branch.
--
--   'activated'       plan started immediately
--   'queued'          paid for, starts when the current plan ends
--   'queue_extended'  landed on an occupied queue — THE ONE NEEDING REVIEW
--   'already_applied' the same order delivered twice (webhook + browser).
--                     Not a double charge: one payment, two deliveries, and
--                     the unique index on razorpay_order_id means only the
--                     first delivery ever writes a row.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS outcome TEXT;

-- When the operator decided what to do about it. NULL means nobody has looked
-- yet, which is what the admin panel counts. Deliberately not a boolean: the
-- date is what an operator wants when a customer asks why a refund took a week.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_reviewed_at TIMESTAMPTZ;

-- References profiles, not auth.users, to match feedback.handled_by (028) and
-- support_tickets.handled_by (031). Both end up NULL when the reviewer's
-- account is erased — profiles.id cascades from auth.users — but pointing at
-- the same table as its two siblings is what keeps the erasure story in 036
-- readable as one rule rather than three.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Only the handful of rows that need attention, so the admin panel's count is
-- an index lookup rather than a scan of every payment ever taken.
CREATE INDEX IF NOT EXISTS idx_payments_needs_refund_review
  ON public.payments(created_at DESC)
  WHERE outcome = 'queue_extended' AND refund_reviewed_at IS NULL;

-- ==========================================
-- 2. Reading them
-- ==========================================
--
-- SECURITY DEFINER with the is_admin() guard every admin function in 022 opens
-- with — it reads across users, which RLS would otherwise forbid. The email
-- comes from profiles so the operator can contact the customer without a
-- second lookup, and the order id is included because a Razorpay refund cannot
-- be traced without it.
CREATE OR REPLACE FUNCTION public.admin_charges_needing_review(lim INT DEFAULT 50)
RETURNS TABLE (
  id                  UUID,
  email               TEXT,
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  plan_type           TEXT,
  amount_inr          NUMERIC,
  created_at          TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pr.email,
    p.razorpay_order_id,
    p.razorpay_payment_id,
    p.plan_type,
    p.amount_inr,
    p.created_at
  FROM public.payments p
  JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.outcome = 'queue_extended'
    AND p.refund_reviewed_at IS NULL
  ORDER BY p.created_at DESC
  LIMIT lim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_charges_needing_review(INT) FROM PUBLIC;
-- anon by name, for the reason 037 exists: Supabase's default privileges grant
-- these roles EXECUTE directly, and REVOKE ... FROM PUBLIC does not strip a
-- direct grant. `authenticated` keeps EXECUTE because the admin panel calls
-- this from the browser with the user's own token — the is_admin() guard above
-- is what makes that safe, exactly as in 022.
REVOKE ALL ON FUNCTION public.admin_charges_needing_review(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_charges_needing_review(INT) TO authenticated, service_role;

-- ==========================================
-- 3. Marking one reviewed
-- ==========================================
--
-- An admin-only UPDATE policy rather than a serverless endpoint, matching how
-- feedback (028) and support tickets (031) are marked handled: it touches no
-- protected column and carries no privilege, so it needs no service-role key.
--
-- payments had no UPDATE policy at all before this, and still has none for
-- anyone else — a client that could write here could invent revenue, which is
-- why 025 gave it no INSERT policy either.
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments"
  ON public.payments FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;

-- ==========================================
-- Verifying by hand
-- ==========================================
--
--   -- Nothing to review on a healthy system.
--   SELECT public.admin_charges_needing_review();   -- expect 0 rows
--
--   -- Simulate one. Use a real user_id from profiles.
--   INSERT INTO public.payments (user_id, razorpay_order_id, plan_type,
--                                amount_inr, source, status, outcome)
--        VALUES ('<uuid>', 'order_dbltest', 'monthly', 31, 'razorpay',
--                'captured', 'queue_extended');
--   SELECT public.admin_charges_needing_review();   -- expect 1 row, with email
--
--   -- Marking it reviewed takes it off the list.
--   UPDATE public.payments SET refund_reviewed_at = now()
--    WHERE razorpay_order_id = 'order_dbltest';
--   SELECT public.admin_charges_needing_review();   -- expect 0 rows again
--
--   DELETE FROM public.payments WHERE razorpay_order_id = 'order_dbltest';
--
--   -- A normal purchase never appears here.
--   -- outcome 'activated' / 'queued' / 'already_applied' are all excluded by
--   -- the WHERE clause above; only 'queue_extended' is a double charge.
--
--   -- anon must not hold EXECUTE:
--   SELECT routine_name, grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name = 'admin_charges_needing_review';
--   -- expect postgres, authenticated, service_role — and NOT anon.
