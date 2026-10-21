-- Roll back migration 0070. Only codes this migration defined (introduced_in AUDIT-2026-10-19) are removed, with their grants; codes that existed before stay.
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.role_permission WHERE permission_code IN (SELECT code FROM app.permission WHERE introduced_in = 'AUDIT-2026-10-19');
DELETE FROM app.permission WHERE introduced_in = 'AUDIT-2026-10-19';
COMMIT;
