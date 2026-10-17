-- Roll back migration 0057. Removing a role from a user stops working again afterwards (it answers 409 for everyone).
BEGIN;
SET search_path = app, extensions, public;
DROP TRIGGER IF EXISTS user_role_assignment_close_only ON app.user_role_assignment;
DROP FUNCTION IF EXISTS app.user_role_assignment_close_only();
REVOKE UPDATE (effective_range) ON app.user_role_assignment FROM dsa_app;
COMMIT;
