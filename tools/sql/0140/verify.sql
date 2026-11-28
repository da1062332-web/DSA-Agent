-- Verify migration 0140 (lender MIS status import). Read-only.
-- Expect every row to return PASS. Run before and after the hosted apply, as plan section 10 requires.
SET search_path = app, extensions, public;

SELECT 'table: lender_mis_mapping exists' AS check_name,
       CASE WHEN to_regclass('app.lender_mis_mapping') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL SELECT 'check: import_batch.target_entity admits LENDER_CASE_STATUS',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%LENDER_CASE_STATUS%'
       ) THEN 'PASS' ELSE 'FAIL' END

-- The widening must stay a superset: an existing LEAD or CUSTOMER batch has to remain legal.
UNION ALL SELECT 'check: import_batch.target_entity still admits LEAD and CUSTOMER',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%LEAD%'
           AND pg_get_constraintdef(con.oid) LIKE '%CUSTOMER%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'check: exactly one target_entity constraint on import_batch',
       CASE WHEN (
         SELECT count(*) FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%target_entity%'
       ) = 1 THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'rows: no existing import_batch row violates the new constraint',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM import_batch
         WHERE target_entity NOT IN ('LEAD', 'CUSTOMER', 'LENDER_CASE_STATUS')
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'constraint: one mapping per lender per tenant',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'lender_mis_mapping' AND con.contype = 'u'
           AND pg_get_constraintdef(con.oid) LIKE '%tenant_id%' AND pg_get_constraintdef(con.oid) LIKE '%lender_id%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'check: date_format is constrained to the four supported formats',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'lender_mis_mapping' AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%DD-MMM-YYYY%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'rls: lender_mis_mapping has row-level security enabled and forced',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND c.relname = 'lender_mis_mapping'
           AND c.relrowsecurity AND c.relforcerowsecurity
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'rls: tenant_isolation policy present on lender_mis_mapping',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'app' AND tablename = 'lender_mis_mapping' AND policyname = 'tenant_isolation'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'grant: dsa_app may read and write lender_mis_mapping',
       CASE WHEN (
         SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants
         WHERE table_schema = 'app' AND table_name = 'lender_mis_mapping' AND grantee = 'dsa_app'
           AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
       ) = 3 THEN 'PASS' ELSE 'FAIL' END

-- A mapping is replaced, never removed: a past batch's recorded version must still resolve.
UNION ALL SELECT 'grant: dsa_app may NOT delete lender_mis_mapping rows',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants
         WHERE table_schema = 'app' AND table_name = 'lender_mis_mapping' AND grantee = 'dsa_app'
           AND privilege_type = 'DELETE'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'trigger: lender_mis_mapping_touch maintains updated_at',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lender_mis_mapping_touch')
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'fk: lender_mis_mapping.lender_id is tenant-scoped',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app' AND rel.relname = 'lender_mis_mapping' AND con.contype = 'f'
           AND pg_get_constraintdef(con.oid) LIKE '%lender%(tenant_id, id)%'
       ) THEN 'PASS' ELSE 'FAIL' END;
