-- Roll back migration 0064: take the four sanction and disbursement permissions away from branch manager and loan operations again.
-- Owner and tenant admin keep theirs (hosted already had those before 0064, so they cannot be told apart from this migration's grants),
-- and the permission definitions stay (they were defined before this migration reached hosted).
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.role_permission rp
 USING app.role r
 WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id
   AND r.code IN ('ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
   AND rp.permission_code IN ('sanction.record', 'disbursement.record', 'disbursement.verify', 'disbursement.exception_approve');
COMMIT;
