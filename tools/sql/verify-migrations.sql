-- Verification queries copied verbatim from the Database Migration Plan §8 (REL-001, CI `migrate`).
-- Run with `npm run db:verify` after `supabase db reset`.

-- (a) RLS lint: must return zero rows (NFR-SEC-003)
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'app' AND col.table_name = c.relname AND col.column_name = 'tenant_id')
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));

-- (b) No DELETE privilege for dsa_app anywhere: must return zero rows
SELECT table_name FROM information_schema.role_table_grants
WHERE grantee = 'dsa_app' AND privilege_type IN ('DELETE','TRUNCATE');

-- (c) Tables without tenant_id must be on the global allow-list {tenant, permission, decision_definition}
SELECT table_name FROM information_schema.tables t
WHERE table_schema = 'app' AND table_type = 'BASE TABLE'
  AND table_name NOT IN ('tenant','permission','decision_definition')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.column_name = 'tenant_id');

-- (e) Supabase exposure check: must return zero rows (anon/authenticated have no access to schema app)
SELECT grantee, table_name FROM information_schema.role_table_grants
WHERE table_schema = 'app' AND grantee IN ('anon','authenticated','PUBLIC');

-- (d) Fail-closed check, run as dsa_api without SET app.tenant_id: every count must be 0
SELECT (SELECT count(*) FROM lead) + (SELECT count(*) FROM loan_application) + (SELECT count(*) FROM decision_record) AS visible_without_tenant;
