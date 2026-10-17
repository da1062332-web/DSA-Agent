-- Roll back migration 0065: give the connector statement table its old name again (only needed if the invoices code from before the rename
-- is deployed). Rows are untouched. Do not run it once the current invoices code is live: that code reads connector_statement_entry.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.connector_statement_entry') IS NOT NULL AND to_regclass('app.ledger_entry') IS NULL THEN
    ALTER TABLE app.connector_statement_entry RENAME TO ledger_entry;
    ALTER INDEX IF EXISTS app.connector_statement_entry_tenant_conn_date_idx RENAME TO ledger_entry_tenant_conn_date_idx;
    ALTER INDEX IF EXISTS app.connector_statement_entry_pkey RENAME TO ledger_entry_pkey;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_statement_entry_tenant_id_id_key' AND conrelid = 'app.ledger_entry'::regclass) THEN
      ALTER TABLE app.ledger_entry RENAME CONSTRAINT connector_statement_entry_tenant_id_id_key TO ledger_entry_tenant_id_id_key;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'ledger_entry' AND policyname = 'connector_statement_entry_tenant_isolation') THEN
      ALTER POLICY connector_statement_entry_tenant_isolation ON app.ledger_entry RENAME TO ledger_entry_tenant_isolation;
    END IF;
  END IF;
END $$;
COMMIT;
