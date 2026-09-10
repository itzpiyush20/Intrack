-- 047_rls_initplan_and_fk_indexes.sql
--
-- Pre-launch database housekeeping. Four independent problems, all found by the
-- Supabase advisors on 2026-09-10 and each verified by reading the live
-- catalogue before anything here was written. None of it changes who can see
-- what; it changes how much work the database does to reach the same answer.
--
-- ------------------------------------------------------------------
-- 1. RLS policies re-evaluated auth.uid() / is_admin() once PER ROW
-- ------------------------------------------------------------------
--
-- `USING (auth.uid() = user_id)` makes Postgres treat auth.uid() as a
-- per-row function call, so a query scanning 5,000 transactions parses the JWT
-- 5,000 times to reach the same answer. Wrapping it as
-- `USING ((select auth.uid()) = user_id)` turns it into an InitPlan: evaluated
-- once, then compared as a constant. Identical semantics, identical security.
-- This is Supabase's own documented remedy for lint 0003.
--
-- is_admin() matters more than auth.uid() here, because it is not just a JWT
-- read — it is a SECURITY DEFINER function that SELECTs from profiles. Per row.
--
-- Every policy below is dropped and recreated rather than altered, because
-- Postgres has no ALTER POLICY that rewrites an expression in place. The whole
-- migration is one transaction: DDL in Postgres is transactional, so either
-- every policy is replaced or none is. There is no window in which a table sits
-- without its policy.
--
-- ------------------------------------------------------------------
-- 2. Duplicate policies
-- ------------------------------------------------------------------
--
-- Permissive policies are OR'd, so every duplicate is extra work on every
-- query. Verified byte-identical in pg_policies before dropping:
--
--   email_scan_logs INSERT "Users can create own scan logs"  with_check (auth.uid() = user_id)
--   email_scan_logs INSERT "Users can insert own scan logs"  with_check (auth.uid() = user_id)
--
--   merchant_rules  ALL    "Users can manage own merchant rules"  qual+check (auth.uid() = user_id)
--   merchant_rules  SELECT/INSERT/UPDATE/DELETE  — four policies, same expression
--
-- The ALL policy on merchant_rules covers exactly what the four per-action ones
-- cover, so the four go and the ALL one stays.
--
-- ------------------------------------------------------------------
-- 3. Policies scoped to `public` where they call is_admin()
-- ------------------------------------------------------------------
--
-- Nine policies were TO public — meaning anon evaluates them too, and anon's
-- auth.uid() is NULL so they can never match. Harmless but wasteful, and it is
-- what blocks revoking is_admin() from anon: a policy expression is evaluated
-- as the querying role, so revoking while anon still evaluates is_admin() would
-- turn an anonymous read into "permission denied for function is_admin" rather
-- than an empty result. Scope first, then revoke — in that order, in this file.
--
-- Deliberately NOT scoped: support_tickets INSERT "Anyone can file a support
-- ticket". The support form works logged out and that is intentional (031, with
-- throttle_support_tickets as the abuse gate). Checked before scoping the
-- matching SELECT policy: src/services/support.ts:61 and
-- src/services/feedback.ts:62 both issue a bare .insert(row) with no .select(),
-- so neither needs to read its row back and neither breaks.
--
-- ------------------------------------------------------------------
-- 4. Duplicate and missing indexes
-- ------------------------------------------------------------------
--
-- merchant_rules carried THREE indexes on (user_id, merchant_key): the UNIQUE
-- constraint index plus two identical non-unique copies. Both copies go; the
-- unique one serves every lookup they served.
--
-- Nine foreign keys had no covering index. The two that matter most are the
-- self-references on transactions: both are ON DELETE SET NULL, so deleting a
-- single expense makes Postgres scan the whole transactions table twice to
-- clear references to it. That is an everyday user action, not a rare one.
--
-- The rest are ON DELETE CASCADE or SET NULL paths that run when an account is
-- deleted. delete_user() removes the auth.users row and lets the cascade do the
-- rest, and a BEFORE DELETE trigger (anonymize_user_authored_records, 036)
-- UPDATEs feedback and support_tickets filtered on user_id — both unindexed.
-- A right-to-erasure request that times out is a DPDPA problem, not merely a
-- slow query.
--
-- Partial indexes (WHERE ... IS NOT NULL) are used for the columns that are
-- almost always NULL — the admin-reviewer columns and the transaction
-- self-references. A partial index is still usable for the `col = $1` lookup
-- the FK maintenance issues, and stays a fraction of the size. This matches the
-- existing style of idx_transactions_reference in schema.sql.

BEGIN;

-- ==================================================================
-- balance_periods
-- ==================================================================
DROP POLICY IF EXISTS "Users can manage own balance periods" ON public.balance_periods;
CREATE POLICY "Users can manage own balance periods" ON public.balance_periods
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ==================================================================
-- budgets
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own budgets" ON public.budgets;
CREATE POLICY "Users can view own budgets" ON public.budgets
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own budgets" ON public.budgets;
CREATE POLICY "Users can create own budgets" ON public.budgets
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own budgets" ON public.budgets;
CREATE POLICY "Users can update own budgets" ON public.budgets
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own budgets" ON public.budgets;
CREATE POLICY "Users can delete own budgets" ON public.budgets
  FOR DELETE USING ((select auth.uid()) = user_id);

