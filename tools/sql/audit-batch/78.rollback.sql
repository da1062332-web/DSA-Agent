-- Roll back migration 0078. The tables are dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.retention_policy') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.retention_policy) THEN
      RAISE EXCEPTION 'Rollback aborted: app.retention_policy holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.data_subject_request') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.data_subject_request) THEN
      RAISE EXCEPTION 'Rollback aborted: app.data_subject_request holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.data_subject_request, app.retention_policy;
COMMIT;
