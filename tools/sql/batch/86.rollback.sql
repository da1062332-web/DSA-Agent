-- Roll back migration 0086: drop the two test-login functions.
-- SUPERSEDED on 2026-10-29: migration 0096 dropped these functions, so this file does nothing now. To re-create them, use tools/sql/batch/96.rollback.sql, with owner approval.
-- The statements below were the proposal for the drop. They are kept as a record and are no longer the way to undo 0096.
-- Run only when all of these hold, with the owner's approval:
--   1. the test-login route is removed from every build that can reach a database (apps/api/src/http/public-auth-router.ts, mounted in apps/api/src/app.ts);
--   2. local QA no longer depends on the functions;
--   3. the EXECUTE revoke (tools/sql/remediation/0086-revoke-test-login-execute.sql) has already been applied.
BEGIN;
DROP FUNCTION IF EXISTS app.lookup_test_user(text);
DROP FUNCTION IF EXISTS app.list_test_users();
COMMIT;
