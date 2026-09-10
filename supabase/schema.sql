-- ============================================
-- Intrack — Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- ==========================================
-- 1. PROFILES TABLE
-- Extends Supabase auth.users with app data
-- ==========================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  email_notifications_enabled BOOLEAN DEFAULT true,
  budget_alerts_enabled BOOLEAN DEFAULT true,
  weekly_report_enabled BOOLEAN DEFAULT true,
  subscription_reminders_enabled BOOLEAN DEFAULT true,
  currency TEXT DEFAULT 'INR' CHECK (currency IN ('INR', 'USD')),
  active_financial_year INTEGER DEFAULT 2026,
  promo_code TEXT DEFAULT NULL,
  daily_scan_time TEXT DEFAULT '06:00',
  -- Every new account starts on the 7-day trial the marketing promises, and it
  -- starts here: handle_new_user() inserts only id, email, full_name and
  -- avatar_url, so these three DEFAULTS are the entire signup entitlement.
  --
  -- They used to say DEFAULT 'free' with no expiry and no plan type, which made
  -- a database built from this file behave differently from production — where
  -- someone had set 'trial' / 'trial' / now() + 14 days by hand, in the
  -- dashboard, recorded nowhere. Production gave 14 days, the pricing page
  -- promised 7, and a fresh install gave none at all. See migration 034.
  subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('free', 'trial', 'active', 'expired', 'cancelled')),
  -- Three paid-facing tiers: free, monthly and annual/yearly. 'trial' is also a
  -- valid value here — it is what a free account carries during its 7-day trial,
  -- and PricingPage uses it to tell an expired trial from an expired paid plan.
  subscription_plan_type TEXT DEFAULT 'trial' CHECK (subscription_plan_type IN ('trial', 'monthly', 'annual')),
  subscription_expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  razorpay_subscription_id TEXT,
  razorpay_order_id TEXT,
  -- Set when Razorpay reports a failed renewal (subscription.halted); cleared
  -- by the next successful charge. Display-only — it never gates access. 045.
  subscription_halted_at TIMESTAMPTZ,
  -- A plan bought while another was still running. All four are NULL together
  -- or set together; pending_plan_type IS NOT NULL means "something is queued".
  -- See migration 035.
  pending_plan_type TEXT CHECK (pending_plan_type IS NULL OR pending_plan_type IN ('monthly', 'annual')),
  pending_duration_days INT,
  pending_order_id TEXT,
  pending_activates_at TIMESTAMPTZ,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Safety net for existing deployments: CREATE TABLE IF NOT EXISTS above is a
-- no-op once profiles already exists, so make sure the column is added either way.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_calls_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_calls_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- protect_server_only_profile_columns reads both of these, so a database that
-- predates them fails every UPDATE on profiles with error 42703 until they exist.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_halted_at TIMESTAMPTZ;
-- protect_server_only_profile_columns reads all four, so a database that
-- predates them fails every UPDATE on profiles with error 42703 until they exist.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_plan_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_duration_days INT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_order_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_activates_at TIMESTAMPTZ;

-- Returns true if the given user (default: caller) is flagged as an admin.
-- SECURITY DEFINER so it can read profiles.is_admin without recursing into
-- the RLS policies that call it. Admin status is granted by manually setting
-- profiles.is_admin = true for specific accounts — see TRANSFER_GUIDE.md.
-- search_path is pinned on every SECURITY DEFINER function in this file. Such a
-- function runs with the DEFINER's privileges, so an unpinned search_path lets
-- a caller's own setting decide which objects the body resolves to. Migration
-- 023 already ships this pinned form; this copy had drifted without it.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = uid), false);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Permanently erases the calling user's account. profiles.id cascades from
-- auth.users and every other user table cascades from profiles, so this one
-- statement removes all of their data. SECURITY DEFINER is needed to touch
-- auth.users; it is safe because the WHERE clause is pinned to auth.uid() and
-- the function takes no parameters, so a caller can only delete themselves.
-- See supabase/012_delete_user_rpc.sql for the migration form.
CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  DELETE FROM auth.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;

