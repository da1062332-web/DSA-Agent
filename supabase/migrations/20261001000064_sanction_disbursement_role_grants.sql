-- 20261001000044_sanction_disbursement_role_grants.sql
-- Module 19: Sanction and Disbursement (MOD-SND)
-- Apply approved role grants for sanction and disbursement permissions to tenant administrators

SET search_path = app, extensions, public;

-- Ensure permissions exist in permission registry
INSERT INTO permission (code, description, introduced_in) VALUES
  ('sanction.record', 'Record or revise sanctions', 'MOD-SND'),
  ('disbursement.record', 'Record disbursement tranches', 'MOD-SND'),
  ('disbursement.verify', 'Verify or return disbursement tranches', 'MOD-SND'),
  ('disbursement.exception_approve', 'Approve evidence exceptions for tranches', 'MOD-SND')
ON CONFLICT (code) DO NOTHING;

-- Grant sanction and disbursement permissions to tenant admin and operations roles across all tenants
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('sanction.record'),
    ('disbursement.record'),
    ('disbursement.verify'),
    ('disbursement.exception_approve')
) AS p(code)
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;
