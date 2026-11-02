-- Roll back migration 0099: remove the connector link from verification. Changes no other data.
-- Guarded: refused while any verification is about a connector. A verification record is immutable (verification_no_mutation), so it cannot
-- be deleted or changed to remove the link, and dropping the link would leave a record that no longer says what it is about.
-- Order: roll back 0100 before 0099, and 0099 before 0098. Also run it only with the application version that does not read connector_id:
-- the current activation check reads verification.connector_id, so a rollback under the current code breaks activation (it does not break
-- anything else). One transaction; any RAISE rolls the whole thing back.
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE
  about_connectors bigint;
BEGIN
  SELECT count(*) INTO about_connectors FROM app.verification WHERE subject_type = 'CONNECTOR' OR connector_id IS NOT NULL;
  IF about_connectors > 0 THEN
    RAISE EXCEPTION 'migration 0099 rollback refused: % verification record(s) are about connectors. Verification records are immutable; keep the column.',
      about_connectors;
  END IF;
END
$$;

DROP INDEX IF EXISTS verification_connector_idx;
ALTER TABLE verification DROP CONSTRAINT IF EXISTS verification_connector_subject_check;
ALTER TABLE verification DROP CONSTRAINT IF EXISTS verification_connector_fk;
ALTER TABLE verification DROP CONSTRAINT IF EXISTS verification_subject_type_check;
ALTER TABLE verification ADD CONSTRAINT verification_subject_type_check
  CHECK (subject_type IN ('CUSTOMER', 'LOAN_APPLICATION', 'LEAD'));
ALTER TABLE verification DROP COLUMN IF EXISTS connector_id;
COMMIT;
