-- Verify migration 0059 (role edit and delete). Read-only. Expect every row PASS.
SELECT 'trigger role_guard exists' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_guard' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'trigger role_permission_guard exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_permission_guard' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app may rename a role (name, version) but not change its code',
       CASE WHEN has_column_privilege('dsa_app', 'app.role', 'name', 'UPDATE') AND has_column_privilege('dsa_app', 'app.role', 'version', 'UPDATE')
             AND NOT has_column_privilege('dsa_app', 'app.role', 'code', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app may delete roles and role permissions',
       CASE WHEN has_table_privilege('dsa_app', 'app.role', 'DELETE') AND has_table_privilege('dsa_app', 'app.role_permission', 'DELETE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the guards are limited to the application logins (owner-run changes are not blocked)',
       CASE WHEN to_regprocedure('app.role_guard()') IS NOT NULL AND pg_get_functiondef(to_regprocedure('app.role_guard()')) LIKE '%dsa_app%dsa_api%' THEN 'PASS' ELSE 'FAIL' END;
