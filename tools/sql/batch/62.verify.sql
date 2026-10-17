-- Verify migration 0062 (data-correction executor support). Read-only. Expect every row PASS.
SELECT 'column data_correction_request.failure_reason exists' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'data_correction_request' AND column_name = 'failure_reason') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'a FAILED correction must carry a reason (check constraint)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_correction_failed_has_reason') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'approved_data_corrections is SECURITY DEFINER, not executable by PUBLIC, executable by dsa_app',
       CASE WHEN to_regprocedure('app.approved_data_corrections(integer)') IS NOT NULL
             AND (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.approved_data_corrections(integer)'))
             AND NOT has_function_privilege('public', 'app.approved_data_corrections(integer)', 'EXECUTE')
             AND has_function_privilege('dsa_app', 'app.approved_data_corrections(integer)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END;
