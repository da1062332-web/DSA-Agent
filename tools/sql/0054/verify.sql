-- Verification suite for migration 0054 (access_control_and_api_clients)
-- Read-only. Returns PASS/FAIL for every post-migration assertion.
SET search_path = app, extensions, public;

WITH checks AS (
  -- 1. Permission check
  SELECT 1 AS ord,
         '1. Permission role.manage exists with introduced_in = MOD-ACL' AS description,
         EXISTS (
           SELECT 1 FROM app.permission WHERE code = 'role.manage' AND introduced_in = 'MOD-ACL'
         ) AS passed

  UNION ALL

  -- 2. Role permission check: every ROLE-TENANT-ADMIN and ROLE-ORG-OWNER holds it (5 roles on hosted at the time of writing)
  SELECT 2,
         '2. role.manage granted to every ROLE-TENANT-ADMIN and ROLE-ORG-OWNER, and to no other role',
         (SELECT count(*) FROM app.role r WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')) > 0
         AND NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')
                           AND NOT EXISTS (SELECT 1 FROM app.role_permission rp
                                            WHERE rp.role_id = r.id AND rp.tenant_id = r.tenant_id AND rp.permission_code = 'role.manage'))
         AND NOT EXISTS (SELECT 1 FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
                          WHERE rp.permission_code = 'role.manage' AND r.code NOT IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER'))

  UNION ALL

  -- 3. Decision definition check
  SELECT 3,
         '3. Decision definition DK-application.eligibility registered and enabled',
         EXISTS (
           SELECT 1 FROM app.decision_definition
           WHERE key = 'DK-application.eligibility'
             AND tier = 'T1'
             AND overridable = true
             AND enabled = true
         )

  UNION ALL

  -- 4. Decision dependency check
  SELECT 4,
         '4. Dependency completeness -> eligibility exists in decision_dependency',
         EXISTS (
           SELECT 1 FROM app.decision_dependency
           WHERE decision_key = 'DK-application.completeness'
             AND depends_on_key = 'DK-application.eligibility'
         )

  UNION ALL

  -- 5. API Client table exists
  SELECT 5,
         '5. app.api_client table exists',
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'app' AND table_name = 'api_client'
         )

  UNION ALL

  -- 6. API Client columns count (16 expected)
  SELECT 6,
         '6. app.api_client has all 16 required columns',
         (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'api_client') = 16

  UNION ALL

  -- 7. RLS enabled on app.api_client
  SELECT 7,
         '7. Row-level security is enabled on app.api_client',
         EXISTS (
           SELECT 1 FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'app' AND c.relname = 'api_client' AND c.relrowsecurity = true
         )

  UNION ALL

  -- 8. RLS forced on app.api_client
  SELECT 8,
         '8. Row-level security is FORCED on app.api_client',
         EXISTS (
           SELECT 1 FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'app' AND c.relname = 'api_client' AND c.relforcerowsecurity = true
         )

  UNION ALL

  -- 9. The only policy is tenant_isolation, it applies to every command, and it compares tenant_id with the session tenant
  SELECT 9,
         '9. app.api_client has exactly one policy: tenant_isolation (all commands, tenant_id = app_tenant())',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename = 'api_client') = 1
         AND EXISTS (
           SELECT 1 FROM pg_policies
           WHERE schemaname = 'app' AND tablename = 'api_client' AND policyname = 'tenant_isolation'
             AND cmd = 'ALL' AND permissive = 'PERMISSIVE'
             AND regexp_replace(qual, '[()[:space:]]|::text|app\.', '', 'g') = 'tenant_id=app_tenant'
         )

  UNION ALL

  -- 10. Table privileges granted to dsa_app
  SELECT 10,
         '10. dsa_app has SELECT, INSERT, UPDATE, DELETE on app.api_client',
         (SELECT count(DISTINCT privilege_type)
          FROM information_schema.role_table_grants
          WHERE table_schema = 'app' AND table_name = 'api_client'
            AND grantee = 'dsa_app'
            AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4

  UNION ALL

  -- 11. Foreign key to app.tenant exists
  SELECT 11,
         '11. Foreign key from api_client.tenant_id to app.tenant(id) exists',
         EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           WHERE tc.table_schema = 'app' AND tc.table_name = 'api_client'
             AND tc.constraint_type = 'FOREIGN KEY'
             AND kcu.column_name = 'tenant_id'
         )

  UNION ALL

  -- 12. Unique constraint on client_id exists
  SELECT 12,
         '12. Unique constraint on client_id exists',
         EXISTS (
           SELECT 1 FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           WHERE tc.table_schema = 'app' AND tc.table_name = 'api_client'
             AND tc.constraint_type = 'UNIQUE'
             AND kcu.column_name = 'client_id'
         )

  UNION ALL

  -- 13. The migration's default-role step assigns ROLE-RM as 'SYSTEM:platform'. On hosted it has no one to assign it to
  --     (the 21 role-less users are in a tenant without ROLE-RM), so none of those assignments may exist in the last hour.
  SELECT 13,
         '13. No default ROLE-RM assignment was created by this run (hosted expectation: none)',
         (SELECT count(*) FROM app.user_role_assignment WHERE created_by = 'SYSTEM:platform' AND created_at > now() - interval '1 hour') = 0

  UNION ALL

  -- 14. Confirm zero orphan test accounts exist
  SELECT 14,
         '14. Zero active test orphan accounts remain',
         (SELECT count(*) FROM app.app_user WHERE email LIKE '%test%orphan%' AND status = 'ACTIVE') = 0
)
SELECT ord,
       description,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY ord;
