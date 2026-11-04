-- Generated from supabase/migrations/202610010099_* (pair and code lists copied, not retyped). The rehearsal test checks them.
-- Verify migration 0099 (per-role grants; origin's file, owner Dev 1, MOD-ACL TASK-412). Read-only. Expect no FAIL row.
-- 0099 needs the catalogue rows that 0098 adds: a FAIL on the first row means 0098 is missing. The grant list below is a copy of the
-- migration's; the rehearsal test checks the copy against the file.
SET search_path = app, extensions, public;

WITH grants AS (
  SELECT g.role_code, g.permission_code FROM (
  VALUES
    -- Tenant Administrator: integration and API administration
    ('ROLE-TENANT-ADMIN', 'api.manage'),
    ('ROLE-TENANT-ADMIN', 'api.read'),
    ('ROLE-TENANT-ADMIN', 'integration.manage'),
    ('ROLE-TENANT-ADMIN', 'integration.read'),
    ('ROLE-TENANT-ADMIN', 'webhook.manage'),

    -- DSA Owner: executive visibility of the staff directory
    ('ROLE-ORG-OWNER', 'user.read'),

    -- Branch Manager: branch performance, targets and the application work the page names. report.read and target.manage
    -- are what the split-off performance.read and target.read were backfilled from in migration 98, and this role held neither then.
    ('ROLE-BRANCH-MGR', 'report.read'),
    ('ROLE-BRANCH-MGR', 'target.manage'),
    ('ROLE-BRANCH-MGR', 'application.update'),
    ('ROLE-BRANCH-MGR', 'performance.read'),
    ('ROLE-BRANCH-MGR', 'target.read'),

    -- Relationship Manager: uploads documents and shares them with the customer
    ('ROLE-RM', 'document.upload'),
    ('ROLE-RM', 'share.create'),

    -- Sales Executive: edits the interactions they log
    ('ROLE-SALES-EXEC', 'activity.update'),

    -- Compliance: the report catalogue, without team performance
    ('ROLE-COMPLIANCE', 'report.read'),

    -- Finance Executive: raises payout requests and verifies disbursements, SOD-04
    ('ROLE-FINANCE-EXEC', 'payout.request'),
    ('ROLE-FINANCE-EXEC', 'disbursement.verify'),
    ('ROLE-FINANCE-EXEC', 'disbursement.read')
  ) AS g(role_code, permission_code)
),
catalogue_missing AS (
  SELECT DISTINCT g.permission_code AS code
    FROM grants g
   WHERE NOT EXISTS (SELECT 1 FROM app.permission p WHERE p.code = g.permission_code)
),
missing_grants AS (
  SELECT r.id AS role_id, g.permission_code
    FROM grants g
    JOIN app.role r ON r.code = g.role_code
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
   WHERE NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.permission_code = g.permission_code)
)
SELECT 'the permissions this migration grants are in the catalogue (a FAIL means 0098 is missing)' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM catalogue_missing) THEN 'PASS' ELSE 'FAIL' END AS result,
       'missing: ' || coalesce((SELECT string_agg(code, ', ') FROM catalogue_missing), 'none') AS detail
UNION ALL SELECT 'every listed template role that exists holds its grant (expect 0 missing)',
       CASE WHEN (SELECT count(*) FROM missing_grants) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'missing grants: ' || (SELECT count(*) FROM missing_grants)
UNION ALL SELECT 'row-level security is enabled and forced on app.role_permission',
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'role_permission' AND c.relrowsecurity AND c.relforcerowsecurity)
            THEN 'PASS' ELSE 'FAIL' END,
       ''
UNION ALL SELECT 'customer template roles that exist (informational)',
       'INFO',
       'roles: ' || (SELECT count(*) FROM app.role r JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
                      WHERE r.code IN (SELECT g.role_code FROM grants g));
