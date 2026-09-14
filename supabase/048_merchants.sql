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
-- whitespace to one space, strip the leading/trailing space, lower-case. The
-- whitespace class below is spelled out explicitly (not \s) so it does not
-- depend on the database's locale/ICU and equals JavaScript's \s, which
-- merchantKey() uses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.merchants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) <= 80),
  name_key         TEXT GENERATED ALWAYS AS (
                     lower(regexp_replace(regexp_replace(name, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), '^ | $', '', 'g'))
                   ) STORED,
  default_category TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (name_key <> ''),
  UNIQUE (user_id, name_key),
  -- Target of the composite FK from merchant_aliases and from transactions.
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
  -- alias_key must already be normalised, or it could never match.
  alias_key   TEXT NOT NULL CHECK (
                 char_length(alias_key) BETWEEN 1 AND 120
                 AND alias_key = lower(regexp_replace(regexp_replace(alias_key, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), '^ | $', '', 'g'))
               ),
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
  ADD COLUMN IF NOT EXISTS merchant_id UUID;

-- Composite FK: a transaction can only link a merchant of the same user, for
-- every role including service_role. Deleting a merchant clears only
-- merchant_id (PG15+ column list), never user_id. Added in a DO block so a
-- re-run does not create a second constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_merchant_id_owner_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_merchant_id_owner_fkey
      FOREIGN KEY (merchant_id, user_id)
      REFERENCES public.merchants(id, user_id)
      ON DELETE SET NULL (merchant_id);
  END IF;
END$$;

-- Covers the FK: deleting a merchant looks up transactions by merchant_id.
CREATE INDEX IF NOT EXISTS idx_transactions_merchant
  ON public.transactions(merchant_id, user_id)
  WHERE merchant_id IS NOT NULL;

COMMIT;
