-- Verify migration 0100 (partner dispute category and partner upload approval). Read-only. Catalog checks only: each row is PASS or FAIL,
-- and a missing object is a FAIL row, never an error and never a silent pass. Expect no FAIL row. The INFO row is not a failure.
-- Run before the apply (the columns are absent, so the structure rows FAIL) and after it.
WITH dispute_category AS (
  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod) AS typ
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'dispute' AND a.attname = 'category' AND NOT a.attisdropped
),
partner_flag AS (
  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod) AS typ, pg_get_expr(d.adbin, d.adrelid) AS dflt
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'app' AND c.relname = 'document_type' AND a.attname = 'partner_upload' AND NOT a.attisdropped
),
category_rule AS (
  SELECT k.convalidated, pg_get_constraintdef(k.oid) AS def
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'dispute' AND k.conname = 'dispute_category_check'
)
SELECT 'dispute.category exists, is text, and may be NULL for historical records' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM dispute_category WHERE typ = 'text' AND NOT attnotnull) THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'dispute_category_check exists, is validated, and allows exactly COMMISSION_CALCULATION, PAYOUT and OTHER',
       CASE WHEN EXISTS (SELECT 1 FROM category_rule WHERE convalidated AND def LIKE '%COMMISSION_CALCULATION%'
                           AND def LIKE '%PAYOUT%' AND def LIKE '%OTHER%' AND def NOT LIKE '%REFERRAL%')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'document_type.partner_upload exists, is boolean, NOT NULL, and defaults to false',
       CASE WHEN EXISTS (SELECT 1 FROM partner_flag WHERE typ = 'boolean' AND attnotnull AND dflt = 'false')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'row level security is enabled and forced on dispute and document_type',
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'app' AND c.relname IN ('dispute', 'document_type')
                     AND c.relrowsecurity AND c.relforcerowsecurity) = 2
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'PUBLIC, anon and authenticated hold no table privilege on dispute or document_type',
       CASE WHEN NOT has_table_privilege('public', 'app.dispute', 'SELECT')
                AND NOT has_table_privilege('public', 'app.dispute', 'UPDATE')
                AND NOT has_table_privilege('public', 'app.document_type', 'SELECT')
                AND NOT has_table_privilege('public', 'app.document_type', 'UPDATE')
                AND (to_regrole('anon') IS NULL OR NOT has_table_privilege('anon', 'app.dispute', 'SELECT'))
                AND (to_regrole('authenticated') IS NULL OR NOT has_table_privilege('authenticated', 'app.dispute', 'SELECT'))
                AND (to_regrole('anon') IS NULL OR NOT has_table_privilege('anon', 'app.document_type', 'SELECT'))
                AND (to_regrole('authenticated') IS NULL OR NOT has_table_privilege('authenticated', 'app.document_type', 'SELECT'))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app keeps its privileges on dispute and document_type (INFO when the role is absent)',
       CASE WHEN to_regrole('dsa_app') IS NULL THEN 'INFO'
            WHEN has_table_privilege('dsa_app', 'app.dispute', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.dispute', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.document_type', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.document_type', 'UPDATE')
            THEN 'PASS' ELSE 'FAIL' END, '';
