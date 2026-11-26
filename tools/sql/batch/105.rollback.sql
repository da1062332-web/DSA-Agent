-- Roll back migration 0105 (Role merge). Run as the migration owner in one transaction.
-- Note: User role assignments that 0105 ended stay ended per M-057.
-- The snapshot dsa_backup.role_permission_pre_m105 is used to restore exact role permissions.
BEGIN;
SET search_path = app, extensions, public;

-- Revert name of ROLE-SALES-EXEC
UPDATE app.role SET name = 'Sales executive', version = version + 1
 WHERE code = 'ROLE-SALES-EXEC' AND name = 'Telecaller';

-- Revert names of retired roles if kept
UPDATE app.role SET name = 'Document verifier', version = version + 1
 WHERE code = 'ROLE-DOC-VERIFIER' AND name = 'Document verifier (retired)';

UPDATE app.role SET name = 'Rule author', version = version + 1
 WHERE code = 'ROLE-RULE-AUTHOR' AND name = 'Rule author (retired)';

UPDATE app.role SET name = 'Rule approver', version = version + 1
 WHERE code = 'ROLE-RULE-APPROVER' AND name = 'Rule approver (retired)';

UPDATE app.role SET name = 'Commission and Payout Approver', version = version + 1
 WHERE code = 'ROLE-COMMISSION-APPROVER' AND name = 'Commission and Payout Approver (retired)';

-- Restore the original role names from the snapshot when it exists (hosted: dsa_backup.role_pre_m105), so a name that differs from the
-- defaults above (for example "Commission approver") comes back exactly as it was.
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dsa_backup' AND table_name = 'role_pre_m105') THEN
    UPDATE app.role r SET name = b.name
      FROM dsa_backup.role_pre_m105 b
     WHERE b.id = r.id AND b.tenant_id = r.tenant_id
       AND r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER', 'ROLE-SALES-EXEC');
  END IF;
END $;

-- Restore permissions from snapshot table if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dsa_backup' AND table_name = 'role_permission_pre_m105') THEN
    INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
    SELECT b.tenant_id, b.role_id, b.permission_code
      FROM dsa_backup.role_permission_pre_m105 b
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

COMMIT;
