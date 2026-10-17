-- Verify migration 0061 (master data and release register). Read-only. Expect every row PASS.
SELECT 'table platform_release exists with forced row-level security' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('app.platform_release') AND relrowsecurity AND relforcerowsecurity) THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'platform_release has the three realm policies',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'platform_release' AND policyname IN ('release_read','release_insert','release_update')) = 3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the candidate release row exists and every gate starts unverified',
       CASE WHEN to_regclass('app.platform_release') IS NOT NULL
             AND (xpath('/row/c/text()', query_to_xml('select count(*) as c from app.platform_release where version = ''v0.1.0-rc.1'' and gates = ''{"rel001":false,"rel002":false,"rel003":false,"rel004":false}''::jsonb', false, true, '')))[1]::text::int = 1
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'baseline master data lists exist (pincodes, states, occupations, reason_codes)',
       CASE WHEN (SELECT count(DISTINCT dataset) FROM app.master_data_item WHERE dataset IN ('pincodes','states','occupations','reason_codes')) = 4 THEN 'PASS' ELSE 'FAIL' END;
