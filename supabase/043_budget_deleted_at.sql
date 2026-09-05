-- ============================================================
-- 043 — budgets.deleted_at: say what a deleted budget is
--
-- Budgets now carry forward from the most recent month that has them, which
-- created an edge: deleting the last budget of a month empties it, and the
-- next read restores exactly what the user just removed.
--
-- The fix shipped in 2d2ba3d marks a deliberate deletion by writing
-- `amount = 0` instead of removing the row. That works, but only because the
-- single input that writes an amount carries `min="1"` — a convention held up
-- by a form attribute, not by the database. Any future code path writing a
-- zero amount for an innocent reason would silently delete a budget.
--
-- This column says what is actually meant. No behaviour changes on its own;
-- the code that reads it merges after this is applied and verified.
-- ============================================================

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Existing tombstones, written before this column existed, become real ones.
--
-- Their original amount is not recoverable — it was overwritten with 0 at the
-- moment of deletion — so these rows keep the 0 and gain a timestamp. That is
-- lossless in practice: a deleted budget's amount is never read.
--
-- Safe to re-run: the WHERE clause excludes rows already marked.
UPDATE public.budgets
   SET deleted_at = now()
 WHERE amount = 0
   AND deleted_at IS NULL;

-- Carry-forward and every budget total filter on this, so it is worth an
-- index. Partial, because the overwhelming majority of rows are live ones.
CREATE INDEX IF NOT EXISTS idx_budgets_user_month_live
  ON public.budgets(user_id, month)
  WHERE deleted_at IS NULL;

-- ── Verification — run after applying ────────────────────────
--
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'budgets' AND column_name = 'deleted_at';
--   -- expect one row, timestamp with time zone
--
--   SELECT count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstones,
--          count(*) FILTER (WHERE amount = 0 AND deleted_at IS NULL) AS unmarked_zeros
--     FROM public.budgets;
--   -- unmarked_zeros must be 0; tombstones is however many budgets have been
--   -- deliberately deleted since carry-forward shipped, and may well be 0 too
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'budgets' AND indexname = 'idx_budgets_user_month_live';
--   -- expect one row
