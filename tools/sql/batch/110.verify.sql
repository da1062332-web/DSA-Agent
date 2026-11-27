-- Verify migration 0110 (customer profile, encrypted identity and addresses, task P1-02). Read-only. Each row is PASS or FAIL; a missing
-- object is a FAIL row, never an error. Expect no FAIL row after the apply (before it, the structure rows FAIL).
WITH t AS (
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname IN ('customer_profile', 'customer_identity', 'customer_address')
),
cols AS (
  SELECT c.relname, a.attname
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relname IN ('customer_profile', 'customer_identity', 'customer_address')
     AND a.attnum > 0 AND NOT a.attisdropped
),
grants AS (
  SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
   WHERE table_schema = 'app' AND grantee = 'dsa_app'
     AND table_name IN ('customer_profile', 'customer_identity', 'customer_address')
   GROUP BY table_name
)
SELECT 'the three tables exist' AS "check",
       CASE WHEN (SELECT count(*) FROM t) = 3 THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'row level security is on for all three tables',
       CASE WHEN (SELECT count(*) FROM t WHERE relrowsecurity) = 3 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'every table has tenant_id and lock_version',
       CASE WHEN (SELECT count(*) FROM cols WHERE attname IN ('tenant_id', 'lock_version')) = 6 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'customer_identity has no Aadhaar column and no clear PAN or date-of-birth column',
       CASE WHEN NOT EXISTS (SELECT 1 FROM cols WHERE relname = 'customer_identity'
                              AND (attname ILIKE '%aadhaar%' OR attname IN ('pan', 'dob', 'date_of_birth')))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'customer_identity keeps PAN and date-of-birth parts complete (two CHECK constraints)',
       CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid = 'app.customer_identity'::regclass
                   AND conname IN ('customer_identity_pan_complete', 'customer_identity_dob_complete')) = 2
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'one live address per type (customer_address_one_live_per_type)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'customer_address_one_live_per_type')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'PAN hash index exists (customer_identity_pan_hash_idx)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'customer_identity_pan_hash_idx')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app holds SELECT, INSERT, UPDATE and no DELETE on all three tables',
       CASE WHEN (SELECT count(*) FROM grants WHERE privs = 'INSERT,SELECT,UPDATE') = 3 THEN 'PASS' ELSE 'FAIL' END,
       coalesce((SELECT string_agg(table_name || '=' || privs, '; ') FROM grants), 'no grants')
UNION ALL SELECT 'every customer-tenant ROLE-LOAN-OPS holds customer.reveal_sensitive',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM app.role r JOIN app.tenant tn ON tn.id = r.tenant_id AND tn.tenant_type <> 'PLATFORM'
               WHERE r.code = 'ROLE-LOAN-OPS'
                 AND NOT EXISTS (SELECT 1 FROM app.role_permission rp
                                  WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id
                                    AND rp.permission_code = 'customer.reveal_sensitive'))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'INFO rows stored', 'INFO',
       format('profiles=%s identities=%s addresses=%s',
              (SELECT count(*) FROM app.customer_profile), (SELECT count(*) FROM app.customer_identity),
              (SELECT count(*) FROM app.customer_address));
