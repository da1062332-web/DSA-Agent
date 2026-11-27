-- Verify migration 0119 (delete retired roles). Read-only; catalog and row checks only, so it also runs before the apply.
-- Each row is PASS or FAIL. Expect no FAIL row after the apply.
WITH retired(code) AS (
  VALUES ('ROLE-VERIFIER'), ('ROLE-DOC-VERIFIER'), ('ROLE-RULE-AUTHOR'), ('ROLE-RULE-APPROVER'), ('ROLE-COMMISSION-APPROVER')
),
left_over AS (
  SELECT r.tenant_id, r.code
    FROM app.role r
    JOIN retired x ON x.code = r.code
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
)
SELECT 'no customer tenant keeps a retired role' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM left_over) THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT string_agg(DISTINCT code, ', ') FROM left_over), '') AS detail
UNION ALL
SELECT 'no assignment points at a retired role',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM app.user_role_assignment a
                JOIN app.role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
                JOIN retired x ON x.code = r.code)
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'the live roles are still there (owner, RM, loan operations, policy manager)',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM app.tenant t
               WHERE t.tenant_type <> 'PLATFORM'
                 AND EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-ORG-OWNER')
                 AND (SELECT count(*) FROM app.role r WHERE r.tenant_id = t.id
                       AND r.code IN ('ROLE-ORG-OWNER', 'ROLE-RM', 'ROLE-LOAN-OPS', 'ROLE-POLICY-MGR')) < 4)
            THEN 'PASS' ELSE 'FAIL' END, '';
