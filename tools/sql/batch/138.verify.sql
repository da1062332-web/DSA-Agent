-- Verify migration 0138 (verification accepts the check type BANK_ACCOUNT, task P1-06). Read-only. Catalog checks only: each row is PASS or
-- FAIL, and a missing object is a FAIL row, never an error and never a silent pass. Expect no FAIL row after the apply; before it the
-- BANK_ACCOUNT row FAILs. INFO rows are not failures.
WITH rule AS (
  SELECT k.conname, k.convalidated, pg_get_constraintdef(k.oid) AS def
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'verification' AND k.contype = 'c' AND pg_get_constraintdef(k.oid) LIKE '%check_type%'
)
SELECT 'exactly one CHECK on verification.check_type exists, and it is validated' AS "check",
       CASE WHEN (SELECT count(*) FROM rule) = 1 AND COALESCE((SELECT bool_and(convalidated) FROM rule), false) THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'the check_type CHECK accepts BANK_ACCOUNT',
       CASE WHEN EXISTS (SELECT 1 FROM rule WHERE def LIKE '%''BANK_ACCOUNT''%') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the check_type CHECK still accepts the nine earlier types (PAN, GST, CIN, ITR, BANK_STATEMENT, BUREAU, IDENTITY_DOCUMENT, EMPLOYMENT, ADDRESS)',
       CASE WHEN EXISTS (SELECT 1 FROM rule
                          WHERE def LIKE '%''PAN''%' AND def LIKE '%''GST''%' AND def LIKE '%''CIN''%' AND def LIKE '%''ITR''%'
                            AND def LIKE '%''BANK_STATEMENT''%' AND def LIKE '%''BUREAU''%' AND def LIKE '%''IDENTITY_DOCUMENT''%'
                            AND def LIKE '%''EMPLOYMENT''%' AND def LIKE '%''ADDRESS''%')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'verification remains append-only (verification_no_mutation trigger is present)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'verification' AND t.tgname = 'verification_no_mutation'
                            AND NOT t.tgisinternal) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'row level security is enabled and forced on verification',
       CASE WHEN COALESCE((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'app' AND c.relname = 'verification'), false) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app can insert and read verification, and cannot update or delete it (INFO when the role is absent)',
       CASE WHEN to_regrole('dsa_app') IS NULL THEN 'INFO'
            WHEN has_table_privilege('dsa_app', 'app.verification', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.verification', 'SELECT')
             AND NOT has_table_privilege('dsa_app', 'app.verification', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.verification', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END, '';
