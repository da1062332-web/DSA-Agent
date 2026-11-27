-- Verify migration 0105 (Role merge: Document verifier -> Loan ops, Rule author/approver -> Lender policy mgr, Commission approver -> Org owner / Finance exec, Sales exec -> Telecaller).
-- Read-only. Each row is PASS, FAIL or INFO; expect no FAIL row. INFO rows are not failures.
SET search_path = app, extensions, public;

SELECT 'no retired role holds a permission' AS "check",
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role_permission rp
         JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
         WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
       ) THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'no open assignment for retired roles',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.user_role_assignment a
         JOIN app.role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
         WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
           AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-POLICY-MGR exists in every customer tenant',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.tenant t
         WHERE t.tenant_type <> 'PLATFORM'
           AND NOT EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-POLICY-MGR')
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-POLICY-MGR holds rule permissions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
         CROSS JOIN (VALUES ('rule.author'), ('rule.simulate'), ('rule.approve'), ('rule.publish'), ('rule.suspend')) AS p(code)
         WHERE r.code = 'ROLE-POLICY-MGR'
           AND NOT EXISTS (
             SELECT 1 FROM app.role_permission rp
             WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = p.code
           )
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-LOAN-OPS holds verification and document review permissions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
         JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
         CROSS JOIN (VALUES ('document.review'), ('verification.perform'), ('verification.create'), ('verification.update'), ('verification.complete')) AS p(code)
         WHERE r.code = 'ROLE-LOAN-OPS'
           AND NOT EXISTS (
             SELECT 1 FROM app.role_permission rp
             WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = p.code
           )
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'Finance executive holds no payout approval codes',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role_permission rp
         JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
         WHERE r.code = 'ROLE-FINANCE-EXEC'
           AND rp.permission_code IN ('payout.approve', 'commission.plan.approve')
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-SALES-EXEC is named Telecaller',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
         WHERE r.code = 'ROLE-SALES-EXEC' AND r.name <> 'Telecaller'
       ) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'assignments moved by 0105', 'INFO',
       (SELECT count(*)::text FROM app.user_role_assignment WHERE created_by = 'SYSTEM:migration-0105');
