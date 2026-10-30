-- APPLIED to the shared project on 2026-10-29 with owner approval (verified: tools/sql/remediation/0086-revoke-test-login-execute.verify.sql). Kept as the record of that change.
-- Purpose: remove EXECUTE on the two cross-tenant test-login functions from migration 0086 for PUBLIC, dsa_app and dsa_api.
-- Hosted state before this runs (read-only check, 2026-10-29): all three hold EXECUTE on both functions (docs/HOSTED_STATUS_2026-10-29.md).
-- Not in this file: dropping the functions (needs the test route removed first), and revoking USAGE on schema app from PUBLIC (a separate decision).
-- One transaction. The guard raises before any change if a function or role is missing. Running it twice changes nothing the second time.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('app.lookup_test_user(text)') IS NULL OR to_regprocedure('app.list_test_users()') IS NULL THEN
    RAISE EXCEPTION '0086 test-login functions not found; nothing was changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_api') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN
    RAISE EXCEPTION 'dsa_api or dsa_app role not found; nothing was changed';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION app.lookup_test_user(text) FROM PUBLIC, dsa_app, dsa_api;
REVOKE EXECUTE ON FUNCTION app.list_test_users() FROM PUBLIC, dsa_app, dsa_api;

COMMIT;
