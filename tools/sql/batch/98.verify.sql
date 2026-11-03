-- Generated from supabase/migrations/202610010098_* (pair and code lists copied, not retyped). The rehearsal test checks them.
-- Verify migration 0098 (sub-permission expand; origin's file, owner Dev 1, MOD-ACL SUB-ACL.01, TASK-412). Read-only: it reads the catalogue,
-- the grants, the row-level security settings and the privileges. Expect no FAIL row.
-- Run after 0098 and after any role edit. A FAIL row gives the count (and the codes). Re-running 0098 is idempotent and repairs missing
-- backfill grants. The pair list below is a copy of the migration's; the rehearsal test checks the copy against the file.
SET search_path = app, extensions, public;

WITH pairs AS (
  SELECT m.parent, m.child FROM (
  VALUES
    ('application.read', 'lender_case.read'),
    ('lender_case.submit', 'lender_case.read'),
    ('lender_case.update_status', 'lender_case.read'),

    ('sanction.record', 'sanction.read'),
    ('disbursement.record', 'sanction.read'),
    ('disbursement.verify', 'sanction.read'),
    ('disbursement.exception_approve', 'sanction.read'),
    ('sanction.record', 'disbursement.read'),
    ('disbursement.record', 'disbursement.read'),
    ('disbursement.verify', 'disbursement.read'),
    ('disbursement.exception_approve', 'disbursement.read'),

    ('application.read', 'eligibility.read'),

    ('config.manage', 'org.manage'),
    ('config.manage', 'team.manage'),
    ('user.manage', 'team.manage'),
    ('config.manage', 'settings.manage'),
    ('config.manage', 'message_template.manage'),

    ('user.manage', 'user.read'),
    ('user.manage', 'user.invite'),
    ('user.manage', 'user.offboard'),
    ('role.manage', 'role.read'),
    ('user.manage', 'role.read'),
    ('user.manage', 'access_review.manage'),

    ('lead.read', 'activity.read'),
    ('customer.read', 'activity.read'),
    ('application.read', 'activity.read'),
    ('activity.create', 'activity.read'),
    ('complaint.create', 'complaint.read'),
    ('complaint.manage', 'complaint.read'),
    ('attendance.manage', 'attendance.read'),

    ('finance.view', 'commission.view'),
    ('commission.plan.edit', 'commission.view'),
    ('commission.plan.approve', 'commission.view'),
    ('finance.view', 'payout.view'),
    ('payout.request', 'payout.view'),
    ('payout.approve', 'payout.view'),
    ('payout.record_payment', 'payout.view'),
    ('finance.view', 'ledger.view'),
    ('finance.view', 'reconciliation.view'),
    ('finance.reconcile', 'reconciliation.view'),
    ('finance.view', 'invoice.view'),
    ('invoice.manage', 'invoice.view'),
    ('payout.record_payment', 'payout.disburse'),

    ('connector.manage', 'connector.bank_account_manage'),
    ('connector.manage', 'connector.agreement_manage'),
    ('connector.manage', 'connector.portal_user_manage'),

    ('report.read', 'performance.read'),
    ('report.read', 'target.read'),
    ('target.manage', 'target.read'),

    ('audit.read', 'audit.seal'),
    ('security.incident', 'security.read'),
    ('audit.read', 'privacy.read'),
    ('customer.read', 'privacy.read'),
    ('privacy.manage', 'privacy.read'),

    ('import.run', 'import.read'),
    ('config.manage', 'import.read')
  ) AS m(parent, child)
),
catalogue_missing AS (
  SELECT unnest(ARRAY['lender_case.read', 'sanction.read', 'disbursement.read', 'eligibility.read', 'org.manage', 'team.manage', 'settings.manage', 'message_template.manage', 'user.read', 'user.invite', 'user.offboard', 'role.read', 'access_review.manage', 'activity.read', 'complaint.read', 'attendance.read', 'commission.view', 'payout.view', 'ledger.view', 'reconciliation.view', 'invoice.view', 'payout.disburse', 'ledger.journal_post', 'connector.bank_account_manage', 'connector.agreement_manage', 'connector.portal_user_manage', 'performance.read', 'target.read', 'audit.seal', 'security.read', 'privacy.read', 'import.read']) AS code
  EXCEPT
  SELECT p.code FROM app.permission p
),
missing_backfill AS (
  SELECT DISTINCT rp.tenant_id, rp.role_id, p.child
    FROM pairs p
    JOIN app.role_permission rp ON rp.permission_code = p.parent
    JOIN app.tenant t ON t.id = rp.tenant_id AND t.tenant_type <> 'PLATFORM'
   WHERE NOT EXISTS (SELECT 1 FROM app.role_permission c WHERE c.role_id = rp.role_id AND c.permission_code = p.child)
),
missing_open_screens AS (
  SELECT r.id AS role_id, g.code
    FROM app.role r
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
    CROSS JOIN (VALUES ('lender.read'), ('product.read'), ('attendance.read')) AS g(code)
   WHERE r.code NOT LIKE 'ROLE-CONNECTOR%'
     AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.permission_code = g.code)
)
SELECT 'the 32 sub-permissions are in the catalogue' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM catalogue_missing) THEN 'PASS' ELSE 'FAIL' END AS result,
       'missing: ' || coalesce((SELECT string_agg(code, ', ') FROM catalogue_missing), 'none') AS detail
UNION ALL SELECT 'every role that holds a parent code also holds the sub-permission backfilled from it (expect 0 missing)',
       CASE WHEN (SELECT count(*) FROM missing_backfill) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'missing grants: ' || (SELECT count(*) FROM missing_backfill)
UNION ALL SELECT 'lender.read, product.read and attendance.read are held by every customer role except connector roles (expect 0 missing)',
       CASE WHEN (SELECT count(*) FROM missing_open_screens) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'missing grants: ' || (SELECT count(*) FROM missing_open_screens)
UNION ALL SELECT 'the catalogue cannot be written by anon or authenticated (expect 0 privileges)',
       CASE WHEN (SELECT count(*) FROM pg_roles r
                   WHERE r.rolname IN ('anon', 'authenticated')
                     AND (has_table_privilege(r.rolname, 'app.permission', 'INSERT')
                          OR has_table_privilege(r.rolname, 'app.permission', 'UPDATE')
                          OR has_table_privilege(r.rolname, 'app.permission', 'DELETE'))) = 0 THEN 'PASS' ELSE 'FAIL' END,
       ''
UNION ALL SELECT 'row-level security is enabled and forced on app.role_permission',
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'role_permission' AND c.relrowsecurity AND c.relforcerowsecurity)
            THEN 'PASS' ELSE 'FAIL' END,
       ''
UNION ALL SELECT 'a policy exists on app.role_permission',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'role_permission') THEN 'PASS' ELSE 'FAIL' END,
       ''
UNION ALL SELECT 'customer roles checked (informational)',
       'INFO',
       'roles: ' || (SELECT count(*) FROM app.role r JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM');
