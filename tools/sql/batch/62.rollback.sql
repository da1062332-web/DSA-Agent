-- Roll back migration 0062. The failure_reason column is dropped only if no correction has recorded a failure reason.
BEGIN;
SET search_path = app, extensions, public;
DROP FUNCTION IF EXISTS app.approved_data_corrections(integer);
ALTER TABLE app.data_correction_request DROP CONSTRAINT IF EXISTS data_correction_failed_has_reason;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'data_correction_request' AND column_name = 'failure_reason') THEN
    IF EXISTS (SELECT 1 FROM app.data_correction_request WHERE failure_reason IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: failure reasons are recorded. Manual review required.';
    END IF;
    ALTER TABLE app.data_correction_request DROP COLUMN failure_reason;
  END IF;
END $$;
COMMIT;
