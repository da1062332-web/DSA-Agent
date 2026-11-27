-- Rollback migration 0118 (customer edit grants). Removes only the grants 0118 added: a grant that was already there before the apply is
-- kept, using the snapshot dsa_backup.role_permission_pre_m118 taken before the apply. Refuses without that snapshot, because without it
-- an earlier grant (for example the owner's customer.reveal_sensitive from M-085 on a fresh database) could not be told apart.
BEGIN;
SET search_path = app, extensions, public;

DO $$
BEGIN
  IF to_regclass('dsa_backup.role_permission_pre_m118') IS NULL THEN
    RAISE EXCEPTION 'Rollback 0118 refused: snapshot dsa_backup.role_permission_pre_m118 is missing';
  END IF;
END $$;

DELETE FROM role_permission rp
 USING role r
 WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id
   AND (r.code, rp.permission_code) IN (('ROLE-RM', 'customer.update'), ('ROLE-LOAN-OPS', 'customer.read'),
                                        ('ROLE-LOAN-OPS', 'customer.update'), ('ROLE-ORG-OWNER', 'customer.reveal_sensitive'))
   AND NOT EXISTS (SELECT 1 FROM dsa_backup.role_permission_pre_m118 s
                    WHERE s.tenant_id = rp.tenant_id AND s.role_id = rp.role_id AND s.permission_code = rp.permission_code);

COMMIT;