-- Auto-create profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- 2. TRANSACTIONS TABLE
-- Stores both manual and email-extracted transactions
-- ==========================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'email')),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  reference_id TEXT,
  merchant TEXT,
  payment_mode TEXT CHECK (payment_mode IN ('upi','credit_card','debit_card','net_banking','neft','rtgs','imps','wallet','atm','nach','cheque','unknown')),
  card_issuer TEXT,
  card_brand TEXT CHECK (card_brand IN ('Visa','Mastercard','RuPay','American Express','Diners')),
  transaction_time TEXT,
  confidence_score INTEGER,
  email_message_id TEXT,
  event_type TEXT,
  tags TEXT[] DEFAULT '{}',
  is_returnable BOOLEAN NOT NULL DEFAULT false,
  counterparty TEXT,
  expected_return_date DATE,
  return_status TEXT CHECK (return_status IN ('pending', 'received')),
  settled_by_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  category_confirmed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- 3. BUDGETS TABLE
-- Monthly budget per category
-- ==========================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  month TEXT NOT NULL, -- Format: YYYY-MM
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- One budget per category per month per user
  UNIQUE(user_id, category, month)
);

-- ==========================================
-- INSURANCE_POLICIES TABLE
-- Life/health insurance premiums and due dates
-- ==========================================
CREATE TABLE IF NOT EXISTS public.insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  policy_name TEXT NOT NULL,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('life', 'health')),
  premium_amount DECIMAL(12, 2) NOT NULL CHECK (premium_amount > 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'half_yearly', 'annual')),
  next_due_date DATE NOT NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- GOOGLE_OAUTH_TOKENS TABLE
-- Server-side refresh token storage for automatic Gmail sync
-- ==========================================
CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service-role only, same pattern documented
-- in migration 006_google_oauth_tokens.sql.

-- ==========================================
-- 4. EMAIL_SCAN_LOGS TABLE
-- Tracks daily email scan jobs
-- ==========================================
CREATE TABLE IF NOT EXISTS public.email_scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  emails_processed INTEGER DEFAULT 0,
  transactions_found INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  gmail_history_id TEXT,
  next_scan_time TIMESTAMPTZ,
  scan_mode TEXT CHECK (scan_mode IN ('manual', 'scheduled')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- 5. INDEXES — Performance optimization
-- ==========================================

-- Transactions: most common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON public.transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_user_status ON public.transactions(user_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON public.transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_reference_id ON public.transactions(user_id, reference_id) WHERE reference_id IS NOT NULL;

-- Budgets: lookup by user + month
CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON public.budgets(user_id, month);

-- Email scan logs: lookup by user
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_user ON public.email_scan_logs(user_id, scanned_at DESC);

-- ==========================================
-- 6. AUTO-UPDATE updated_at TRIGGER
-- ==========================================
-- search_path is pinned (migration 046). 033 pinned every SECURITY DEFINER
-- function and missed this one because it is a plain trigger function, but it
-- fires BEFORE UPDATE on six tables and Supabase's linter flags it regardless.
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_transactions ON public.transactions;
CREATE TRIGGER set_updated_at_transactions
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_budgets ON public.budgets;
CREATE TRIGGER set_updated_at_budgets
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ==========================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Users can only access their own data
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_scan_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((select auth.uid()) = id OR (select public.is_admin()));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- RLS policies can't restrict which COLUMNS an UPDATE touches, only which
-- ROWS — so the policy above, on its own, lets a signed-in user set their
-- own subscription_status to 'active' (free premium) or is_admin to true
-- via a direct client call. This trigger closes that gap by rejecting
-- changes to server-managed columns unless the request runs as the
-- service role (webhook.ts / verify-payment.ts use the service-role key).
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

-- TRANSACTIONS policies
CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  USING ((select auth.uid()) = user_id);

-- BUDGETS policies
CREATE POLICY "Users can view own budgets"
  ON public.budgets FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own budgets"
  ON public.budgets FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own budgets"
  ON public.budgets FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own budgets"
  ON public.budgets FOR DELETE
  USING ((select auth.uid()) = user_id);

-- INSURANCE_POLICIES policies
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insurance policies"
  ON public.insurance_policies FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own insurance policies"
  ON public.insurance_policies FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own insurance policies"
  ON public.insurance_policies FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own insurance policies"
  ON public.insurance_policies FOR DELETE
  USING ((select auth.uid()) = user_id);

-- EMAIL_SCAN_LOGS policies
CREATE POLICY "Users can view own scan logs"
  ON public.email_scan_logs FOR SELECT
  USING ((select auth.uid()) = user_id);

-- Named to match production. A later migration had added a second, identical
-- INSERT policy called "Users can insert own scan logs"; 047 dropped the
-- duplicate and kept that name, so this one adopts it rather than leaving a
-- fresh database with a policy name no migration can find.
CREATE POLICY "Users can insert own scan logs"
  ON public.email_scan_logs FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- PROFILES delete policy
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING ((select auth.uid()) = id);

-- ==========================================
-- 8. SECURE USER DELETION RPC
--
-- Defined ONCE, near the top of this file with the profiles table it depends
-- on. A second copy used to sit here, and because this file runs top to bottom
-- CREATE OR REPLACE meant that copy WON on every fresh install — while being
-- the weaker of the two: plpgsql without `SET search_path`, and with none of
-- the REVOKE/GRANT hardening. A SECURITY DEFINER function with an unpinned
-- search_path is exactly what that hardening exists to prevent.
--
-- Existing databases were unaffected (they were built before the duplicate
-- appeared, and migration 012 installs the hardened form). Only a brand-new
-- deployment inherited the weak one — the same schema.sql drift that migrations
-- 021, 023 and 024 each had to repair after the fact.
-- ==========================================

-- ==========================================
-- 9. MERCHANT RULES TABLE
-- Stores per-user learned merchant categorisation rules
-- ==========================================
CREATE TABLE IF NOT EXISTS public.merchant_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  preferred_category TEXT NOT NULL DEFAULT 'other',
  card_brand TEXT CHECK (card_brand IN ('Visa','Mastercard','RuPay','American Express','Diners')),
  auto_approve BOOLEAN DEFAULT true,
  confidence INTEGER DEFAULT 100,
  times_confirmed INTEGER DEFAULT 1,
  last_updated TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, merchant_key)
);

ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own merchant rules"
  ON public.merchant_rules FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- No index is created here on (user_id, merchant_key): the UNIQUE constraint in
