-- Roll back migration 0060. Only permissions nobody holds are removed; one that was granted since is kept.
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.permission p
 WHERE p.code IN ('commission.plan.edit','commission.plan.approve','commission.calculate','customer.reveal_sensitive','lead.reopen','lender.read','lender.manage','product.read','product.manage')
   AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.permission_code = p.code);
COMMIT;
