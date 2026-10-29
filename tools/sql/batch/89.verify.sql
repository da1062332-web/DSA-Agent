-- Verify migration 0089 (support view with the tenant's settings and feature flags). Read-only. Expect every row PASS.
SELECT 'platform_support_view reads the tenant settings and feature flags (its definition names setting and tenant_feature_flag)' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'platform_support_view'
                            AND pg_get_functiondef(p.oid) ILIKE '%tenant_feature_flag%'
                            AND pg_get_functiondef(p.oid) ILIKE '%''settings''%')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'PUBLIC cannot execute platform_support_view',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             WHERE n.nspname = 'app' AND p.proname = 'platform_support_view'
                               AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can execute platform_support_view',
       CASE WHEN has_function_privilege('dsa_app', 'app.platform_support_view(text, text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END;
