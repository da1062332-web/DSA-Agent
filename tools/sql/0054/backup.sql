-- Backup script for migration 0054
-- Read-only. Emits JSON representation of current state of affected entities.
SET search_path = app, extensions, public;

SELECT json_build_object(
  'timestamp', now(),
  'permissions', (
    SELECT json_agg(p) FROM (
      SELECT * FROM app.permission WHERE code IN ('role.manage')
    ) p
  ),
  'admin_role_permissions', (
    SELECT json_agg(rp) FROM (
      SELECT rp.* FROM app.role_permission rp
      JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
      WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER') AND rp.permission_code = 'role.manage'
    ) rp
  ),
  'active_users_without_roles', (
    SELECT json_agg(u) FROM (
      SELECT u.id, u.tenant_id, u.email, u.status
      FROM app.app_user u
      WHERE u.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM app.user_role_assignment ura 
          WHERE ura.user_id = u.id AND ura.tenant_id = u.tenant_id
        )
    ) u
  ),
  'decision_definition_eligibility', (
    SELECT json_agg(dd) FROM (
      SELECT * FROM app.decision_definition WHERE key = 'DK-application.eligibility'
    ) dd
  ),
  'api_client_table_exists', (
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'api_client')
  )
) AS backup_state;
