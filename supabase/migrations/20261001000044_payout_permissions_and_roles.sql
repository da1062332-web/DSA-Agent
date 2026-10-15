-- Migration: 20261001000044_payout_permissions_and_roles.sql
-- Module: MOD-PAY (TASK-418 Payout Management)
-- Author: Dev 5 (Bhushan) / Finance Squad

SET search_path = app, extensions, public;

-- 1. Register canonical permission codes for MOD-PAY and finance viewing
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('payout.request', 'Create and submit connector payout requests', 'TASK-418'),
  ('payout.approve', 'Approve or reject connector payout requests with SOD-03 enforcement', 'TASK-418'),
  ('payout.record_payment', 'Record payment details, failure information, and generate bank batches', 'TASK-418'),
  ('finance.view', 'View commission calculations, payables, and payout records', 'TASK-418')
ON CONFLICT (code) DO NOTHING;

-- 2. Seed ROLE-COMMISSION-APPROVER for each tenant
INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 
  'rol_comm_approver_' || t.id,
  t.id,
  'ROLE-COMMISSION-APPROVER',
  'Commission and Payout Approver',
  false,
  1,
  now(),
  'SYSTEM:migration'
FROM app.tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-COMMISSION-APPROVER'
);

-- 3. Grant permissions to standard platform roles
-- ROLE-ORG-OWNER: Has full finance visibility, payout request, approval, and payment recording
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('payout.request'),
    ('payout.approve'),
    ('payout.record_payment'),
    ('finance.view')
) AS p(code)
WHERE r.code = 'ROLE-ORG-OWNER'
ON CONFLICT DO NOTHING;

-- ROLE-COMMISSION-APPROVER: Dedicated checker role for payout approval and recording
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('payout.approve'),
    ('payout.record_payment'),
    ('finance.view')
) AS p(code)
WHERE r.code = 'ROLE-COMMISSION-APPROVER'
ON CONFLICT DO NOTHING;

-- ROLE-BRANCH-MGR: Can view finance and initiate payout requests within scope
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('payout.request'),
    ('finance.view')
) AS p(code)
WHERE r.code = 'ROLE-BRANCH-MGR'
ON CONFLICT DO NOTHING;
