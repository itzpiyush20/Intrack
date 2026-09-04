-- ============================================================
-- 042 — Balances, credit cards and loans (Phase 1 of
--       plans/accounts-and-balances.md)
--
-- Adds the schema for: one combined "cash in hand and bank balances" figure
-- per user per month, a per-card outstanding for cards the user defines
-- themselves, and a Loan category whose source says where borrowed money came
-- from.
--
-- NO APPLICATION CODE READS ANY OF THIS YET. This migration is applied and
-- verified first, per the deploy-order rule in CLAUDE.md, and the code that
-- uses it merges afterwards.
-- ============================================================

-- ── 1. cards — replaced, not altered ─────────────────────────
--
-- The existing public.cards was created by schema.sql and never by a numbered
-- migration. It IS present in production (verified 2026-09-05: the REST
-- endpoint returns 200) but no UI has ever written to it, so it holds no rows
-- to lose. emailScanner.ts queries it for a last4 → issuer map and gets an
-- empty result on every scan.
--
-- It is dropped rather than altered because the new shape differs in what it
-- is FOR: the old table described any card seen in an email; this one holds
-- credit cards the user deliberately set up and wants a balance for.
--
-- Guard: refuse to drop if anyone ever did write rows, so this cannot silently
-- destroy data in an environment that differs from production.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cards')
     AND EXISTS (SELECT 1 FROM public.cards LIMIT 1)
  THEN
    RAISE EXCEPTION
      'public.cards is not empty — 042 expected no rows. Inspect before rerunning.';
  END IF;
END $$;

DROP TABLE IF EXISTS public.cards CASCADE;

CREATE TABLE public.cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  issuer      TEXT,
  last4       TEXT,
  brand       TEXT CHECK (brand IN ('Visa','Mastercard','RuPay','American Express','Diners')),
  -- Manual only. Nothing in the app may archive a card on the user's behalf.
  is_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cards_user ON public.cards(user_id);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own cards"
  ON public.cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at_cards ON public.cards;
CREATE TRIGGER set_updated_at_cards
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 2. balance_periods — one money figure per user per month ──
--
-- One row per user per month, not one figure ever. That is what makes an
-- opening balance editable without rewriting history: a correction lands on
-- the month it was made and months before it keep the figures they had.
-- `month` is always the first day of the month.
CREATE TABLE IF NOT EXISTS public.balance_periods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month          DATE NOT NULL CHECK (date_trunc('month', month) = month),
  -- Cash in hand AND bank balances, combined. The owner deliberately declined
  -- per-account tracking, so this is one number covering all of it.
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- true when the user typed it, false when the app carried it forward from
  -- the previous month's close. Drives whether a drift warning makes sense.
  is_user_set    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_balance_periods_user_month
  ON public.balance_periods(user_id, month DESC);

ALTER TABLE public.balance_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own balance periods"
  ON public.balance_periods FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at_balance_periods ON public.balance_periods;
CREATE TRIGGER set_updated_at_balance_periods
  BEFORE UPDATE ON public.balance_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 3. card_periods — one outstanding per card per month ──────
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

CREATE POLICY "Users can manage own card periods"
  ON public.card_periods FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at_card_periods ON public.card_periods;
CREATE TRIGGER set_updated_at_card_periods
  BEFORE UPDATE ON public.card_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 4. transactions — four new nullable columns ───────────────
--
-- card_id          which card this sits on. NULL means it came out of the
--                  combined money figure instead.
-- settles_card_id  only on a credit-card bill payment. That single row lowers
--                  available money by its amount AND lowers THAT card's
--                  outstanding — two effects, which is why a second column is
--                  needed rather than reusing card_id.
-- loan_source      where borrowed money came from. Non-null marks the row as
--                  borrowing, which is what tells a cash advance (outstanding
--                  UP) apart from a refund (outstanding DOWN) — both are money
--                  arriving on a card and are otherwise identical.
-- loan_source_note free text naming the lender, only meaningful for 'other'.
--
-- All nullable: the whole feature is optional and existing rows stay valid.
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
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_card
  ON public.transactions(card_id) WHERE card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_settles_card
  ON public.transactions(settles_card_id) WHERE settles_card_id IS NOT NULL;

