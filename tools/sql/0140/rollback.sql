-- Rollback migration 0140 (lender MIS status import).
--
-- DATA LOSS: dropping lender_mis_mapping discards every lender's saved sheet mapping. Each one is a person's work —
-- the column map, the bank's status words, the date format — and is not recoverable from anything else. Export the
-- table before running this if any mapping has been saved:
--   \copy (SELECT * FROM app.lender_mis_mapping) TO 'lender_mis_mapping_backup.csv' CSV HEADER
--
-- Narrowing target_entity back is refused while any LENDER_CASE_STATUS batch exists, rather than discarding the batch
-- history of imports that have already moved real cases.

SET search_path = app, extensions, public;

DO $$
DECLARE
  offending integer;
  con_name text;
BEGIN
  SELECT count(*) INTO offending FROM import_batch WHERE target_entity = 'LENDER_CASE_STATUS';
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Refusing to narrow import_batch.target_entity: % batch(es) recorded as LENDER_CASE_STATUS. Delete or re-target them first, or leave the widened constraint in place — it is a superset and harms nothing.',
      offending;
  END IF;

  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%target_entity%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE import_batch DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE import_batch
    ADD CONSTRAINT import_batch_target_entity_check
    CHECK (target_entity IN ('LEAD', 'CUSTOMER'));
END $$;

DROP TRIGGER IF EXISTS lender_mis_mapping_touch ON lender_mis_mapping;
DROP TABLE IF EXISTS lender_mis_mapping;
