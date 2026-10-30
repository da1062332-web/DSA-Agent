-- Migration 0096: drop the QA test-login lookups created by migration 0086, app.lookup_test_user(text) and app.list_test_users().
-- They let any API role list every active user's email across all tenants, and look up any user's identity-provider subject.
-- Their only caller is the test-login route (apps/api/src/http/public-auth-router.ts). That route is mounted only when TEST_AUTH_ENABLED is
-- true and the gate in apps/api/src/test-auth.ts allows it, and the gate refuses the shared project. The route's code is unchanged here.
-- Their EXECUTE was already revoked from PUBLIC, dsa_app and dsa_api on 2026-10-29 (tools/sql/remediation/0086-revoke-test-login-execute.sql).
-- To re-create them, use the definitions in migration 0086 (see tools/sql/batch/96.rollback.sql).
SET search_path = app, extensions, public;

DROP FUNCTION IF EXISTS app.lookup_test_user(text);
DROP FUNCTION IF EXISTS app.list_test_users();