-- the table definition above already builds one, and a second copy is pure
-- write overhead. Production carried two such copies until 047 dropped them.

-- ==========================================
-- 10. TESTER FEEDBACK TABLE
-- Collects feedback, bug reports, and ratings from app testers
-- ==========================================
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature_request', 'ui_ux', 'other')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS on feedback
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- A signed-in user may submit feedback as themselves. This was
-- WITH CHECK (true), which granted INSERT to anyone holding the public anon
-- key — see migration 032. The in-app feedback modal is rendered only inside
-- the signed-in profile menu, so nothing anonymous ever used it.
CREATE POLICY "Users can submit own feedback"
  ON public.feedback FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Allow users to view their own submitted feedback, and creators to view all feedback
DROP POLICY IF EXISTS "Users can view own feedback" ON public.feedback;
CREATE POLICY "Users can view own feedback"
  ON public.feedback FOR SELECT
  USING ((select auth.uid()) = user_id OR (select public.is_admin()));

-- ==========================================
-- 10. SIGNIN_LOGS TABLE
-- Tracks all successful user signins for investor auditing
-- ==========================================
CREATE TABLE IF NOT EXISTS public.signin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS on signin_logs
ALTER TABLE public.signin_logs ENABLE ROW LEVEL SECURITY;

-- A signed-in user may log their OWN sign-in, and nothing else. This was
-- WITH CHECK (true) — see migration 032 — which let anyone with the public
-- anon key write unlimited rows carrying any email address, directly into the
-- table admin_overview_stats counts for "sign-ins this week".
CREATE POLICY "Users can log own signin"
  ON public.signin_logs FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Allow creators to view all signin logs.
--
-- This file only runs on a NEW database, so the correct rule below never
-- reached production, which was created earlier and still carried the
-- archived emergency version:
--   USING ((auth.jwt() ->> 'email') LIKE '%@<vanity-domain>')
-- — handing every user's email to anyone controlling that unregistered domain.
-- Migration 039 ships the fix. Do not "fix" a policy here alone; a numbered
-- migration is the only thing production ever sees.
CREATE POLICY "Creators can view all signin logs"
  ON public.signin_logs FOR SELECT
  TO authenticated
  USING ((select public.is_admin()));

-- ==========================================
-- 11. CARDS, BALANCE PERIODS AND CARD PERIODS
-- Credit cards the user defines themselves, plus the monthly opening figures
-- the balance maths is built on. See plans/accounts-and-balances.md.
--
-- The previous public.cards described any card seen in an email and was never
-- written to by any UI. 042 replaced it with this: cards a user deliberately
-- set up and wants an outstanding balance for.
-- ==========================================
CREATE TABLE IF NOT EXISTS public.cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  issuer      TEXT,
  last4       TEXT,
  brand       TEXT CHECK (brand IN ('Visa','Mastercard','RuPay','American Express','Diners')),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON public.cards(user_id);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own cards" ON public.cards;