-- ── 5. The Loan category ──────────────────────────────────────
--
-- Borrowing is money arriving that is NOT income, against a liability that is
-- NOT an expense. It therefore carries no needs/wants/savings/income tag, so
-- it never inflates the income total, the savings rate or the 50/30/20 split.
--
-- The 'loan' tag is how the UI recognises it after a rename — categories are
-- identified by tag, never by name, exactly as credit_card_bill already is.
--
-- Borrowing only. Money the user LENDS OUT stays with the existing returnables
-- feature (transactions.is_returnable + counterparty, surfaced by the
-- Receivables card).
INSERT INTO public.categories
  (user_id, name, emoji, color, type, budget_eligible, is_default, is_permanent, sort_order, analytics_tags)
SELECT p.id, 'Loan', '🤝', '#0d9488', 'income', false, true, false, 21, ARRAY['loan']
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE c.user_id = p.id AND c.analytics_tags @> ARRAY['loan']
);

-- New signups get it too. Same list as 011 with Loan appended; the early-return
-- guard is unchanged.
CREATE OR REPLACE FUNCTION public.seed_default_categories(uid UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories WHERE user_id = uid) THEN
    RETURN;
  END IF;
  INSERT INTO categories (user_id, name, emoji, color, type, budget_eligible, is_default, is_permanent, sort_order, analytics_tags) VALUES
    (uid, 'Food & Dining',            '🍔', '#f97316', 'expense', true,  true, false, 1,  ARRAY['wants']),
    (uid, 'Groceries',                '🛒', '#84cc16', 'expense', true,  true, false, 2,  ARRAY['needs']),
    (uid, 'Transport',                '🚗', '#3b82f6', 'expense', true,  true, false, 3,  ARRAY['needs']),
    (uid, 'Shopping',                 '🛍️', '#ec4899', 'expense', true,  true, false, 4,  ARRAY['wants']),
    (uid, 'Utilities & Bills',        '💡', '#eab308', 'expense', true,  true, false, 5,  ARRAY['needs']),
    (uid, 'Rent',                     '🏠', '#8b5cf6', 'expense', true,  true, false, 6,  ARRAY['needs']),
    (uid, 'Health',                   '🏥', '#ef4444', 'expense', true,  true, false, 7,  ARRAY['needs']),
    (uid, 'Entertainment',            '🎬', '#f43f5e', 'expense', true,  true, false, 8,  ARRAY['wants']),
    (uid, 'Education',                '📚', '#06b6d4', 'expense', true,  true, false, 9,  ARRAY['needs']),
    (uid, 'Travel',                   '✈️', '#14b8a6', 'expense', true,  true, false, 10, ARRAY['wants']),
    (uid, 'Subscriptions',            '🔄', '#a855f7', 'expense', true,  true, false, 11, ARRAY['wants','subscription']),
    (uid, 'Insurance',                '🛡️', '#0891b2', 'expense', false, true, false, 12, ARRAY['needs']),
    (uid, 'Credit Card Bill Payment', '💳', '#475569', 'expense', false, true, false, 13, ARRAY['credit_card_bill']),
    (uid, 'Transfers',                '🔁', '#6b7280', 'expense', false, true, false, 14, ARRAY['wants']),
    (uid, 'Salary',                   '💰', '#10b981', 'income',  false, true, false, 15, ARRAY['income']),
    (uid, 'Freelance',                '💻', '#0ea5e9', 'income',  false, true, false, 16, ARRAY['income']),
    (uid, 'Investments',              '📈', '#22c55e', 'expense', false, true, false, 17, ARRAY['savings']),
    (uid, 'Refund',                   '↩️', '#64748b', 'income',  false, true, false, 18, ARRAY['income']),
    (uid, 'Cashback',                 '🎁', '#f59e0b', 'income',  false, true, false, 19, ARRAY['income']),
    (uid, 'Other',                    '📌', '#94a3b8', 'expense', true,  true, true,  20, ARRAY['wants']),
    (uid, 'Loan',                     '🤝', '#0d9488', 'income',  false, true, false, 21, ARRAY['loan']);
END $$;

-- ── 6. Verification — run these after applying ────────────────
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('cards','balance_periods','card_periods');
--   -- expect 3 rows
--
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public'
--      AND tablename IN ('cards','balance_periods','card_periods');
--   -- expect rowsecurity = true on all three
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='transactions'
--      AND column_name IN ('card_id','settles_card_id','loan_source','loan_source_note');
--   -- expect 4 rows
--
--   SELECT count(*) FROM public.categories WHERE analytics_tags @> ARRAY['loan'];
--   -- expect one row per profile