-- ==================================================================
-- card_periods / cards
-- ==================================================================
DROP POLICY IF EXISTS "Users can manage own card periods" ON public.card_periods;
CREATE POLICY "Users can manage own card periods" ON public.card_periods
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage own cards" ON public.cards;
CREATE POLICY "Users can manage own cards" ON public.cards
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ==================================================================
-- categories
--
-- categories_update_own deliberately has USING and no WITH CHECK, exactly as
-- before. Postgres reuses the USING expression as the check when WITH CHECK is
-- omitted, so this is not a gap — and adding one here would be a behaviour
-- change smuggled into a performance migration.
-- ==================================================================
DROP POLICY IF EXISTS categories_select_own ON public.categories;
CREATE POLICY categories_select_own ON public.categories
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS categories_insert_own ON public.categories;
CREATE POLICY categories_insert_own ON public.categories
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS categories_update_own ON public.categories;
CREATE POLICY categories_update_own ON public.categories
  FOR UPDATE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS categories_delete_own ON public.categories;
CREATE POLICY categories_delete_own ON public.categories
  FOR DELETE USING ((select auth.uid()) = user_id);

-- ==================================================================
-- email_scan_logs — the duplicate INSERT policy goes here
-- ==================================================================
DROP POLICY IF EXISTS "Users can create own scan logs" ON public.email_scan_logs;

DROP POLICY IF EXISTS "Users can insert own scan logs" ON public.email_scan_logs;
CREATE POLICY "Users can insert own scan logs" ON public.email_scan_logs
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own scan logs" ON public.email_scan_logs;
CREATE POLICY "Users can view own scan logs" ON public.email_scan_logs
  FOR SELECT USING ((select auth.uid()) = user_id);

-- ==================================================================
-- email_scan_rejections
-- ==================================================================
DROP POLICY IF EXISTS "Users can insert own scan rejections" ON public.email_scan_rejections;
CREATE POLICY "Users can insert own scan rejections" ON public.email_scan_rejections
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own scan rejections" ON public.email_scan_rejections;
CREATE POLICY "Users can view own scan rejections" ON public.email_scan_rejections
  FOR SELECT USING ((select auth.uid()) = user_id);

-- ==================================================================
-- feedback — is_admin() callers, scoped to authenticated
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own feedback" ON public.feedback;
CREATE POLICY "Users can view own feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (((select auth.uid()) = user_id) OR (select public.is_admin()));

DROP POLICY IF EXISTS "Users can submit own feedback" ON public.feedback;
CREATE POLICY "Users can submit own feedback" ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can update feedback" ON public.feedback;
CREATE POLICY "Admins can update feedback" ON public.feedback
  FOR UPDATE TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ==================================================================
-- insurance_policies
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own insurance policies" ON public.insurance_policies;
CREATE POLICY "Users can view own insurance policies" ON public.insurance_policies
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own insurance policies" ON public.insurance_policies;
CREATE POLICY "Users can create own insurance policies" ON public.insurance_policies
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own insurance policies" ON public.insurance_policies;
CREATE POLICY "Users can update own insurance policies" ON public.insurance_policies
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own insurance policies" ON public.insurance_policies;
CREATE POLICY "Users can delete own insurance policies" ON public.insurance_policies
  FOR DELETE USING ((select auth.uid()) = user_id);

-- ==================================================================
-- merchant_rules — four redundant per-action policies dropped
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own merchant rules" ON public.merchant_rules;
DROP POLICY IF EXISTS "Users can insert own merchant rules" ON public.merchant_rules;
DROP POLICY IF EXISTS "Users can update own merchant rules" ON public.merchant_rules;
DROP POLICY IF EXISTS "Users can delete own merchant rules" ON public.merchant_rules;

DROP POLICY IF EXISTS "Users can manage own merchant rules" ON public.merchant_rules;
CREATE POLICY "Users can manage own merchant rules" ON public.merchant_rules
  FOR ALL USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ==================================================================
-- payments — is_admin() callers, scoped to authenticated
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (((select auth.uid()) = user_id) OR (select public.is_admin()));

DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ==================================================================
-- profiles
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- ==================================================================
-- promo_codes / promo_redemptions
-- ==================================================================
DROP POLICY IF EXISTS "Admins can view promo codes" ON public.promo_codes;
CREATE POLICY "Admins can view promo codes" ON public.promo_codes
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "Users can view own redemptions" ON public.promo_redemptions;
CREATE POLICY "Users can view own redemptions" ON public.promo_redemptions
  FOR SELECT TO authenticated
  USING (((select auth.uid()) = user_id) OR (select public.is_admin()));

