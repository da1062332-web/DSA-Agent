-- Verify migration 0078 (retention policies and data-subject requests). Read-only. Expect every row PASS.
SELECT 'retention_policy and data_subject_request exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.retention_policy'), to_regclass('app.data_subject_request')) AND relrowsecurity AND relforcerowsecurity) = 2 THEN 'PASS' ELSE 'FAIL' END AS result;