CREATE POLICY "Users can manage own cards"
  ON public.cards FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at_cards ON public.cards;
CREATE TRIGGER set_updated_at_cards
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- One combined "cash in hand and bank balances" figure per user per month.
-- Per month rather than once, so a correction lands on the month it was made
-- and the months before it keep the figures they already reported.
CREATE TABLE IF NOT EXISTS public.balance_periods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month          DATE NOT NULL CHECK (date_trunc('month', month) = month),
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_user_set    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_balance_periods_user_month
  ON public.balance_periods(user_id, month DESC);

ALTER TABLE public.balance_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own balance periods" ON public.balance_periods;
CREATE POLICY "Users can manage own balance periods"
  ON public.balance_periods FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at_balance_periods ON public.balance_periods;
CREATE TRIGGER set_updated_at_balance_periods
  BEFORE UPDATE ON public.balance_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.card_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id             UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  month               DATE NOT NULL CHECK (date_trunc('month', month) = month),
  opening_outstanding NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_user_set         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, month)
);

CREATE INDEX IF NOT EXISTS idx_card_periods_user_month
  ON public.card_periods(user_id, month DESC);

ALTER TABLE public.card_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own card periods" ON public.card_periods;
CREATE POLICY "Users can manage own card periods"
  ON public.card_periods FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at_card_periods ON public.card_periods;
CREATE TRIGGER set_updated_at_card_periods
  BEFORE UPDATE ON public.card_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ==========================================
-- 12. EMAIL DEDUPLICATION CONSTRAINT
-- Prevents the same Gmail message being inserted as a
-- transaction twice for the same user
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_email_message_id_user_id_key'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_email_message_id_user_id_key
      UNIQUE (email_message_id, user_id);
  END IF;
END$$;

-- ==========================================
-- Migrations 010 and 014-019, folded in for fresh installs
--
-- These landed as numbered migration files and were never reflected back
-- here, so a database built only from schema.sql was missing columns the
-- scanner reads on every run and failed on the first scan rather than
-- degrading. Every statement is idempotent, so re-running against an
-- already-migrated database is a no-op.
-- ==========================================

