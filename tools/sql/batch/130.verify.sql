-- Verify migration 0130 (credit-bureau soft pull, task P1-05). Owner: Prathamesh.
-- Read-only. Each row is PASS, FAIL or INFO; a missing object is a FAIL row, never an error and never a silent pass. Expect no FAIL row
-- after the apply, and FAIL rows before it. INFO rows are not failures.
-- The role/permission pairs below are the same list as the migration's VALUES; migration-0130-credit-report.spec.ts checks they agree.
SET search_path = app, extensions, public;

WITH grants(role_code, permission_code) AS (VALUES
    ('ROLE-LOAN-OPS',   'credit_report.pull'),
    ('ROLE-ORG-OWNER',  'credit_report.pull'),
    ('ROLE-LOAN-OPS',   'credit_report.read'),
    ('ROLE-ORG-OWNER',  'credit_report.read'),
    ('ROLE-RM',         'credit_report.read'),
    ('ROLE-BRANCH-MGR', 'credit_report.read')),
consent_checks AS (
  SELECT k.conname::text AS name, pg_get_constraintdef(k.oid) AS def, k.convalidated
    FROM pg_constraint k
   WHERE k.conrelid = to_regclass('app.consent_record') AND k.contype = 'c'
),
purpose_list AS (SELECT * FROM consent_checks WHERE def LIKE '%''CONTACT''%' AND def LIKE '%''MARKETING''%' AND def NOT LIKE '%purpose_target%'),
target_rule  AS (SELECT * FROM consent_checks WHERE def LIKE '%purpose_target IS NOT NULL%' AND def LIKE '%''VERIFICATION_CHECK''%')
SELECT 'credit_report exists' AS "check",
       CASE WHEN to_regclass('app.credit_report') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'credit_report has the summary columns and no PAN, date of birth or name column',
       CASE WHEN to_regclass('app.credit_report') IS NULL THEN 'FAIL'
            WHEN (SELECT count(*) FROM pg_attribute a
                   WHERE a.attrelid = to_regclass('app.credit_report') AND a.attnum > 0 AND NOT a.attisdropped
                     AND a.attname IN ('customer_id', 'consent_record_id', 'bureau', 'provider', 'outcome', 'report_date', 'score', 'active_accounts',
                                       'monthly_emi_amount', 'max_dpd_12m', 'enquiries_6m', 'vendor_ref', 'cost_amount', 'cost_currency',
                                       'pulled_by', 'pulled_at', 'lock_version')) = 17
             AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                              WHERE a.attrelid = to_regclass('app.credit_report') AND a.attnum > 0 AND NOT a.attisdropped
                                AND a.attname ~* '(pan|birth|dob|name|payload|raw)')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'row-level security is enabled and forced on credit_report, with the tenant_isolation policy',
       CASE WHEN to_regclass('app.credit_report') IS NULL THEN 'FAIL'
            WHEN (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = to_regclass('app.credit_report'))
             AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'credit_report' AND policyname = 'tenant_isolation')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'credit_report is append-only (credit_report_no_mutation trigger is present)',
       CASE WHEN to_regclass('app.credit_report') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('app.credit_report') AND t.tgname = 'credit_report_no_mutation'
                            AND NOT t.tgisinternal) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'PUBLIC, anon and authenticated hold no table privilege on credit_report',
       CASE WHEN to_regclass('app.credit_report') IS NULL THEN 'FAIL'
            WHEN NOT has_table_privilege('public', 'app.credit_report', 'SELECT')
             AND NOT has_table_privilege('public', 'app.credit_report', 'INSERT')
             AND (to_regrole('anon') IS NULL OR NOT has_table_privilege('anon', 'app.credit_report', 'SELECT'))
             AND (to_regrole('authenticated') IS NULL OR NOT has_table_privilege('authenticated', 'app.credit_report', 'SELECT'))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app can insert and read credit_report, and cannot update or delete it (INFO when the role is absent)',
       CASE WHEN to_regclass('app.credit_report') IS NULL THEN 'FAIL'
            WHEN to_regrole('dsa_app') IS NULL THEN 'INFO'
            WHEN has_table_privilege('dsa_app', 'app.credit_report', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.credit_report', 'SELECT')
             AND NOT has_table_privilege('dsa_app', 'app.credit_report', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.credit_report', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'both lookup indexes of credit_report exist',
       CASE WHEN to_regclass('app.credit_report_customer_bureau_idx') IS NOT NULL AND to_regclass('app.credit_report_customer_idx') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'exactly one consent_record CHECK lists the purposes, it is validated, and it accepts BUREAU_PULL',
       CASE WHEN (SELECT count(*) FROM purpose_list) = 1
             AND EXISTS (SELECT 1 FROM purpose_list WHERE convalidated AND def LIKE '%''BUREAU_PULL''%') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the purpose list still accepts the five earlier purposes',
       CASE WHEN EXISTS (SELECT 1 FROM purpose_list
                          WHERE def LIKE '%''CONTACT''%' AND def LIKE '%''LOAN_PROCESSING''%' AND def LIKE '%''SHARE_WITH_LENDER''%'
                            AND def LIKE '%''VERIFICATION_CHECK''%' AND def LIKE '%''MARKETING''%') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'exactly one consent_record CHECK requires purpose_target, it is validated, and it covers BUREAU_PULL as well as the two earlier purposes',
       CASE WHEN (SELECT count(*) FROM target_rule) = 1
             AND EXISTS (SELECT 1 FROM target_rule
                          WHERE convalidated AND def LIKE '%''BUREAU_PULL''%' AND def LIKE '%''SHARE_WITH_LENDER''%'
                            AND def LIKE '%''VERIFICATION_CHECK''%') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the two credit_report permissions are in the catalogue',
       CASE WHEN (SELECT count(*) FROM app.permission WHERE code IN ('credit_report.pull', 'credit_report.read')) = 2
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'every customer-tenant role listed holds its P1-05 permissions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
           JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
           JOIN grants g ON g.role_code = r.code
          WHERE NOT EXISTS (SELECT 1 FROM app.role_permission rp
                             WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = g.permission_code)
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'P1-05 grants held by roles other than the listed ones (an administrator may have added some)', 'INFO',
       (SELECT count(*)::text FROM app.role_permission rp
          JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
         WHERE rp.permission_code IN ('credit_report.pull', 'credit_report.read')
           AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.role_code = r.code AND g.permission_code = rp.permission_code))
UNION ALL SELECT 'credit_report rows', 'INFO',
       -- The table is named inside a string that is run only when it exists: a relation named in the SQL itself is resolved before the CASE runs.
       CASE WHEN to_regclass('app.credit_report') IS NULL THEN 'n/a'
            ELSE (xpath('/row/c/text()', query_to_xml('select count(*) as c from app.credit_report', false, true, '')))[1]::text END;
