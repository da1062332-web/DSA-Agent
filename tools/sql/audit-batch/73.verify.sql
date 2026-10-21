-- Verify migration 0073 (user lifecycle hand-over). Read-only. Expect every row PASS.
SELECT 'new_ulid() exists' AS check,
       CASE WHEN to_regprocedure('app.new_ulid()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'handover_owned_records exists and runs as the caller',
       CASE WHEN to_regprocedure('app.handover_owned_records(text, text, text)') IS NOT NULL AND NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.handover_owned_records(text, text, text)')), false) THEN 'PASS' ELSE 'FAIL' END;
