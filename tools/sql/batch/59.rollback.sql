-- Roll back migration 0059. Role edit and delete stop working again (409) and system roles are no longer protected by the database.
BEGIN;
SET search_path = app, extensions, public;
DROP TRIGGER IF EXISTS role_guard ON app.role;
DROP TRIGGER IF EXISTS role_permission_guard ON app.role_permission;
DROP FUNCTION IF EXISTS app.role_guard();
DROP FUNCTION IF EXISTS app.role_permission_guard();
REVOKE DELETE ON app.role, app.role_permission FROM dsa_app;
REVOKE UPDATE (name, version) ON app.role FROM dsa_app;
COMMIT;
