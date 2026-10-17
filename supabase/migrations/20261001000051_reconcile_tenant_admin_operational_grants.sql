-- 20261001000045_reconcile_tenant_admin_operational_grants.sql
-- Modules 7, 8, 9, 18, 19, 27, 28: Reconcile tenant-admin operational grants and schema permissions
-- Ensure all tenants (including Alpha and Beta) hold approved operational permissions for tenant administrators

SET search_path = app, extensions, public;

-- The grants below include customer.create and customer.update. They are in the contracts and in the hosted catalog (introduced in
-- M-001), but no migration created them, so on a fresh build with a tenant present this migration failed on the foreign key.
-- Defining them here, before they are granted, is idempotent: on hosted they already exist and are left as they are.
INSERT INTO permission (code, description, introduced_in) VALUES
  ('customer.create', 'Create party profile / customer', 'M-001'),
  ('customer.update', 'Update customer profile', 'M-001')
ON CONFLICT (code) DO NOTHING;

-- Revoke any disallowed DELETE privileges from dsa_app to preserve NFR-SEC-003 immutability
REVOKE DELETE, TRUNCATE ON app.report_schedule FROM dsa_app;

-- Grant missing operational permissions to ROLE-TENANT-ADMIN and ROLE-ORG-OWNER across all tenants
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('activity.create'),
    ('activity.update'),
    ('application.create'),
    ('application.read'),
    ('application.review'),
    ('application.update'),
    ('connector.attribution_change'),
    ('connector.bank_change_approve'),
    ('connector.dispute_resolve'),
    ('connector.manage'),
    ('connector.read'),
    ('consent.record'),
    ('customer.create'),
    ('customer.read'),
    ('customer.update'),
    ('disbursement.record'),
    ('disbursement.verify'),
    ('disbursement.exception_approve'),
    ('document.upload'),
    ('lead.assign'),
    ('lead.create'),
    ('lead.qualify'),
    ('lead.read'),
    ('lead.update'),
    ('lender_case.submit'),
    ('lender_case.update_status'),
    ('sanction.record'),
    ('share.create'),
    ('task.create'),
    ('task.read'),
    ('task.update')
) AS p(code)
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')
ON CONFLICT DO NOTHING;
