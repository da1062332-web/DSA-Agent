-- Migration: 20261001000069_permission_realignment_and_period_close.sql
-- Modules: Access Control (RBAC realignment for tenant qloax-dsa)
-- Adds finance.period_close to app.permission catalogue and applies approved grants (Decisions A-H)
-- Limited to tenant 'qloax-dsa' and idempotent (ON CONFLICT DO NOTHING).

SET search_path = app, extensions, public;

-- 1. Ensure catalogue entry for finance.period_close exists
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('finance.period_close', 'Close ledger accounting periods under maker-checker controls', 'GATE-1')
ON CONFLICT (code) DO NOTHING;

-- 2. Insert approved grants for tenant qloax-dsa
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.permission_code
FROM app.role r
JOIN app.tenant t ON t.id = r.tenant_id
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
  ON r.code = p.role_code
WHERE t.slug = 'qloax-dsa'
ON CONFLICT (role_id, permission_code) DO NOTHING;
