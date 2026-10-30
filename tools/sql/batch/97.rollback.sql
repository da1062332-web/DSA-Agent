-- Roll back migration 0097: remove the three guards and their functions. Changes no data.
-- Limitation: after the rollback the database accepts a role on a connector portal login again. Use it only with owner approval, and
-- not while a build that relies on the guard is serving. Re-applying 0097 needs the precheck to pass again (no open connector-login
-- or reserved-role assignment). Ending an assignment is not undone by this script: migration 0057 forbids reopening an ended one.
BEGIN;
SET search_path = app, extensions, public;

DROP TRIGGER IF EXISTS role_reserved_code_guard ON app.role;
DROP TRIGGER IF EXISTS app_user_type_role_guard ON app.app_user;
DROP TRIGGER IF EXISTS user_role_assignment_user_type_guard ON app.user_role_assignment;

DROP FUNCTION IF EXISTS app.role_reserved_code_guard();
DROP FUNCTION IF EXISTS app.app_user_type_role_guard();
DROP FUNCTION IF EXISTS app.user_role_assignment_user_type_guard();
COMMIT;
