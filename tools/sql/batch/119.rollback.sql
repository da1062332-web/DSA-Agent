-- Rollback migration 0119 (delete retired roles). Puts back the retired role rows and their ended assignments from the snapshots taken
-- before the apply: dsa_backup.role_pre_m119 and dsa_backup.user_role_assignment_pre_m119. Refuses without them. Grants are not restored:
-- the retired roles held none. Rows already present are left as they are.
BEGIN;
SET search_path = app, extensions, public;

DO $$
BEGIN
  IF to_regclass('dsa_backup.role_pre_m119') IS NULL OR to_regclass('dsa_backup.user_role_assignment_pre_m119') IS NULL THEN
    RAISE EXCEPTION 'Rollback 0119 refused: snapshot dsa_backup.role_pre_m119 or dsa_backup.user_role_assignment_pre_m119 is missing';
  END IF;
END $$;

INSERT INTO role
SELECT s.* FROM dsa_backup.role_pre_m119 s
 WHERE s.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
ON CONFLICT DO NOTHING;

INSERT INTO user_role_assignment
SELECT s.* FROM dsa_backup.user_role_assignment_pre_m119 s
 WHERE EXISTS (SELECT 1 FROM dsa_backup.role_pre_m119 r
                WHERE r.tenant_id = s.tenant_id AND r.id = s.role_id
                  AND r.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER',
                                 'ROLE-COMMISSION-APPROVER'))
ON CONFLICT DO NOTHING;

COMMIT;
