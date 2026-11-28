-- Verify migration 0121 (P2-04 lender document packs). Owner: Dipanshu.
-- Read-only. Each row is PASS or FAIL; expect no FAIL row after the apply (and FAIL rows before it).
SET search_path = app, extensions, public;

SELECT 'lender_pack_profile exists' AS "check",
       CASE WHEN to_regclass('app.lender_pack_profile') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'row-level security is enabled and forced',
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'lender_pack_profile'
                            AND c.relrowsecurity AND c.relforcerowsecurity)
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the tenant_isolation policy exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                          WHERE schemaname = 'app' AND tablename = 'lender_pack_profile' AND policyname = 'tenant_isolation')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app can read, insert and update, but not delete',
       -- CASE branches run in order, so has_table_privilege is never called on a table that does not exist yet.
       CASE WHEN to_regclass('app.lender_pack_profile') IS NULL THEN 'FAIL'
            WHEN has_table_privilege('dsa_app', 'app.lender_pack_profile', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.lender_pack_profile', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.lender_pack_profile', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.lender_pack_profile', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'one profile per lender (unique tenant_id, lender_id)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = to_regclass('app.lender_pack_profile') AND contype = 'u'
                            AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, lender_id)')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the touch trigger bumps lock_version',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid = to_regclass('app.lender_pack_profile') AND tgname = 'lender_pack_profile_touch')
            THEN 'PASS' ELSE 'FAIL' END, '';