-- 010 — diagnostic log of emails the scanner rejected, and why.
CREATE TABLE IF NOT EXISTS public.email_scan_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scan_log_id UUID REFERENCES public.email_scan_logs(id) ON DELETE CASCADE,
  sender_domain TEXT,
  subject TEXT,
  gate TEXT NOT NULL,
  matched_snippet TEXT,
  rejected_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_scan_rejections_user
  ON public.email_scan_rejections(user_id, rejected_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_scan_rejections_scan_log
  ON public.email_scan_rejections(scan_log_id);

ALTER TABLE public.email_scan_rejections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_scan_rejections' AND policyname = 'Users can view own scan rejections') THEN
    CREATE POLICY "Users can view own scan rejections"
      ON public.email_scan_rejections FOR SELECT
      USING ((select auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_scan_rejections' AND policyname = 'Users can insert own scan rejections') THEN
    CREATE POLICY "Users can insert own scan rejections"
      ON public.email_scan_rejections FOR INSERT
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END$$;

-- 014 — the manual-scan quota query filters user_id + scan_mode + status over
-- a trailing 24h window; the existing (user_id, scanned_at) index cannot serve
-- those predicates. The scan_mode column itself is already declared above.
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_manual_quota
  ON public.email_scan_logs (user_id, scan_mode, status, scanned_at DESC);

-- 015 — a merged payment keeps one row but must remember every email it
-- absorbed, since UNIQUE (email_message_id, user_id) allows only one id.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merged_email_message_ids TEXT[];

CREATE INDEX IF NOT EXISTS idx_transactions_merged_email_ids
  ON public.transactions USING GIN (merged_email_message_ids);

-- 016 — a foreign charge is recorded as what it actually is. Note this is the
-- TRANSACTION's currency; profiles.currency above is the display preference.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_currency_check'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_currency_check
      CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_transactions_currency
  ON public.transactions (user_id, currency, date DESC);

-- 042 — which card a transaction sits on, which card a bill payment settles,
-- and where borrowed money came from. All nullable: the balances feature is
-- optional and every existing row stays valid without them.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS settles_card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS loan_source TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS loan_source_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_loan_source_check'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_loan_source_check
      CHECK (loan_source IS NULL OR loan_source IN ('credit_card','bank','family_friend','other'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_transactions_card
  ON public.transactions(card_id) WHERE card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_settles_card
  ON public.transactions(settles_card_id) WHERE settles_card_id IS NOT NULL;

-- 043 — a deliberately deleted budget, marked rather than removed. Budgets
-- carry forward from the most recent month that has them, so removing the row
-- would let the next read restore exactly what the user just deleted.
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_budgets_user_month_live
  ON public.budgets(user_id, month)
  WHERE deleted_at IS NULL;

-- 017 — rejected emails are remembered so a later scan never re-fetches them.
ALTER TABLE public.email_scan_rejections
  ADD COLUMN IF NOT EXISTS email_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_scan_rejections_user_msg
  ON public.email_scan_rejections(user_id, email_message_id);

-- 018 — a look-alike transaction that could not be PROVEN to be the same
-- payment is kept as its own row and flagged, rather than merged away.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID
  REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_possible_duplicate_of
  ON public.transactions(user_id, possible_duplicate_of)
  WHERE possible_duplicate_of IS NOT NULL;

-- 019 — the atomic AI-quota functions live in supabase/019_atomic_ai_quota.sql.
-- Run that file as well on a fresh install; it is kept separate because it
-- defines SECURITY DEFINER functions with their own GRANT/REVOKE.

-- ==========================================
-- 12. PAYMENTS, PROMO CODES, ADMIN METRICS
--
-- These arrived as migrations 022-027. They are listed here so a FRESH install
-- gets them too — see the CLAUDE.md convention: anything added to this file
-- after a database exists only reaches production via a numbered migration.
-- Run these files as well on a fresh install; they are kept separate because
-- they define SECURITY DEFINER functions and RLS policies of their own:
--
--   022_admin_metrics.sql      admin-guarded aggregate functions
--   023_is_admin_backfill.sql  profiles.is_admin + public.is_admin()
--   024_feedback_table.sql     public.feedback
--   025_payments.sql           public.payments
--   026_promo_codes.sql        public.promo_codes, public.promo_redemptions
--   027_allow_self_expire.sql  lets a lapsed plan mark itself expired
--   028_admin_operations.sql   admin subscription ops, feedback workflow
--   029_promo_delete.sql       drops the redemption FK so codes can be deleted
--   030_promo_code_expiry.sql  promo_codes.expires_at
--   031_support_tickets.sql    public.support_tickets + its admin read RPCs
--   032_close_anonymous_writes.sql  removes anon INSERT on signin_logs and
--                              feedback; rate-limits support_tickets
--   033_pin_security_definer_search_path.sql  pins search_path on the two
--                              SECURITY DEFINER functions production ran without
--   034_trial_defaults.sql     trial becomes 7 days, not 14, and the signup
--                              defaults are recorded instead of living only in
--                              the Supabase dashboard
--   035_extend_subscription.sql  apply_plan_purchase() and
--                              activate_pending_plan(): renewals extend rather
--                              than overwrite, and a plan bought early is
--                              queued behind the running one
--   036_erase_on_delete.sql    anonymize_user_authored_records — deleting an
--                              account scrubs the name and email off the
--                              feedback and support tickets it leaves behind
--   037_revoke_ai_quota_from_untrusted_roles.sql  strips the direct anon and
--                              authenticated grants Supabase's default
--                              privileges hand to SECURITY DEFINER functions
--   038_align_subscription_status_check.sql  the status CHECK matches the
--                              statuses the app actually writes
--   039_fix_signin_logs_admin_read.sql  admins can read signin_logs, which
--                              admin_user_list's "last seen" column needs
--   040_admin_grant_and_promo_use.sql  admin_grant_subscription() (a grant
--                              extends paid time instead of replacing it) and
--                              claim_promo_use() (max_uses enforced in one
--                              statement, so two simultaneous redemptions of a
--                              one-use code cannot both succeed)
--   041_flag_double_charges.sql  payments.outcome + refund_reviewed_at, and
--                              admin_charges_needing_review() — a purchase that
--                              landed on an occupied queue is a double charge
--                              the published refund policy covers, so it is
--                              reported to the operator instead of silently
--                              becoming extra days
--   042_balances_cards_and_loans.sql  cards replaced with user-defined credit
--                              cards, balance_periods and card_periods (one
--                              opening figure per month, so a correction never
--                              rewrites the months before it), the four
--                              transactions columns above, and the Loan
--                              category — borrowing that is not income, whose
--                              source separates a cash advance from a refund
--   043_budget_deleted_at.sql  budgets.deleted_at — a deleted budget is
--                              marked, not removed, so month-to-month
--                              carry-forward cannot resurrect it. Replaces an
--                              amount-0 convention that held only because the
--                              one input writing amounts carries min="1"
--   044_subscription_renewals.sql  public.subscription_charges (one row per
--                              Razorpay invoice, unique on razorpay_invoice_id
--                              for webhook-retry idempotency), plus
--                              apply_subscription_charge() — a straight
--                              extension from GREATEST(now(), current expiry),
--                              deliberately NOT routed through
--                              apply_plan_purchase()'s upgrade/queue rules (035)
--                              — and clear_subscription_link(), which unlinks a
--                              cancelled mandate without touching
--                              subscription_expires_at. profiles already has
--                              razorpay_subscription_id (035), so no new
--                              profiles column or safety-net entry is needed
--                              here.
-- ==========================================

-- ==========================================
-- 20. FOREIGN-KEY COVERING INDEXES AND UNTRUSTED-ROLE REVOKES
--
-- Delivered to production by 046 and 047 (2026-09-10). Repeated here so a
-- database created from this file starts in the same state rather than
-- re-acquiring the problems those migrations fixed.
--
-- Every foreign key below had no covering index. The two on transactions are
-- the ones that bite in ordinary use: both are ON DELETE SET NULL and
-- self-referential, so without an index, deleting a single expense scans the
-- whole transactions table twice to clear references to it. The rest are the
-- account-deletion path — delete_user() drops the auth.users row and lets the
-- cascade run, and the BEFORE DELETE trigger from 036 UPDATEs feedback and
-- support_tickets filtered on user_id.
--
-- Partial where the column is almost always NULL. A partial index still serves
-- the `col = $1` probe that FK maintenance issues, at a fraction of the size.
-- ==========================================

-- Named _fk rather than the obvious idx_transactions_possible_duplicate_of,
-- which is already taken by a composite on (user_id, possible_duplicate_of).
-- CREATE INDEX IF NOT EXISTS against an existing name is a silent no-op, which
-- is exactly how this one was missed on the first pass.
CREATE INDEX IF NOT EXISTS idx_transactions_possible_dup_fk
  ON public.transactions(possible_duplicate_of)
  WHERE possible_duplicate_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_settled_by
  ON public.transactions(settled_by_transaction_id)
  WHERE settled_by_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signin_logs_user_id        ON public.signin_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_user_id ON public.insurance_policies(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id           ON public.feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_handled_by
  ON public.feedback(handled_by) WHERE handled_by IS NOT NULL;

-- support_tickets and payments are guarded because THIS FILE DOES NOT CREATE
-- THEM. schema.sql defines 13 tables; production has 19. The six it omits are
-- categories, payments, promo_codes, promo_redemptions, support_tickets and
-- subscription_charges — see TRANSFER_GUIDE.md §3 Option B.
--
-- Unguarded, these three statements abort the whole script on a fresh database,
-- which is a regression this block introduced. `CREATE INDEX IF NOT EXISTS`
-- does not help: the IF NOT EXISTS refers to the INDEX, not the table, so a
-- missing table is still a hard error.
--
-- The guard is a stopgap, not a fix. The real repair is adding the six missing
-- tables, without which a database built from this file breaks on first signup
-- anyway — seed_default_categories is defined here and inserts into
-- `categories`, which is one of the six.
DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
      ON public.support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_handled_by
      ON public.support_tickets(handled_by) WHERE handled_by IS NOT NULL;
  END IF;

  IF to_regclass('public.payments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_payments_refund_reviewed_by
      ON public.payments(refund_reviewed_by) WHERE refund_reviewed_by IS NOT NULL;
  END IF;
END $$;

-- Untrusted-role revokes.
--
-- Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE on every new
-- function to anon and authenticated DIRECTLY, so REVOKE ... FROM PUBLIC alone
-- does not remove it — see 037 for the full write-up. Both forms are issued.
--
-- seed_default_categories is SECURITY DEFINER and takes the target account as a
-- parameter rather than reading auth.uid(), so an anon caller could seed
-- categories into somebody else's new account. Its only legitimate caller is
-- the handle_new_profile_categories trigger, which runs as its owner and so
-- keeps EXECUTE regardless.
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid) TO service_role;

-- is_admin keeps EXECUTE for authenticated because the RLS policies above call
-- it and a policy expression is evaluated as the querying role. anon has no
-- policy that reaches it any more (047 scoped those to authenticated), so anon
-- loses it — it was an admin-membership oracle for any uuid the caller held.
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
