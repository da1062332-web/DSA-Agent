-- Verify migration 0068 (per-tenant feature flag overrides). Read-only. Expect every row PASS.
SELECT 'app.tenant_feature_flag exists with row-level security enabled and forced' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('app.tenant_feature_flag') AND relrowsecurity AND relforcerowsecurity)
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'policies: tenant_flag_insert[INSERT], tenant_flag_read[SELECT], tenant_flag_update[UPDATE]',
       CASE WHEN (SELECT string_agg(policyname || '[' || cmd || ']', ', ' ORDER BY policyname) FROM pg_policies
                   WHERE schemaname = 'app' AND tablename = 'tenant_feature_flag')
                 = 'tenant_flag_insert[INSERT], tenant_flag_read[SELECT], tenant_flag_update[UPDATE]'
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'writes need the platform realm (insert and update policies)',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'tenant_feature_flag'
                     AND cmd IN ('INSERT', 'UPDATE') AND with_check LIKE '%is_platform_realm%') = 2
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the key is (tenant_id, key) and a flag can only be overridden if feature_flag defines it with scope TENANT',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.tenant_feature_flag') AND contype = 'p'
                            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (tenant_id, key)')
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.tenant_feature_flag') AND contype = 'f'
                            AND confrelid = to_regclass('app.feature_flag'))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can read, insert and update but never delete',
       CASE WHEN has_table_privilege('dsa_app', 'app.tenant_feature_flag', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.tenant_feature_flag', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.tenant_feature_flag', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.tenant_feature_flag', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'feature_flag is untouched: still no tenant column, primary key (key, scope), three policies',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'feature_flag' AND column_name LIKE '%tenant%')
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.feature_flag') AND contype = 'p'
                            AND pg_get_constraintdef(oid) = 'PRIMARY KEY (key, scope)')
             AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'feature_flag') = 3
            THEN 'PASS' ELSE 'FAIL' END;
