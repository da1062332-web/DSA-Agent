-- Migration 0091: security hardening after the hosted review of 2026-10-26 (docs/HOSTED_SUPABASE_REMEDIATION_PLAN.md).
-- 1. public.label_set ran as its owner, which bypasses row-level security, and anonymous and signed-in users could write to it.
--    It now runs as the caller, and anonymous and signed-in users get no write access to any public view.
-- 2. Anonymous users get no read access to the public schema. The web app reads only storage (signed URLs) and auth, never a view.
-- 3. The test-login lookups are no longer callable by the API role (docs/HOSTED_TEST_AUTH_CONTAINMENT_PLAN.md, section 6).
-- 4. app.authenticate_user returned password hashes across tenants. Nothing in the repository calls it.
-- Every statement is safe to run twice, and each DO block skips an object that the database does not have.
SET search_path = app, extensions, public;

-- 1. The view runs as its caller, so row-level security applies to it.
DO $$
BEGIN
  IF to_regclass('public.label_set') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.label_set SET (security_invoker = true)';
  END IF;
END $$;

-- 2. Anonymous and signed-in users: no writes to any public view. Anonymous users: no reads.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- 2b. No function for anonymous or signed-in users. The app schema already denies them USAGE, so this is a second lock.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon, authenticated;

-- 3. Test login is contained: the API role loses the two cross-tenant lookups from migration 0086.
DO $$
BEGIN
  IF to_regprocedure('app.lookup_test_user(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app.lookup_test_user(text) FROM dsa_app';
  END IF;
  IF to_regprocedure('app.list_test_users()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app.list_test_users() FROM dsa_app';
  END IF;
END $$;

-- 4. The legacy login function returned password hashes for any tenant. It is dropped; its definition is kept in the review plan.
DROP FUNCTION IF EXISTS app.authenticate_user(text);
