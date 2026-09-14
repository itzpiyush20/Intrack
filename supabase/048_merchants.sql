-- 048_merchants.sql
--
-- A saved merchant list per user (spec: docs/superpowers/specs/
-- 2026-09-14-merchant-list-design.md).
--
-- transactions.merchant stays free text. merchant_id is an optional link to a
-- row here, set only when the user picks a merchant. Nothing in this file
-- links an existing transaction.
--
-- name_key is the normalised form used for uniqueness and matching. It must
-- stay identical to merchantKey() in src/utils/merchantKey.ts: collapse runs of
-- whitespace to one space, strip the leading/trailing space, lower-case.

BEGIN;

CREATE TABLE IF NOT EXISTS public.merchants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  name_key         TEXT GENERATED ALWAYS AS (
                     lower(regexp_replace(regexp_replace(name, '\s+', ' ', 'g'), '^ | $', '', 'g'))
                   ) STORED,
  default_category TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name_key),
  -- Target of the composite FK from merchant_aliases.
  UNIQUE (id, user_id)
);

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own merchants" ON public.merchants;
CREATE POLICY "Users can manage own merchants"
  ON public.merchants FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at_merchants ON public.merchants;
CREATE TRIGGER set_updated_at_merchants
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL,
  alias_key   TEXT NOT NULL CHECK (char_length(alias_key) BETWEEN 1 AND 120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias_key),
  -- Composite FK: an alias can only point at a merchant of the same user.
  FOREIGN KEY (merchant_id, user_id)
    REFERENCES public.merchants(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_merchant
  ON public.merchant_aliases(merchant_id);

ALTER TABLE public.merchant_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own merchant aliases" ON public.merchant_aliases;
CREATE POLICY "Users can manage own merchant aliases"
  ON public.merchant_aliases FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_id UUID
  REFERENCES public.merchants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_merchant
  ON public.transactions(user_id, merchant_id)
  WHERE merchant_id IS NOT NULL;

-- A plain FK cannot say "the merchant must be yours". RLS on merchants already
-- hides other users' ids from the client, but an id can still be guessed, so
-- the write is checked here too. SECURITY INVOKER on purpose: the lookup runs
-- under the caller's RLS, so it can only ever find the caller's own merchant.
CREATE OR REPLACE FUNCTION public.check_transaction_merchant_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.merchant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = NEW.merchant_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'merchant % does not belong to this user', NEW.merchant_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_transaction_merchant_owner ON public.transactions;
CREATE TRIGGER check_transaction_merchant_owner
  BEFORE INSERT OR UPDATE OF merchant_id, user_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.check_transaction_merchant_owner();

-- Trigger functions cannot be called directly, but Supabase's default
-- privileges still grant EXECUTE to anon/authenticated. Revoke by name.
REVOKE EXECUTE ON FUNCTION public.check_transaction_merchant_owner() FROM PUBLIC, anon, authenticated;

COMMIT;
