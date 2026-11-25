-- Migration: 20261001000104_role_ui_cleanup_trim.sql
-- Module: Access Control (MOD-ACL). Owner: Dev 1 (platform lane). Task P0-07 of the multi-lender plan, asked for by the project owner on
-- 2026-11-25: each role sees only the screens its job needs, and the API refuses what the UI hides.
-- Removes grants from the customer-tenant template roles, so the screens they open disappear from the sidebar, Home and search, and the
-- API answers 403 for them. The list was computed from apps/web/src/shell/access.ts run on each role's grants after M-098 and M-099.
--   Branch manager: verification workbench, invoices, reconciliation, ledger, integrations, API management, automation. Commission and
--     payouts stay (commission.view and payout.view are kept; only the coarse finance.view that also opened the rest goes).
--   Tenant administrator: the business screens it does not run (leads, customers, applications, lender cases, sanction and
--     disbursement, verification, eligibility, document sharing) and the six platform.* grants (audit F-09).
--   Loan operations: automation rules and connectors.
--   Relationship manager, Team manager: privacy and consent (consent is still recorded on the lead and customer with consent.record).
--   Sales executive (Telecaller): customers, privacy and consent.
--   Compliance, Finance executive, Commission approver: workforce.
-- Only role_permission rows are deleted. Roles, assignments and audit rows are untouched. A role that does not hold a listed code is
-- unchanged. The same pairs are ROLE_GRANT_TRIMS in seeds/demo/platform.ts, and TEST-PERM-09 compares the two.
-- Apply after 0098 and 0099 (their backfill and grants would otherwise put some of these codes back). Take the runbook snapshot
-- dsa_backup.role_permission_pre_m104 first: tools/sql/batch/104.rollback.sql restores from it. Verify: tools/sql/batch/104.verify.sql.
-- Idempotent. Runs as the migration owner, so the application-login guards of M-059 do not apply.

SET search_path = app, extensions, public;

DELETE FROM app.role_permission rp
 USING app.role r, app.tenant t
 WHERE rp.tenant_id = r.tenant_id
   AND rp.role_id = r.id
   AND t.id = r.tenant_id
   AND t.tenant_type <> 'PLATFORM'
   AND (r.code, rp.permission_code) IN (
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
   );
