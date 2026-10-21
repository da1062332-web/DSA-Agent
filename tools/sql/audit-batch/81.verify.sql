-- Verify migration 0081 (access reviews). Read-only. Expect every row PASS.
SELECT 'access_review and access_review_item exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.access_review'), to_regclass('app.access_review_item')) AND relrowsecurity AND relforcerowsecurity) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'a reviewer never decides their own access (SOD-10 check)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.access_review_item') AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%decided_by <> user_id%') THEN 'PASS' ELSE 'FAIL' END;
