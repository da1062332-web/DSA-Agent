-- Verify migration 0103 (ROLE-VERIFIER retired). Read-only. Each row is PASS, FAIL or INFO; expect no FAIL row. INFO rows are not failures.
-- Run before the apply (the permission and assignment rows FAIL where tenants still hold the role) and after it.
SELECT 'no ROLE-VERIFIER role holds a permission' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role_permission rp JOIN app.role r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id
                              WHERE r.code = 'ROLE-VERIFIER') THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'no open ROLE-VERIFIER assignment',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.user_role_assignment a JOIN app.role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
                              WHERE r.code = 'ROLE-VERIFIER' AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'every remaining ROLE-VERIFIER row is marked retired and has assignment history',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r
                              WHERE r.code = 'ROLE-VERIFIER'
                                AND (r.name <> 'Verification specialist (retired)'
                                     OR NOT EXISTS (SELECT 1 FROM app.user_role_assignment a
                                                     WHERE a.tenant_id = r.tenant_id AND a.role_id = r.id)))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'every assignment written by 0103 is an open ROLE-DOC-VERIFIER assignment',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.user_role_assignment a JOIN app.role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
                              WHERE a.created_by = 'SYSTEM:migration-0103' AND r.code <> 'ROLE-DOC-VERIFIER')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-DOC-VERIFIER still holds document.review and verification.read in every tenant that has it',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r CROSS JOIN (VALUES ('document.review'), ('verification.read')) AS p(code)
                              WHERE r.code = 'ROLE-DOC-VERIFIER'
                                AND NOT EXISTS (SELECT 1 FROM app.role_permission rp
                                                 WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = p.code))
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ROLE-VERIFIER rows kept as retired', 'INFO',
       (SELECT count(*)::text FROM app.role WHERE code = 'ROLE-VERIFIER')
UNION ALL SELECT 'assignments moved to ROLE-DOC-VERIFIER by 0103', 'INFO',
       (SELECT count(*)::text FROM app.user_role_assignment WHERE created_by = 'SYSTEM:migration-0103');
