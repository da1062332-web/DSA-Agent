-- Roll back migration 0065: give the connector statement table its old name again (only needed if the invoices code from before the rename
-- is deployed). Rows, privileges and policies are untouched; every object that carries the name goes back with it. Do not run it once the
-- current invoices code is live: that code reads connector_statement_entry.
BEGIN;
SET search_path = app, extensions, public;
DO $$
DECLARE
  r record;
  old_prefix constant text := 'connector_statement_entry';
  new_prefix constant text := 'ledger_entry';
BEGIN
  IF to_regclass('app.connector_statement_entry') IS NOT NULL AND to_regclass('app.ledger_entry') IS NULL THEN
    ALTER TABLE app.connector_statement_entry RENAME TO ledger_entry;

    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'app.ledger_entry'::regclass AND conname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER TABLE app.ledger_entry RENAME CONSTRAINT %I TO %I', r.conname, new_prefix || substr(r.conname, length(old_prefix) + 1));
    END LOOP;
    FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'ledger_entry' AND indexname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER INDEX app.%I RENAME TO %I', r.indexname, new_prefix || substr(r.indexname, length(old_prefix) + 1));
    END LOOP;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'app' AND tablename = 'ledger_entry' AND policyname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER POLICY %I ON app.ledger_entry RENAME TO %I', r.policyname, new_prefix || substr(r.policyname, length(old_prefix) + 1));
    END LOOP;
  END IF;
END $$;
COMMIT;
