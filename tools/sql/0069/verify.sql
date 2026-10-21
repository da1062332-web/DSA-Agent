-- Verify migration 0069 (permission realignment & finance.period_close). Read-only.
-- Expect every row to return PASS.
SET search_path = app, extensions, public;

SELECT 'catalogue: finance.period_close exists in app.permission' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM app.permission WHERE code = 'finance.period_close')
            THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL

SELECT 'grants: all 45 realigned permissions present for tenant qloax-dsa',
       CASE WHEN (
         SELECT count(*)
         FROM app.role_permission rp
         JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
         JOIN app.tenant t ON t.id = rp.tenant_id
         JOIN (
           VALUES
             ('ROLE-BRANCH-MGR', 'lender.read'),
             ('ROLE-COMMISSION-APPROVER', 'lender.read'),
             ('ROLE-COMPLIANCE', 'lender.read'),
             ('ROLE-DOC-VERIFIER', 'lender.read'),
             ('ROLE-FINANCE-EXEC', 'lender.read'),
             ('ROLE-LOAN-OPS', 'lender.read'),
             ('ROLE-ORG-OWNER', 'lender.read'),
             ('ROLE-RM', 'lender.read'),
             ('ROLE-RULE-APPROVER', 'lender.read'),
             ('ROLE-RULE-AUTHOR', 'lender.read'),
             ('ROLE-SALES-EXEC', 'lender.read'),
             ('ROLE-TEAM-MGR', 'lender.read'),
             ('ROLE-TENANT-ADMIN', 'lender.read'),

             ('ROLE-BRANCH-MGR', 'product.read'),
             ('ROLE-COMMISSION-APPROVER', 'product.read'),
             ('ROLE-COMPLIANCE', 'product.read'),
             ('ROLE-DOC-VERIFIER', 'product.read'),
             ('ROLE-FINANCE-EXEC', 'product.read'),
             ('ROLE-LOAN-OPS', 'product.read'),
             ('ROLE-ORG-OWNER', 'product.read'),
             ('ROLE-RM', 'product.read'),
             ('ROLE-RULE-APPROVER', 'product.read'),
             ('ROLE-RULE-AUTHOR', 'product.read'),
             ('ROLE-SALES-EXEC', 'product.read'),
             ('ROLE-TEAM-MGR', 'product.read'),
             ('ROLE-TENANT-ADMIN', 'product.read'),

             ('ROLE-TENANT-ADMIN', 'lender.manage'),
             ('ROLE-ORG-OWNER', 'lender.manage'),

             ('ROLE-TENANT-ADMIN', 'product.manage'),
             ('ROLE-ORG-OWNER', 'product.manage'),

             ('ROLE-FINANCE-EXEC', 'commission.plan.edit'),
             ('ROLE-ORG-OWNER', 'commission.plan.edit'),
             ('ROLE-TENANT-ADMIN', 'commission.plan.edit'),

             ('ROLE-COMMISSION-APPROVER', 'commission.plan.approve'),
             ('ROLE-ORG-OWNER', 'commission.plan.approve'),

             ('ROLE-FINANCE-EXEC', 'commission.calculate'),
             ('ROLE-COMMISSION-APPROVER', 'commission.calculate'),
             ('ROLE-ORG-OWNER', 'commission.calculate'),

             ('ROLE-TEAM-MGR', 'lead.reopen'),
             ('ROLE-BRANCH-MGR', 'lead.reopen'),
             ('ROLE-ORG-OWNER', 'lead.reopen'),

             ('ROLE-COMPLIANCE', 'customer.reveal_sensitive'),
             ('ROLE-ORG-OWNER', 'customer.reveal_sensitive'),

             ('ROLE-FINANCE-EXEC', 'finance.period_close'),
             ('ROLE-ORG-OWNER', 'finance.period_close')
         ) AS p(role_code, permission_code)
           ON r.code = p.role_code AND rp.permission_code = p.permission_code
         WHERE t.slug = 'qloax-dsa'
       ) = 45 THEN 'PASS' ELSE 'FAIL' END

UNION ALL

SELECT 'tenant isolation: 0 new grants added to any tenant other than qloax-dsa',
       CASE WHEN NOT EXISTS (
         SELECT 1
         FROM app.role_permission rp
         JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
         JOIN app.tenant t ON t.id = rp.tenant_id
         WHERE t.slug <> 'qloax-dsa'
           AND rp.permission_code IN ('lender.read', 'product.read', 'lender.manage', 'product.manage',
                                      'commission.plan.edit', 'commission.plan.approve', 'commission.calculate',
                                      'lead.reopen', 'customer.reveal_sensitive', 'finance.period_close')
       ) THEN 'PASS' ELSE 'FAIL' END;
