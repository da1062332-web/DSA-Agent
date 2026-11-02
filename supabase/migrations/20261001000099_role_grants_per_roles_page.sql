-- Migration: 20261001000099_role_grants_per_roles_page.sql
-- Modules: Access Control (MOD-ACL, TASK-412)
-- ADDITIVE role grants found by the per-role audit of the permission catalogue against the Notion Roles Architecture page: each
-- row below is a permission the page assigns to the role and that the seeded template role does not hold, so the screen or action the page
-- promises is missing. Nothing is removed from any role; trimming roles that hold more than the page names is the separate, reviewed
-- step in docs/PERMISSION_TRIM_DIFF.md. Customer-tenant template roles only: the platform realm keeps the grants it has.
-- Idempotent (ON CONFLICT DO NOTHING). The same rows are ROLE_GRANT_FIXES in seeds/demo/platform.ts, and a test compares the two.
--
-- Apply after migration 98 and before deploying the code from the same release.

SET search_path = app, extensions, public;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, g.permission_code
FROM app.role r
JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
JOIN (
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
) AS g(role_code, permission_code) ON g.role_code = r.code
ON CONFLICT (role_id, permission_code) DO NOTHING;
