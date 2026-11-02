-- Verify migration 0102 (a partner dispute must have a category). Read-only. Catalog checks only: each row is PASS or FAIL, and a missing
-- object is a FAIL row. Expect no FAIL row. The INFO row says whether historical rows have been validated; it is not a failure.
WITH rule AS (
  SELECT k.convalidated, pg_get_constraintdef(k.oid) AS def
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'dispute' AND k.conname = 'dispute_partner_category_required' AND k.contype = 'c'
)
SELECT 'dispute_partner_category_required exists and requires a category for CONNECTOR disputes' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM rule WHERE def LIKE '%CONNECTOR%' AND def LIKE '%category IS NOT NULL%') THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'the rule applies to new rows (it is not disabled)',
       CASE WHEN EXISTS (SELECT 1 FROM rule WHERE def LIKE '%CONNECTOR%') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'historical partner disputes are validated against the rule (INFO: NOT VALID until a backfill decision is taken)',
       CASE WHEN EXISTS (SELECT 1 FROM rule WHERE convalidated) THEN 'PASS' ELSE 'INFO' END, '';
