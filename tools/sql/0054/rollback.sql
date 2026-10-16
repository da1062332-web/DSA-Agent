-- Rollback script for migration 0054
-- Safe, surgical rollback in case of an issue during migration application.

BEGIN;

SET search_path = app, extensions, public;

-- 1. Remove API client table (only if empty to prevent accidental data loss)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'api_client') THEN
    IF (SELECT count(*) FROM app.api_client) > 0 THEN
      RAISE EXCEPTION 'Rollback aborted: app.api_client contains data rows. Manual review required.';
    ELSE
      DROP TABLE app.api_client;
    END IF;
  END IF;
END $$;

-- 2. Remove decision dependency
DELETE FROM app.decision_dependency
WHERE decision_key = 'DK-application.completeness'
  AND depends_on_key = 'DK-application.eligibility';

-- 3. Remove decision definition (only if no rule_set or rule_set_version references it)
DELETE FROM app.decision_definition
WHERE key = 'DK-application.eligibility'
  AND NOT EXISTS (
    SELECT 1 FROM app.rule_set WHERE decision_key = 'DK-application.eligibility'
  );

-- 4. Remove role.manage grants from admin roles
DELETE FROM app.role_permission
WHERE permission_code = 'role.manage';

-- 5. Remove role.manage permission definition
DELETE FROM app.permission
WHERE code = 'role.manage';

COMMIT;
