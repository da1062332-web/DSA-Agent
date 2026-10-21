-- Verify migration 0079 (lender reason map). Read-only. Expect every row PASS.
SELECT 'lender.reason_map exists with its check' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lender' AND column_name = 'reason_map') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.lender') AND conname = 'lender_reason_map_check') THEN 'PASS' ELSE 'FAIL' END AS result;
