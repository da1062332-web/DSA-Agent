-- Verify migration 0064 (sanction and disbursement grants). Read-only. Expect every row PASS.
-- Note: owner and tenant admin may already hold these on hosted; the point of 0064 is that branch manager and loan operations do too.
SELECT 'the four sanction and disbursement permissions are defined' AS check,
       CASE WHEN (SELECT count(*) FROM app.permission WHERE code IN ('sanction.record','disbursement.record','disbursement.verify','disbursement.exception_approve')) = 4 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'every tenant admin, owner, branch manager and loan operations role holds all four',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r CROSS JOIN (VALUES ('sanction.record'),('disbursement.record'),('disbursement.verify'),('disbursement.exception_approve')) p(code)
          WHERE r.code IN ('ROLE-TENANT-ADMIN','ROLE-ORG-OWNER','ROLE-BRANCH-MGR','ROLE-LOAN-OPS')
            AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = p.code)
       ) THEN 'PASS' ELSE 'FAIL' END;
