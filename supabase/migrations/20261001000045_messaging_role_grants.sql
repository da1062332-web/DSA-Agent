-- Migration: 20261001000045_messaging_role_grants.sql
-- Module: MOD-MSG (Module 11 / TASK-415 Messaging)
-- Fix: Reconcile role_permission grants for message.send across all active tenant roles

SET search_path = app, extensions, public;

-- Ensure permission is registered in catalog
INSERT INTO app.permission (code, description, introduced_in)
VALUES ('message.send', 'Send customer and lead outbound messages', 'TASK-415')
ON CONFLICT (code) DO NOTHING;

-- Grant message.send to tenant administrative and customer-facing operational roles
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'message.send'
FROM app.role r
WHERE r.code IN (
  'ROLE-ORG-OWNER',
  'ROLE-TENANT-ADMIN',
  'ROLE-BRANCH-MGR',
  'ROLE-TEAM-MGR',
  'ROLE-RM',
  'ROLE-SALES-EXEC',
  'ROLE-LOAN-OPS'
)
ON CONFLICT DO NOTHING;
