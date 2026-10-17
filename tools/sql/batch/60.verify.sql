-- Verify migration 0060 (permission catalogue completion). Read-only. Expect every row PASS.
SELECT 'nine permissions are defined' AS check,
       CASE WHEN (SELECT count(*) FROM app.permission WHERE code IN ('commission.plan.edit','commission.plan.approve','commission.calculate','customer.reveal_sensitive','lead.reopen','lender.read','lender.manage','product.read','product.manage')) = 9 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'none of them is granted to any role (by design)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role_permission WHERE permission_code IN ('commission.plan.edit','commission.plan.approve','commission.calculate','customer.reveal_sensitive','lead.reopen','lender.read','lender.manage','product.read','product.manage')) THEN 'PASS' ELSE 'FAIL' END;
