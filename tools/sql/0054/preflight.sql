-- Preflight check for migration 0054 (access_control_and_api_clients)
-- Read-only. Runs without modifying any tables.
SET search_path = app, extensions, public;

SELECT 1 AS ord, 'Prerequisites: app.tenant table exists' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'tenant') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 2, 'Prerequisites: app.decision_definition table exists',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'decision_definition') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 3, 'Prerequisites: app.decision_dependency table exists',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'decision_dependency') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 4, 'Prerequisites: DK-application.completeness exists',
       CASE WHEN EXISTS (SELECT 1 FROM app.decision_definition WHERE key = 'DK-application.completeness') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 5, 'Prerequisites: enable_tenant_rls procedure exists',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_schema = 'app' AND routine_name = 'enable_tenant_rls') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 6, 'Current: role.manage permission status (0 = missing, will be added)',
       (SELECT count(*)::text FROM app.permission WHERE code = 'role.manage')
UNION ALL
SELECT 7, 'Current: admin roles that will receive role.manage (expected = 5)',
       (SELECT count(*)::text FROM app.role WHERE code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER'))
UNION ALL
SELECT 8, 'Current: DK-application.eligibility status (0 = missing, will be added)',
       (SELECT count(*)::text FROM app.decision_definition WHERE key = 'DK-application.eligibility')
UNION ALL
SELECT 9, 'Current: app.api_client table status (0 = missing, will be added)',
       (SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'api_client')
UNION ALL
SELECT 10, 'Current: active users without roles (expected = 21, in test-dsa-alpha with no ROLE-RM, so 0 updated)',
       (SELECT count(*)::text FROM app.app_user u
        WHERE u.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM app.user_role_assignment ura WHERE ura.user_id = u.id AND ura.tenant_id = u.tenant_id))
UNION ALL
SELECT 11, 'Current: test orphan users (expected = 0)',
       (SELECT count(*)::text FROM app.app_user WHERE email LIKE '%test%orphan%')
ORDER BY ord;
