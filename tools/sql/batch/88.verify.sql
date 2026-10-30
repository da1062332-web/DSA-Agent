-- Verify migration 0088 (break-glass support view). Read-only. Expect every row PASS.
SELECT 'app.platform_support_view(text, text) exists, is SECURITY DEFINER, and pins its search_path' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'platform_support_view' AND p.prosecdef
                            AND 'search_path=app, pg_temp' = ANY (p.proconfig))
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'the support_access_grant table exists',
       CASE WHEN to_regclass('app.support_access_grant') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'PUBLIC cannot execute platform_support_view (0088 revokes it)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             WHERE n.nspname = 'app' AND p.proname = 'platform_support_view'
                               AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can execute platform_support_view (0088 grants it)',
       CASE WHEN has_function_privilege('dsa_app', 'app.platform_support_view(text, text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END;
