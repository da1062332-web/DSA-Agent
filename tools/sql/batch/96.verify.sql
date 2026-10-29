-- Verify migration 0096 (drop of the test-login lookups). Read-only. Expect every row PASS.
SELECT 'app.lookup_test_user(text) does not exist' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app' AND p.proname = 'lookup_test_user')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'app.list_test_users() does not exist',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app' AND p.proname = 'list_test_users')
            THEN 'PASS' ELSE 'FAIL' END;