-- ==================================================================
-- signin_logs — already TO authenticated, only the InitPlan wrap changes
-- ==================================================================
DROP POLICY IF EXISTS "Creators can view all signin logs" ON public.signin_logs;
CREATE POLICY "Creators can view all signin logs" ON public.signin_logs
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "Users can log own signin" ON public.signin_logs;
CREATE POLICY "Users can log own signin" ON public.signin_logs
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- ==================================================================
-- subscription_charges
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own subscription charges" ON public.subscription_charges;
CREATE POLICY "Users can view own subscription charges" ON public.subscription_charges
  FOR SELECT TO authenticated
  USING (((select auth.uid()) = user_id) OR (select public.is_admin()));

-- ==================================================================
-- support_tickets
--
-- "Anyone can file a support ticket" is intentionally left untouched: it is the
-- logged-out support form, it is TO public, and its check is literally `true`
-- with throttle_support_tickets (032) as the abuse gate. Nothing to optimise
-- and nothing to tighten.
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own support tickets" ON public.support_tickets;
CREATE POLICY "Users can view own support tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (((select auth.uid()) = user_id) OR (select public.is_admin()));

DROP POLICY IF EXISTS "Admins can update support tickets" ON public.support_tickets;
CREATE POLICY "Admins can update support tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- ==================================================================
-- transactions
-- ==================================================================
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own transactions" ON public.transactions;
CREATE POLICY "Users can create own transactions" ON public.transactions
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "Users can update own transactions" ON public.transactions
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY "Users can delete own transactions" ON public.transactions
  FOR DELETE USING ((select auth.uid()) = user_id);

-- ==================================================================
-- Now that no policy makes anon evaluate is_admin(), revoke it.
--
-- Left as an admin-membership oracle it is minor — it returns false for any
-- uuid that is not an admin, and the caller must already hold a uuid — but
-- there is no reason for the anon key to reach it at all. authenticated keeps
-- EXECUTE because the policies above are evaluated as that role.
-- ==================================================================
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- ==================================================================
-- Indexes
-- ==================================================================

-- Duplicates. idx_email_scan_logs_user is the copy schema.sql creates, so it is
-- the one that stays.
DROP INDEX IF EXISTS public.idx_scan_logs_user_time;

-- Both non-unique copies go: merchant_rules_user_id_merchant_key_key, the index
-- backing the UNIQUE (user_id, merchant_key) constraint, covers the same
-- columns in the same order and cannot be dropped independently anyway.
DROP INDEX IF EXISTS public.idx_merchant_rules_user_merchant;
DROP INDEX IF EXISTS public.idx_merchant_rules_user_key;

-- Foreign keys with no covering index.
--
-- The two that hurt on an ordinary expense delete.
--
-- NOTE ON THE NAME. The obvious name, idx_transactions_possible_duplicate_of,
-- was ALREADY TAKEN by a different index — a composite on
-- (user_id, possible_duplicate_of). Because that name existed,
-- `CREATE INDEX IF NOT EXISTS idx_transactions_possible_duplicate_of` was a
-- silent no-op: no error, no index, and the FK stayed uncovered. It was caught
-- only by re-reading pg_constraint after applying, which is the entire reason
-- that verification step exists. Hence the distinct name below.
--
-- The pre-existing composite is left in place: user_id leads it, so it serves
-- the scanner's per-user duplicate lookup, but it cannot serve a bare
-- `possible_duplicate_of = $1` probe without scanning the whole index.
CREATE INDEX IF NOT EXISTS idx_transactions_possible_dup_fk
  ON public.transactions(possible_duplicate_of)
  WHERE possible_duplicate_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_settled_by
  ON public.transactions(settled_by_transaction_id)
  WHERE settled_by_transaction_id IS NOT NULL;

-- Account-deletion cascade and the 036 anonymisation trigger:
CREATE INDEX IF NOT EXISTS idx_signin_logs_user_id
  ON public.signin_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_insurance_policies_user_id
  ON public.insurance_policies(user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id
  ON public.feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON public.support_tickets(user_id);

-- Admin-reviewer columns. Almost always NULL, so partial keeps them tiny; they
-- only matter when an admin account is deleted, but they are free.
CREATE INDEX IF NOT EXISTS idx_feedback_handled_by
  ON public.feedback(handled_by)
  WHERE handled_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_handled_by
  ON public.support_tickets(handled_by)
  WHERE handled_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_refund_reviewed_by
  ON public.payments(refund_reviewed_by)
  WHERE refund_reviewed_by IS NOT NULL;

COMMIT;

-- ------------------------------------------------------------------
-- Verification — run after applying
-- ------------------------------------------------------------------
--
-- No policy should still call a bare auth.uid() or is_admin():
--
--   SELECT tablename, policyname, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (qual ~ '(?<!select )auth\.uid\(\)' OR with_check ~ '(?<!select )auth\.uid\(\)');
--
-- Every table that had a policy must still have one — a table left with RLS on
-- and no policy denies everything, which is the failure mode to watch for:
--
--   SELECT c.relname, c.relrowsecurity, count(p.policyname) AS policies
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--     LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
--    GROUP BY 1, 2 ORDER BY 3, 1;
--
--   SELECT has_function_privilege('anon', 'public.is_admin(uuid)', 'EXECUTE');  -- false
--
-- And re-run the Supabase advisors: lints 0003, 0006 and 0009 should be clear,
-- 0001 should drop from nine findings to none.
