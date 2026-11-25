-- Roll back migration 0103 (ROLE-VERIFIER retired). Run as the migration owner, in one transaction.
-- Brings the role back as M-047 made it: for every tenant that M-047 seeded (its ROLE-DOC-VERIFIER row has the M-047 id), with the
-- name "Verification Specialist" and the same seven permissions.
-- What it does not undo: assignments that 0103 ended stay ended (M-057 lets an assignment close, never reopen), and the
-- ROLE-DOC-VERIFIER assignments that 0103 wrote stay. Reassign people by hand if the role is wanted back.
BEGIN;
SET search_path = app, extensions, public;

INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 'rol_verifier_' || d.tenant_id, d.tenant_id, 'ROLE-VERIFIER', 'Verification Specialist', false, 1, now(), 'SYSTEM:rollback-0103'
  FROM app.role d
 WHERE d.code = 'ROLE-DOC-VERIFIER' AND d.id = 'rol_doc_verifier_' || d.tenant_id
   AND NOT EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = d.tenant_id AND r.code = 'ROLE-VERIFIER');

UPDATE app.role SET name = 'Verification Specialist', version = version + 1
 WHERE code = 'ROLE-VERIFIER' AND name = 'Verification specialist (retired)';

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
  FROM app.role r
 CROSS JOIN (VALUES ('application.read'), ('document.review'), ('verification.read'), ('verification.perform'),
                    ('verification.create'), ('verification.update'), ('verification.complete')) AS p(code)
 WHERE r.code = 'ROLE-VERIFIER'
ON CONFLICT DO NOTHING;

COMMIT;
