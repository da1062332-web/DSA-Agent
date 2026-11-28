-- Verify migration 0111 (application collateral, task P1-03). Read-only. Each row is PASS or FAIL; a missing object is a FAIL row,
-- never an error (no row reads the new table directly, so the script also runs before the apply).
-- Expect no FAIL row after the apply; before it, every row FAILs except the S3-column row, which holds while the table is absent.
WITH t AS (
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'application_collateral'
),
cols AS (
  SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname = 'application_collateral' AND a.attnum > 0 AND NOT a.attisdropped
),
grants AS (
  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
   WHERE table_schema = 'app' AND grantee = 'dsa_app' AND table_name = 'application_collateral'
)
SELECT 'application_collateral exists' AS "check",
       CASE WHEN (SELECT count(*) FROM t) = 1 THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'row level security is on and forced',
       CASE WHEN EXISTS (SELECT 1 FROM t WHERE relrowsecurity AND relforcerowsecurity) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the tenant_isolation policy exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'application_collateral'
                          AND policyname = 'tenant_isolation') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'tenant_id, lock_version and removed_at are present',
       CASE WHEN (SELECT count(*) FROM cols WHERE attname IN ('tenant_id', 'lock_version', 'removed_at')) = 3 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the market value is whole paise (bigint)',
       CASE WHEN EXISTS (SELECT 1 FROM cols WHERE attname = 'estimated_market_value_paise' AND type = 'bigint') THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT type FROM cols WHERE attname = 'estimated_market_value_paise'), 'missing')
UNION ALL SELECT 'no S3-class column (PAN, Aadhaar, registration or deed number)',
       -- "pan" as a whole word only: occupancy_type contains the letters.
       CASE WHEN NOT EXISTS (SELECT 1 FROM cols WHERE attname ~* '(^|_)pan(_|$)' OR attname ILIKE '%aadhaar%'
                              OR attname ILIKE '%registration%' OR attname ILIKE '%deed%')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'live-collateral index exists (application_collateral_app_idx)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'application_collateral_app_idx')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app holds SELECT, INSERT, UPDATE and no DELETE',
       CASE WHEN (SELECT privs FROM grants) = 'INSERT,SELECT,UPDATE' THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT privs FROM grants), 'no grants');
