-- PREPARED, NOT RUN. Removes the six platform operator permissions that sit on a customer-tenant role on hosted
-- (found 2026-10-17: demo-alpha, ROLE-TENANT-ADMIN, role_01M4SXZCV20465ZCBDMYGM2410; see docs/HOSTED_FINDINGS_20261017.md).
-- Migration 0050 removed exactly these from every customer role; something re-inserted them afterwards, so tools/sql/0050/verify.sql check 16 fails.
-- WRITES. One transaction. It deletes only rows that match all of: a customer tenant (not the platform tenant), one of the six operator
-- permissions. It aborts without deleting anything unless it finds exactly the six rows that were seen, so it cannot remove more than
-- was reviewed. Restore: remove-operator-grants-from-customer-roles.restore.sql.
BEGIN;
SET LOCAL search_path = app, public;

DO $$
DECLARE
  n integer;
  expected_role constant text := 'role_01M4SXZCV20465ZCBDMYGM2410';
BEGIN
  SELECT count(*) INTO n
    FROM app.role_permission rp
    JOIN app.tenant t ON t.id = rp.tenant_id
   WHERE t.tenant_type <> 'PLATFORM'
     AND rp.permission_code IN ('platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release');
  IF n <> 6 THEN
    RAISE EXCEPTION 'Aborted: expected exactly 6 operator grants on customer-tenant roles, found %. Review before deleting.', n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id
     WHERE t.tenant_type <> 'PLATFORM'
       AND rp.permission_code IN ('platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release')
       AND rp.role_id <> expected_role
  ) THEN
    RAISE EXCEPTION 'Aborted: some operator grants sit on a role other than the one that was reviewed.';
  END IF;
END
$$;

DELETE FROM app.role_permission rp
 USING app.tenant t
 WHERE t.id = rp.tenant_id
   AND t.tenant_type <> 'PLATFORM'
   AND rp.permission_code IN ('platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs', 'platform.support_access', 'platform.release');

COMMIT;
