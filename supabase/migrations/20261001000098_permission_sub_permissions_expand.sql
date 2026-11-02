-- Migration: 20261001000098_permission_sub_permissions_expand.sql
-- Modules: Access Control (MOD-ACL SUB-ACL.01, TASK-412)
-- EXPAND step of the sub-permission split. Adds 32 permissions to the global catalogue and gives each one to every role that already
-- holds a coarse code that used to guard the same feature, so nobody gains or loses access when it ships. The API and the web accept
-- the new code OR its legacy parent meanwhile (LEGACY_PARENTS in packages/contracts/src/permission-groups.ts). Trimming roles to the
-- Notion role matrix is a separate, reviewed migration (docs/PERMISSION_TRIM_DIFF.md), and is not part of this file.
-- Additive and idempotent (ON CONFLICT DO NOTHING). Customer-tenant roles only: the platform realm keeps the grants it has.

SET search_path = app, extensions, public;

-- 1. The catalogue.
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('lender_case.read', 'View lender cases, their status history and queries', 'M-098'),
  ('sanction.read', 'View sanctions recorded against lender cases', 'M-098'),
  ('disbursement.read', 'View disbursement tranches and their verification status', 'M-098'),
  ('eligibility.read', 'View eligibility assessments and results for applications', 'M-098'),
  ('org.manage', 'Manage the organisation profile and branches', 'M-098'),
  ('team.manage', 'Manage teams, team membership and work queues', 'M-098'),
  ('settings.manage', 'Manage tenant settings, labels, calendars, picklists, reason maps and document types', 'M-098'),
  ('message_template.manage', 'Create and edit message templates', 'M-098'),
  ('user.read', 'View the staff user directory and user details', 'M-098'),
  ('user.invite', 'Invite staff users and resend invitations', 'M-098'),
  ('user.offboard', 'Deactivate, suspend, transfer and erase staff users', 'M-098'),
  ('role.read', 'View roles, their permissions and role assignments', 'M-098'),
  ('access_review.manage', 'Start access review campaigns and certify or revoke assignments', 'M-098'),
  ('activity.read', 'View logged interactions and the activity feed', 'M-098'),
  ('complaint.read', 'View customer complaints and their handling history', 'M-098'),
  ('attendance.read', 'View workforce attendance and capacity', 'M-098'),
  ('commission.view', 'View commission plans, calculations and payables', 'M-098'),
  ('payout.view', 'View payout requests, batches and payment records', 'M-098'),
  ('ledger.view', 'View the general ledger, journals and accounting periods', 'M-098'),
  ('reconciliation.view', 'View lender statements, matches and reconciliation exceptions', 'M-098'),
  ('invoice.view', 'View invoices and their payment status', 'M-098'),
  ('payout.disburse', 'Generate payout batches and bank files and dispatch gateway disbursements', 'M-098'),
  ('ledger.journal_post', 'Post manual ledger journals under maker-checker controls', 'M-098'),
  ('connector.bank_account_manage', 'Create and change connector bank accounts, approval stays with the SOD checker', 'M-098'),
  ('connector.agreement_manage', 'Create and manage connector agreements', 'M-098'),
  ('connector.portal_user_manage', 'Invite and manage connector portal users', 'M-098'),
  ('performance.read', 'View performance dashboards and the leaderboard', 'M-098'),
  ('target.read', 'View performance targets and attainment', 'M-098'),
  ('audit.seal', 'Seal the audit hash chain', 'M-098'),
  ('security.read', 'View security events and incidents', 'M-098'),
  ('privacy.read', 'View the consent register, data-subject requests, retention policies and legal holds', 'M-098'),
  ('import.read', 'View bulk import batches and their results', 'M-098')
ON CONFLICT (code) DO NOTHING;

-- 2. Backfill: each new code goes to every role (templates and custom, every customer tenant) that holds a parent code.
-- ledger.journal_post has no parent: manual posting is closed to humans today, so only the reviewed role matrix grants it.
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT DISTINCT rp.tenant_id, rp.role_id, m.child
FROM app.role_permission rp
JOIN app.tenant t ON t.id = rp.tenant_id AND t.tenant_type <> 'PLATFORM'
JOIN (
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
) AS m(parent, child) ON m.parent = rp.permission_code
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 3. Screens that were open to every signed-in staff user (Lenders, Products, Workforce) become permission-gated. Until the role matrix
-- trims them, every customer-tenant role keeps them: lender.read and product.read exist since migration 60 and were granted by
-- migration 85 to one tenant only.
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, c.code
FROM app.role r
JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
CROSS JOIN (VALUES ('lender.read'), ('product.read'), ('attendance.read')) AS c(code)
WHERE r.code NOT LIKE 'ROLE-CONNECTOR%'
ON CONFLICT (role_id, permission_code) DO NOTHING;
