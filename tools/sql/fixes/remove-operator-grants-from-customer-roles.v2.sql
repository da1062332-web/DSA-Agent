-- PREPARED, NOT RUN. Removes the six platform operator permissions from the two customer-tenant roles that hold them on hosted
-- (read-only query, 2026-10-19): demo-alpha ROLE-TENANT-ADMIN (role_01M4SXZCV20465ZCBDMYGM2410) and qloax-dsa ROLE-TENANT-ADMIN
-- (role_01M595WG8J9KP9MCH8Q31C69M3). See docs/PERMISSION_UI_VISIBILITY_AUDIT.md F-09.
-- Supersedes remove-operator-grants-from-customer-roles.sql, which expects exactly six rows on one role and now aborts (twelve exist).
-- Migration 0050 removed these grants from every customer role; they came back by hand (the untracked scratch provisioning script copies a
-- reviewed tenant's role grants into a new tenant, including these). tools/sql/0050/verify.sql check 16 fails until they are gone.
-- WRITES. One transaction. REPEATABLE: with nothing left to remove it does nothing. It aborts, deleting nothing, unless
--   * no role OTHER than the two reviewed ones holds any of the six on a customer tenant, and
--   * each reviewed role holds either none or all six.
-- Platform-tenant roles are never touched. Restore: remove-operator-grants-from-customer-roles.v2.restore.sql.
BEGIN;
SET LOCAL search_path = app, public;

DO $$
DECLARE
  reviewed constant text[] := ARRAY['role_01M4SXZCV20465ZCBDMYGM2410', 'role_01M595WG8J9KP9MCH8Q31C69M3'];
  codes constant text[] := ARRAY['platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release'];
  other integer;
  r text;
  n integer;
BEGIN
  SELECT count(*) INTO other
    FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id
   WHERE t.tenant_type <> 'PLATFORM' AND rp.permission_code = ANY (codes) AND rp.role_id <> ALL (reviewed);
  IF other > 0 THEN
    RAISE EXCEPTION 'Aborted: % operator grant(s) sit on a customer-tenant role that was not reviewed. Review before deleting.', other;
  END IF;

  FOREACH r IN ARRAY reviewed LOOP
    SELECT count(*) INTO n FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id
     WHERE t.tenant_type <> 'PLATFORM' AND rp.role_id = r AND rp.permission_code = ANY (codes);
    IF n NOT IN (0, 6) THEN
      RAISE EXCEPTION 'Aborted: reviewed role % holds % of the six operator grants (expected none or all six).', r, n;
    END IF;
  END LOOP;
END
$$;

DELETE FROM app.role_permission rp
 USING app.tenant t
 WHERE t.id = rp.tenant_id
   AND t.tenant_type <> 'PLATFORM'
   AND rp.role_id IN ('role_01M4SXZCV20465ZCBDMYGM2410', 'role_01M595WG8J9KP9MCH8Q31C69M3')
   AND rp.permission_code IN ('platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release');

COMMIT;
