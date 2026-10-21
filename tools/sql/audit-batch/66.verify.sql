-- Verify migration 0066 (lender queries). Read-only. Expect every row PASS.
SELECT 'table lender_query exists with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.lender_query')) AND relrowsecurity AND relforcerowsecurity) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'a query is answered once (trigger)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.lender_query') AND tgname = 'lender_query_answer_once_guard' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app may read, insert and update queries',
       CASE WHEN coalesce(has_table_privilege('dsa_app', to_regclass('app.lender_query'), 'SELECT'), false) AND coalesce(has_table_privilege('dsa_app', to_regclass('app.lender_query'), 'INSERT'), false) AND coalesce(has_table_privilege('dsa_app', to_regclass('app.lender_query'), 'UPDATE'), false) THEN 'PASS' ELSE 'FAIL' END;
