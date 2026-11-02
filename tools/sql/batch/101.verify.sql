-- Verify migration 0101 (a verification record can be about a connector). Read-only. Catalog checks only: each row is PASS or FAIL, and a
-- missing object is a FAIL row, never an error and never a silent pass. Expect no FAIL row. INFO rows are not failures.
-- Run before the apply (the column is absent, so the structure rows FAIL) and after it.
WITH col AS (
  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod) AS typ
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'verification' AND a.attname = 'connector_id' AND NOT a.attisdropped
),
subject_rule AS (
  SELECT k.convalidated, pg_get_constraintdef(k.oid) AS def
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'verification' AND k.conname = 'verification_subject_type_check'
),
fk AS (
  SELECT k.convalidated, (k.confrelid = 'app.connector'::regclass) AS points_at_connector, array_length(k.conkey, 1) AS width
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'verification' AND k.conname = 'verification_connector_fk' AND k.contype = 'f'
),
combo AS (
  SELECT k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'verification' AND k.conname = 'verification_connector_subject_check' AND k.contype = 'c'
)
SELECT 'verification.connector_id exists, is text, and may be NULL for every existing record' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM col WHERE typ = 'text' AND NOT attnotnull) THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'verification_subject_type_check accepts CONNECTOR and still accepts the three existing subjects',
       CASE WHEN EXISTS (SELECT 1 FROM subject_rule WHERE convalidated AND def LIKE '%CONNECTOR%' AND def LIKE '%CUSTOMER%'
                           AND def LIKE '%LOAN_APPLICATION%' AND def LIKE '%LEAD%')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'verification_connector_fk exists, is validated, and points at connector (tenant_id, id)',
       CASE WHEN EXISTS (SELECT 1 FROM fk WHERE convalidated AND points_at_connector AND width = 2) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'verification_connector_subject_check exists and is validated (a CONNECTOR subject names its own connector)',
       CASE WHEN EXISTS (SELECT 1 FROM combo WHERE convalidated) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'verification_connector_idx exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'verification'
                          AND indexname = 'verification_connector_idx') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'verification remains append-only (verification_no_mutation trigger is present)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'verification' AND t.tgname = 'verification_no_mutation'
                            AND NOT t.tgisinternal) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'row level security is enabled and forced on verification',
       CASE WHEN (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'app' AND c.relname = 'verification') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'PUBLIC, anon and authenticated hold no table privilege on verification',
       CASE WHEN NOT has_table_privilege('public', 'app.verification', 'SELECT')
                AND NOT has_table_privilege('public', 'app.verification', 'INSERT')
                AND (to_regrole('anon') IS NULL OR NOT has_table_privilege('anon', 'app.verification', 'SELECT'))
                AND (to_regrole('authenticated') IS NULL OR NOT has_table_privilege('authenticated', 'app.verification', 'SELECT'))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app can insert and read verification, and cannot update or delete it (INFO when the role is absent)',
       CASE WHEN to_regrole('dsa_app') IS NULL THEN 'INFO'
            WHEN has_table_privilege('dsa_app', 'app.verification', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.verification', 'SELECT')
             AND NOT has_table_privilege('dsa_app', 'app.verification', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.verification', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'migration 0097 role guard is still installed (connector users stay role-less)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'user_role_assignment' AND t.tgname = 'user_role_assignment_user_type_guard'
                            AND NOT t.tgisinternal) THEN 'PASS' ELSE 'FAIL' END, '';
