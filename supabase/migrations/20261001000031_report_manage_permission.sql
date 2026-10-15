-- 20261001000031_report_manage_permission.sql (owner: Dev 5, TASK-414, MOD-RPT Privileged Refresh)
-- Privileged permission for refreshing reporting projections and managing reporting engine.
SET search_path = app, extensions, public;

-- Seed report.manage permission
INSERT INTO permission (code, description, introduced_in) VALUES
  ('report.manage', 'Manage reporting engine configurations and trigger projection rebuilds', 'MOD-RPT')
ON CONFLICT (code) DO NOTHING;

-- Grant report.manage to administrative and supervisor roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'report.manage'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR')
ON CONFLICT DO NOTHING;
