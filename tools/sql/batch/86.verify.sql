-- Verify migration 0086 (test-login helpers). Read-only. Expect every row PASS.
-- These rows check what 0086 creates. The EXECUTE revoke of 2026-10-29 is checked by tools/sql/remediation/0086-revoke-test-login-execute.verify.sql.
-- Migration 0096 (2026-10-29) dropped these functions, so the rows below report FAIL by design now. 96.verify.sql is the current check.
SELECT 'app.lookup_test_user(text) exists, is SECURITY DEFINER, is owned by postgres, and pins its search_path' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'lookup_test_user' AND p.prosecdef
                            AND p.proowner = 'postgres'::regrole
                            AND 'search_path=app, pg_temp' = ANY (p.proconfig))
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'app.list_test_users() exists, is SECURITY DEFINER, is owned by postgres, and pins its search_path',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'list_test_users' AND p.prosecdef
                            AND p.proowner = 'postgres'::regrole
                            AND 'search_path=app, pg_temp' = ANY (p.proconfig))
            THEN 'PASS' ELSE 'FAIL' END;
