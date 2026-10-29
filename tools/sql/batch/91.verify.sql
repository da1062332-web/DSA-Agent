-- Verify migration 0091 (security hardening). Read-only. Expect every row PASS, except the INFO row.
SELECT 'public.label_set runs as the caller (security_invoker), or does not exist' AS "check",
       CASE WHEN to_regclass('public.label_set') IS NULL
              OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.label_set'::regclass AND c.reloptions @> ARRAY['security_invoker=true'])
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'anon has no SELECT on any table or view in public',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p', 'm')
                                AND has_table_privilege('anon', c.oid, 'SELECT'))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'anon and authenticated have no INSERT, UPDATE or DELETE on any table or view in public',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p', 'm')
                                AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')
                                  OR has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE')))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'app.authenticate_user does not exist (0091 drops it)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app' AND p.proname = 'authenticate_user')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'anon and authenticated hold no explicit EXECUTE on any app function',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              CROSS JOIN LATERAL aclexplode(p.proacl) a
                              WHERE n.nspname = 'app' AND p.proacl IS NOT NULL
                                AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'INFO (not a pass or fail): app functions that anon can execute through PUBLIC, from the default grant',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND has_function_privilege('anon', p.oid, 'EXECUTE'));
