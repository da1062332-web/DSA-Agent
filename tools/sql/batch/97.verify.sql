-- Verify migration 0097 (connector role guard). Read-only. Expect no FAIL row; an INFO row reports a legacy object and is not a failure.
-- Run before the apply (the guards are absent, so the invariant rows show what the precheck will refuse) and after it.
-- A FAIL row names the rows to look at: an assignment that has not ended, or a reserved role. The count is in the detail column.
-- "Not ended" means open-ended, or ending after now.
WITH open_connector AS (
  SELECT ura.id FROM app.user_role_assignment ura
    JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
   WHERE u.user_type = 'CONNECTOR' AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())
),
open_reserved_staff AS (
  SELECT ura.id FROM app.user_role_assignment ura
    JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
    JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
   WHERE u.user_type = 'STAFF' AND r.code LIKE 'ROLE-CONNECTOR%'
     AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())
),
guards AS (
  SELECT t.tgname AS name, c.relname AS on_table
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND NOT t.tgisinternal
     AND t.tgname IN ('user_role_assignment_user_type_guard', 'app_user_type_role_guard', 'role_reserved_code_guard')
)
SELECT 'trigger user_role_assignment_user_type_guard is installed on user_role_assignment' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM guards WHERE name = 'user_role_assignment_user_type_guard' AND on_table = 'user_role_assignment')
            THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'trigger app_user_type_role_guard is installed on app_user',
       CASE WHEN EXISTS (SELECT 1 FROM guards WHERE name = 'app_user_type_role_guard' AND on_table = 'app_user') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'trigger role_reserved_code_guard is installed on role',
       CASE WHEN EXISTS (SELECT 1 FROM guards WHERE name = 'role_reserved_code_guard' AND on_table = 'role') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the three guard functions exist and are not executable by PUBLIC',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'app'
                     AND p.proname IN ('user_role_assignment_user_type_guard', 'app_user_type_role_guard', 'role_reserved_code_guard')) = 3
             AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app'
                                AND p.proname IN ('user_role_assignment_user_type_guard', 'app_user_type_role_guard', 'role_reserved_code_guard')
                                AND has_function_privilege('public', p.oid, 'EXECUTE'))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'no connector portal login holds a role that has not ended (expect 0)',
       CASE WHEN (SELECT count(*) FROM open_connector) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'open assignments: ' || (SELECT count(*) FROM open_connector)
UNION ALL SELECT 'no staff account holds a reserved ROLE-CONNECTOR role that has not ended (expect 0)',
       CASE WHEN (SELECT count(*) FROM open_reserved_staff) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'open assignments: ' || (SELECT count(*) FROM open_reserved_staff)
UNION ALL SELECT 'reserved ROLE-CONNECTOR roles that already exist (informational: none can be created or assigned now)',
       'INFO',
       'reserved roles: ' || (SELECT count(*) FROM app.role WHERE code LIKE 'ROLE-CONNECTOR%');
