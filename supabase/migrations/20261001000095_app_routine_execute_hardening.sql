-- Migration 0095: remove PUBLIC's EXECUTE on the routines (functions and procedures) of schema app.
-- PostgreSQL grants EXECUTE to PUBLIC on every new routine unless the migration revokes it, and this schema never did. On 2026-10-29,
-- 24 of its 45 routines were executable by PUBLIC, which reaches anon, authenticated, service_role and the other roles.
-- The API role keeps every routine it could run before: dsa_app (and dsa_api, which is a member of dsa_app) gets an explicit EXECUTE on each
-- routine first. Trigger functions run as the role that writes the table, so dsa_app needs the grant for them too.
-- Checked on 2026-10-29: nothing outside schema app calls an app routine (no policy, trigger, routine or view).
-- The test-login functions of migration 0086 are not handled here: their PUBLIC grant was revoked on 2026-10-29, and migration 0096 drops them.
SET search_path = app, extensions, public;

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN
    RAISE EXCEPTION 'role dsa_app not found; migration 0095 needs it';
  END IF;

  FOR r IN
    SELECT p.prokind, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON %s %I.%I(%s) TO dsa_app',
                   CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.nspname, r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON %s %I.%I(%s) FROM PUBLIC',
                   CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.nspname, r.proname, r.args);
  END LOOP;
END $$;
