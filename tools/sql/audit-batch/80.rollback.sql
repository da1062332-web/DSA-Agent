-- Roll back migration 0080. The tables are dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.reference_list') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.reference_list) THEN
      RAISE EXCEPTION 'Rollback aborted: app.reference_list holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.reference_list_version') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.reference_list_version) THEN
      RAISE EXCEPTION 'Rollback aborted: app.reference_list_version holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.reference_list_version, app.reference_list;
COMMIT;
