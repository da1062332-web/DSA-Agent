-- Roll back migration 0061. The release register is dropped only if it holds nothing but the seeded candidate row, unchanged.
-- The baseline master data rows are left in place on purpose: they cannot be told apart from rows that existed before.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.platform_release') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.platform_release WHERE NOT (version = 'v0.1.0-rc.1' AND updated_by = 'SYSTEM:migration' AND lock_version = 1)) THEN
      RAISE EXCEPTION 'Rollback aborted: app.platform_release has rows beyond the seeded candidate, or it was edited. Manual review required.';
    END IF;
    DROP TABLE app.platform_release;
  END IF;
END $$;
COMMIT;
