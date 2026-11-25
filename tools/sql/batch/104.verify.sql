-- Generated from supabase/migrations/20261001000104_role_ui_cleanup_trim.sql (pair list copied, not retyped). The rehearsal test checks it.
-- Verify migration 0104 (role UI cleanup, task P0-07). Read-only. Expect no FAIL row.
SET search_path = app, extensions, public;

WITH trims AS (
  SELECT g.role_code, g.permission_code FROM (
  VALUES
    -- Branch manager: operations, finance back office and system setup
    ('ROLE-BRANCH-MGR', 'verification.perform'),
    ('ROLE-BRANCH-MGR', 'finance.view'),
    ('ROLE-BRANCH-MGR', 'invoice.view'),
    ('ROLE-BRANCH-MGR', 'reconciliation.view'),
    ('ROLE-BRANCH-MGR', 'ledger.view'),
    ('ROLE-BRANCH-MGR', 'role.read'),
    ('ROLE-BRANCH-MGR', 'integration.manage'),
    ('ROLE-BRANCH-MGR', 'integration.read'),
    ('ROLE-BRANCH-MGR', 'api.manage'),
    ('ROLE-BRANCH-MGR', 'api.read'),
    ('ROLE-BRANCH-MGR', 'webhook.manage'),
    ('ROLE-BRANCH-MGR', 'automation.execute'),
    ('ROLE-BRANCH-MGR', 'automation.read'),

    -- Tenant administrator: platform operator grants held by mistake (audit F-09)
    ('ROLE-TENANT-ADMIN', 'platform.console'),
    ('ROLE-TENANT-ADMIN', 'platform.flags'),
    ('ROLE-TENANT-ADMIN', 'platform.jobs'),
    ('ROLE-TENANT-ADMIN', 'platform.master_data'),
    ('ROLE-TENANT-ADMIN', 'platform.release'),
    ('ROLE-TENANT-ADMIN', 'platform.support_access'),
    -- Tenant administrator: business work belongs to the DSA owner and the operating roles
    ('ROLE-TENANT-ADMIN', 'lead.read'),
    ('ROLE-TENANT-ADMIN', 'lead.create'),
    ('ROLE-TENANT-ADMIN', 'lead.update'),
    ('ROLE-TENANT-ADMIN', 'lead.qualify'),
    ('ROLE-TENANT-ADMIN', 'lead.assign'),
    ('ROLE-TENANT-ADMIN', 'customer.read'),
    ('ROLE-TENANT-ADMIN', 'customer.create'),
    ('ROLE-TENANT-ADMIN', 'customer.update'),
    ('ROLE-TENANT-ADMIN', 'application.read'),
    ('ROLE-TENANT-ADMIN', 'application.create'),
    ('ROLE-TENANT-ADMIN', 'application.update'),
    ('ROLE-TENANT-ADMIN', 'application.review'),
    ('ROLE-TENANT-ADMIN', 'lender_case.read'),
    ('ROLE-TENANT-ADMIN', 'lender_case.submit'),
    ('ROLE-TENANT-ADMIN', 'lender_case.update_status'),
    ('ROLE-TENANT-ADMIN', 'sanction.read'),
    ('ROLE-TENANT-ADMIN', 'sanction.record'),
    ('ROLE-TENANT-ADMIN', 'disbursement.read'),
    ('ROLE-TENANT-ADMIN', 'disbursement.record'),
    ('ROLE-TENANT-ADMIN', 'disbursement.verify'),
    ('ROLE-TENANT-ADMIN', 'disbursement.exception_approve'),
    ('ROLE-TENANT-ADMIN', 'verification.read'),
    ('ROLE-TENANT-ADMIN', 'verification.perform'),
    ('ROLE-TENANT-ADMIN', 'eligibility.read'),
    ('ROLE-TENANT-ADMIN', 'eligibility.override'),
    ('ROLE-TENANT-ADMIN', 'share.create'),

    -- Loan operations: automation setup and partner management belong to the owner
    ('ROLE-LOAN-OPS', 'automation.execute'),
    ('ROLE-LOAN-OPS', 'automation.read'),
    ('ROLE-LOAN-OPS', 'connector.read'),
    ('ROLE-LOAN-OPS', 'connector.manage'),
    ('ROLE-LOAN-OPS', 'connector.attribution_change'),
    ('ROLE-LOAN-OPS', 'connector.dispute_resolve'),
    ('ROLE-LOAN-OPS', 'connector.bank_account_manage'),
    ('ROLE-LOAN-OPS', 'connector.agreement_manage'),
    ('ROLE-LOAN-OPS', 'connector.portal_user_manage'),

    -- Relationship manager and Team manager: the privacy administration screen (consent.record stays)
    ('ROLE-RM', 'privacy.read'),
    ('ROLE-TEAM-MGR', 'privacy.read'),

    -- Sales executive (Telecaller): works leads and hands over to the RM
    ('ROLE-SALES-EXEC', 'customer.read'),
    ('ROLE-SALES-EXEC', 'privacy.read'),

    -- No team to manage and no field work: the workforce screen
    ('ROLE-COMPLIANCE', 'attendance.read'),
    ('ROLE-FINANCE-EXEC', 'attendance.read'),
    ('ROLE-COMMISSION-APPROVER', 'attendance.read')
  ) AS g(role_code, permission_code)
),
still_granted AS (
  SELECT r.tenant_id, r.code, rp.permission_code
    FROM app.role_permission rp
    JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
    JOIN trims g ON g.role_code = r.code AND g.permission_code = rp.permission_code
)
SELECT 'no customer-tenant template role still holds a trimmed grant' AS check,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce(string_agg(DISTINCT code || ' ' || permission_code, ', '), 'none') AS detail
  FROM still_granted
UNION ALL
SELECT 'the platform realm keeps its grants (not touched by 0104)',
       'INFO',
       count(*)::text || ' platform.* grant(s) in the platform realm'
  FROM app.role_permission rp
  JOIN app.tenant t ON t.id = rp.tenant_id AND t.tenant_type = 'PLATFORM'
 WHERE rp.permission_code LIKE 'platform.%'
UNION ALL
SELECT 'trim pairs listed', 'INFO', count(*)::text FROM trims;
