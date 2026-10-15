-- 20261001000045_reconcile_tenant_admin_operational_grants.sql
-- Modules 7, 8, 9, 18, 19, 27, 28: Reconcile tenant-admin operational grants and schema permissions
-- Ensure all tenants (including Alpha and Beta) hold approved operational permissions for tenant administrators

SET search_path = app, extensions, public;

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
