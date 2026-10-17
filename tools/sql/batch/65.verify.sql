-- Verify migration 0065 (connector statement table name). Read-only. Expect every row PASS.
SELECT 'app.connector_statement_entry exists with forced row-level security and its tenant policy' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('app.connector_statement_entry') AND relrowsecurity AND relforcerowsecurity)
             AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'connector_statement_entry' AND policyname = 'connector_statement_entry_tenant_isolation')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'the connector statement table is no longer called ledger_entry (that name is the ledger module''s)',
       CASE WHEN to_regclass('app.ledger_entry') IS NULL
             OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'ledger_entry' AND column_name = 'connector_id')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can still read and write it',
       CASE WHEN to_regclass('app.connector_statement_entry') IS NOT NULL
             AND has_table_privilege('dsa_app', 'app.connector_statement_entry', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.connector_statement_entry', 'INSERT') THEN 'PASS' ELSE 'FAIL' END;
