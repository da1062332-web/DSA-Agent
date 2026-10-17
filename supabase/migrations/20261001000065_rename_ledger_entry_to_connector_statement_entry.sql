-- Migration: 20261001000065_rename_ledger_entry_to_connector_statement_entry.sql
-- Owner: Dev 1 (reconciling an edit to an applied migration).
-- Migration 0053 (invoices, applied on hosted) created the connector statement table as app.ledger_entry. The invoices code and the
-- 0053 file were later changed to call it app.connector_statement_entry, which frees the name ledger_entry for the ledger module's
-- own entity (ENT-081). A database that already ran the old 0053 therefore needs this additive rename; a database built from the
-- current 0053 already has the new name, and this migration does nothing there. Idempotent.

SET search_path = app, extensions, public;

DO $$
BEGIN
  IF to_regclass('app.ledger_entry') IS NOT NULL
     AND to_regclass('app.connector_statement_entry') IS NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'app' AND table_name = 'ledger_entry' AND column_name = 'connector_id') THEN
    ALTER TABLE app.ledger_entry RENAME TO connector_statement_entry;
    IF to_regclass('app.ledger_entry_tenant_conn_date_idx') IS NOT NULL THEN
      ALTER INDEX app.ledger_entry_tenant_conn_date_idx RENAME TO connector_statement_entry_tenant_conn_date_idx;
    END IF;
    IF to_regclass('app.ledger_entry_pkey') IS NOT NULL THEN
      ALTER INDEX app.ledger_entry_pkey RENAME TO connector_statement_entry_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entry_tenant_id_id_key' AND conrelid = 'app.connector_statement_entry'::regclass) THEN
      ALTER TABLE app.connector_statement_entry RENAME CONSTRAINT ledger_entry_tenant_id_id_key TO connector_statement_entry_tenant_id_id_key;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'connector_statement_entry' AND policyname = 'ledger_entry_tenant_isolation') THEN
      ALTER POLICY ledger_entry_tenant_isolation ON app.connector_statement_entry RENAME TO connector_statement_entry_tenant_isolation;
    END IF;
  END IF;
END $$;
