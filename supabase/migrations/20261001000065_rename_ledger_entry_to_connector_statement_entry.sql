-- Migration: 20261001000065_rename_ledger_entry_to_connector_statement_entry.sql
-- Owner: Dev 1 (reconciling an edit to an applied migration).
-- Migration 0053 (invoices, applied on hosted) created the connector statement table as app.ledger_entry. The invoices code and the
-- 0053 file were later changed to call it app.connector_statement_entry, which frees the name ledger_entry for the ledger module's
-- own entity (ENT-081). A database that already ran the old 0053 therefore needs this additive rename; a database built from the
-- current 0053 already has the new name, and this migration does nothing there. Idempotent.
-- Everything that carries the old name is renamed with it (constraints and their indexes, other indexes, the policy), so the table ends
-- up exactly as a fresh build leaves it. Rows, privileges and row-level security are untouched: a rename keeps them.

SET search_path = app, extensions, public;

DO $$
DECLARE
  r record;
  old_prefix constant text := 'ledger_entry';
  new_prefix constant text := 'connector_statement_entry';
BEGIN
  IF to_regclass('app.ledger_entry') IS NOT NULL
     AND to_regclass('app.connector_statement_entry') IS NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'app' AND table_name = 'ledger_entry' AND column_name = 'connector_id') THEN
    ALTER TABLE app.ledger_entry RENAME TO connector_statement_entry;

    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'app.connector_statement_entry'::regclass AND conname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER TABLE app.connector_statement_entry RENAME CONSTRAINT %I TO %I',
                     r.conname, new_prefix || substr(r.conname, length(old_prefix) + 1));
    END LOOP;

    FOR r IN SELECT indexname FROM pg_indexes
              WHERE schemaname = 'app' AND tablename = 'connector_statement_entry' AND indexname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER INDEX app.%I RENAME TO %I', r.indexname, new_prefix || substr(r.indexname, length(old_prefix) + 1));
    END LOOP;

    FOR r IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'app' AND tablename = 'connector_statement_entry' AND policyname LIKE old_prefix || '%' LOOP
      EXECUTE format('ALTER POLICY %I ON app.connector_statement_entry RENAME TO %I',
                     r.policyname, new_prefix || substr(r.policyname, length(old_prefix) + 1));
    END LOOP;
  END IF;
END $$;
