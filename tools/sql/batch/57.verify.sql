-- Verify migration 0057 (role assignment end). Read-only. Expect every row PASS.
SELECT 'trigger user_role_assignment_close_only exists' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_role_assignment_close_only' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'dsa_app may update only effective_range of an assignment',
       CASE WHEN has_column_privilege('dsa_app', 'app.user_role_assignment', 'effective_range', 'UPDATE')
             AND NOT has_column_privilege('dsa_app', 'app.user_role_assignment', 'role_id', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app still cannot delete assignments',
       CASE WHEN NOT has_table_privilege('dsa_app', 'app.user_role_assignment', 'DELETE') THEN 'PASS' ELSE 'FAIL' END;
