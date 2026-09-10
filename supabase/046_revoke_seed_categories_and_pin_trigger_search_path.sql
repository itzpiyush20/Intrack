-- 046_revoke_seed_categories_and_pin_trigger_search_path.sql
--
-- Two loose ends found in a pre-launch sweep of the live database
-- (Supabase security advisors + a direct read of pg_proc, 2026-09-10).
--
-- ------------------------------------------------------------------
-- 1. seed_default_categories(uuid) was callable by anon
-- ------------------------------------------------------------------
--
-- Same mechanism 037 documented at length: Supabase ships
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated`,
-- so every function created without an explicit revoke is reachable through
-- PostgREST by the anon key that ships in the client bundle.
--
-- Confirmed against production on 2026-09-10:
--
--   has_function_privilege('anon', 'public.seed_default_categories(uuid)', 'EXECUTE') -> true
--
-- The function is SECURITY DEFINER, so RLS does not apply to it, and it takes
-- the target account as a PARAMETER rather than reading auth.uid(). An
-- unauthenticated caller could therefore write 21 category rows into any
-- account whose uuid they held:
--
--   POST /rest/v1/rpc/seed_default_categories  {"uid": "<someone else's id>"}
--
-- Impact is smaller than the 037 hole — the function reads nothing back, and
-- its first statement returns early if the target already has any categories,
-- so an established account is untouched. But it is still an unauthenticated
-- write on another user's behalf, and a freshly created account could have its
-- category set planted by a third party. There is no reason for any client to
-- call it: the only legitimate caller is the SECURITY DEFINER trigger
-- handle_new_profile_categories (008), which runs as its owner and so keeps
-- EXECUTE regardless of what the untrusted roles hold.
--
-- Verified before writing this: no caller in src/ or api/ invokes it by RPC.
--
-- ------------------------------------------------------------------
-- 2. update_updated_at() had a mutable search_path
-- ------------------------------------------------------------------
--
-- 033 pinned `SET search_path` on every SECURITY DEFINER function. This one was
-- missed because it is a plain trigger function rather than a SECURITY DEFINER
-- one, so it did not match that sweep's criteria — but Supabase's linter still
-- flags it, and it fires BEFORE UPDATE on six tables including profiles and
-- transactions. Pinning it costs nothing and removes the warning.
--
-- Note this migration does NOT touch is_admin(uuid), which is also anon-
-- executable. Revoking that one has to wait until the RLS policies that call it
-- are scoped to `authenticated`, because a policy expression is evaluated as
-- the querying role — revoking first would turn an anon read of payments into a
-- "permission denied for function is_admin" error instead of an empty result.
-- 047 does the scoping and the revoke together, in that order.

BEGIN;

-- REVOKE FROM PUBLIC is deliberately NOT the whole story here; the grants that
-- actually exist are held directly by the named roles. Both forms are issued so
-- the function is left clean however it was granted.
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.seed_default_categories(uuid) FROM authenticated;

-- service_role keeps EXECUTE so a support/backfill path can still seed an
-- account deliberately (008 line 87 does exactly this for existing profiles).
GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid) TO service_role;

ALTER FUNCTION public.update_updated_at() SET search_path = public;

COMMIT;

-- ------------------------------------------------------------------
-- Verification — run after applying, expect anon=false, authenticated=false
-- ------------------------------------------------------------------
--
--   SELECT has_function_privilege('anon',          'public.seed_default_categories(uuid)', 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', 'public.seed_default_categories(uuid)', 'EXECUTE') AS auth,
--          has_function_privilege('service_role',  'public.seed_default_categories(uuid)', 'EXECUTE') AS svc;
--
--   SELECT proconfig FROM pg_proc
--    WHERE oid = 'public.update_updated_at()'::regprocedure;   -- {search_path=public}
--
-- And prove the trigger path still works, since that is what the revoke could
-- plausibly have broken — a new signup must still get its 21 categories:
--
--   SELECT count(*) FROM public.categories WHERE user_id = '<a newly created user>';
