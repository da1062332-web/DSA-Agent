-- Roll back migration 0096: re-create the two test-login lookups as migration 0086 defined them.
-- WARNING: this re-creates the cross-tenant lookups. Run only with owner approval, and not while any build can serve the test-login route.
-- The definitions below are copied from supabase/migrations/20261001000086_test_auth_bypass.sql. The EXECUTE grant follows 0086 (dsa_app only).
BEGIN;
SET search_path = app, extensions, public;

CREATE OR REPLACE FUNCTION app.lookup_test_user(p_email text)
RETURNS TABLE (
  id text,
  tenant_id text,
  idp_subject text,
  email text,
  display_name text,
  status text,
  tenant_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.idp_subject, u.email, u.display_name, u.status, t.status AS tenant_status
    FROM app.app_user u
    JOIN app.tenant t ON t.id = u.tenant_id
   WHERE (lower(u.email::text) = lower(p_email) OR u.id = p_email)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app.lookup_test_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_test_user(text) TO dsa_app;

CREATE OR REPLACE FUNCTION app.list_test_users()
RETURNS TABLE (
  id text,
  email text,
  display_name text,
  tenant_id text,
  role_code text,
  role_name text,
  branch_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT DISTINCT ON (u.id)
         u.id, u.email, u.display_name, u.tenant_id,
         r.code AS role_code, r.name AS role_name, b.name AS branch_name
    FROM app.app_user u
    LEFT JOIN app.user_role_assignment ura ON ura.user_id = u.id AND ura.effective_range @> now()
    LEFT JOIN app.role r ON r.id = ura.role_id
    LEFT JOIN app.branch b ON b.id = u.primary_branch_id
   WHERE u.status = 'ACTIVE' AND u.email IS NOT NULL
   ORDER BY u.id, u.display_name ASC;
$$;
REVOKE ALL ON FUNCTION app.list_test_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_test_users() TO dsa_app;
COMMIT;
