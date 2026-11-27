-- Verify migration 0118 (customer edit grants, P1-02 follow-up). Read-only; catalog and grant checks only, so it also runs before the apply.
-- Each row is PASS or FAIL. Expect no FAIL row after the apply.
WITH wanted(role_code, permission_code) AS (
  VALUES ('ROLE-RM', 'customer.update'), ('ROLE-LOAN-OPS', 'customer.read'), ('ROLE-LOAN-OPS', 'customer.update'),
         ('ROLE-ORG-OWNER', 'customer.reveal_sensitive')
),
missing AS (
  SELECT w.role_code, w.permission_code, r.tenant_id
    FROM wanted w
    JOIN app.role r ON r.code = w.role_code
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
   WHERE NOT EXISTS (SELECT 1 FROM app.role_permission rp
                      WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = w.permission_code)
)
SELECT 'every customer-tenant role holds its 0118 grant' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM missing) THEN 'PASS' ELSE 'FAIL' END AS result,
       coalesce((SELECT string_agg(DISTINCT role_code || ' ' || permission_code, '; ') FROM missing), '') AS detail
UNION ALL SELECT 'the platform realm holds none of the 0118 grants',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM app.role_permission rp
                JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
                JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type = 'PLATFORM'
                JOIN wanted w ON w.role_code = r.code AND w.permission_code = rp.permission_code)
            THEN 'PASS' ELSE 'FAIL' END, '';
