-- Verify migration 0120 (P1-04 lender policy grid and multi-lender matching). Owner: Dipanshu.
-- Read-only. Each row is PASS, FAIL or INFO; expect no FAIL row after the apply (and FAIL rows before it).
-- The role/permission pairs below are the same list as the migration's VALUES; the rehearsal test checks they agree.
SET search_path = app, extensions, public;

WITH tables(name) AS (VALUES ('lender_policy'), ('lender_match_run'), ('lender_match_result')),
grants(role_code, permission_code) AS (VALUES
    ('ROLE-ORG-OWNER',  'lender_policy.read'),
    ('ROLE-ORG-OWNER',  'lender_policy.manage'),
    ('ROLE-ORG-OWNER',  'lender_match.run'),
    ('ROLE-ORG-OWNER',  'rule.approve'),
    ('ROLE-POLICY-MGR', 'lender_policy.read'),
    ('ROLE-POLICY-MGR', 'lender_policy.manage'),
    ('ROLE-LOAN-OPS',   'lender_policy.read'),
    ('ROLE-LOAN-OPS',   'lender_match.run'),
    ('ROLE-BRANCH-MGR', 'lender_policy.read'),
    ('ROLE-BRANCH-MGR', 'lender_match.run'),
    ('ROLE-RM',         'lender_policy.read'),
    ('ROLE-RM',         'lender_match.run'))
SELECT 'the three tables exist' AS "check",
       CASE WHEN (SELECT count(*) FROM tables WHERE to_regclass('app.' || name) IS NOT NULL) = 3
            THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'row-level security is enabled and forced on the three tables',
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'app' AND c.relname IN (SELECT name FROM tables)
                     AND c.relrowsecurity AND c.relforcerowsecurity) = 3
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'each table has the tenant_isolation policy',
       CASE WHEN (SELECT count(*) FROM pg_policies
                   WHERE schemaname = 'app' AND tablename IN (SELECT name FROM tables) AND policyname = 'tenant_isolation') = 3
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'dsa_app cannot update or delete match history, nor delete policies',
       -- CASE branches run in order, so has_table_privilege is never called on a table that does not exist yet.
       CASE WHEN to_regclass('app.lender_match_run') IS NULL OR to_regclass('app.lender_match_result') IS NULL
              OR to_regclass('app.lender_policy') IS NULL THEN 'FAIL'
            WHEN NOT has_table_privilege('dsa_app', 'app.lender_match_run', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.lender_match_run', 'DELETE')
             AND NOT has_table_privilege('dsa_app', 'app.lender_match_result', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.lender_match_result', 'DELETE')
             AND NOT has_table_privilege('dsa_app', 'app.lender_policy', 'DELETE')
             AND has_table_privilege('dsa_app', 'app.lender_policy', 'UPDATE')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'at most one ACTIVE policy per lender and product version (unique index)',
       CASE WHEN to_regclass('app.lender_policy_one_active_uq') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the three permissions are in the catalogue',
       CASE WHEN (SELECT count(*) FROM app.permission
                   WHERE code IN ('lender_policy.read', 'lender_policy.manage', 'lender_match.run')) = 3
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'every customer-tenant role listed holds its P1-04 permissions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
           JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
           JOIN grants g ON g.role_code = r.code
          WHERE NOT EXISTS (SELECT 1 FROM app.role_permission rp
                             WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = g.permission_code)
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'no other role holds a P1-04 permission',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role_permission rp
           JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
          WHERE rp.permission_code IN ('lender_policy.read', 'lender_policy.manage', 'lender_match.run')
            AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.role_code = r.code AND g.permission_code = rp.permission_code)
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'P1-04 grants held', 'INFO',
       (SELECT count(*)::text FROM app.role_permission
         WHERE permission_code IN ('lender_policy.read', 'lender_policy.manage', 'lender_match.run'));
