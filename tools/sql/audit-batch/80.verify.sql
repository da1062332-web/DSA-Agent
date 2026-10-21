-- Verify migration 0080 (BRE reference lists). Read-only. Expect every row PASS.
SELECT 'reference_list and reference_list_version exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.reference_list'), to_regclass('app.reference_list_version')) AND relrowsecurity AND relforcerowsecurity) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'published versions are immutable',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.reference_list_version') AND tgname = 'reference_list_version_append_only' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END;
