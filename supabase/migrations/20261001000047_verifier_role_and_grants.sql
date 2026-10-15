-- Migration: 20261001000047_verifier_role_and_grants.sql
-- Module: MOD-VER (Module 22: Verification)
-- Adds approved verifier roles (ROLE-DOC-VERIFIER, ROLE-VERIFIER) and reconciles verification grants

SET search_path = app, extensions, public;

-- 1. Ensure all canonical verification permissions are registered
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('verification.read', 'Read verification requests and reports', 'MVP-4D'),
  ('verification.create', 'Initiate verification requests', 'MVP-4D'),
  ('verification.update', 'Assign verifiers and update verification progress', 'MVP-4D'),
  ('verification.complete', 'Complete and attest verification decisions', 'MVP-4D'),
  ('verification.perform', 'Perform manual document verification or initiate provider checks', 'TASK-434'),
  ('document.review', 'Review customer document uploads and attest checklist items', 'MVP-4D')
ON CONFLICT (code) DO NOTHING;

-- 2. Seed ROLE-DOC-VERIFIER for every tenant in app.tenant
INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 
  'rol_doc_verifier_' || t.id,
  t.id,
  'ROLE-DOC-VERIFIER',
  'Document verifier',
  false,
  1,
  now(),
  'SYSTEM:migration'
FROM app.tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-DOC-VERIFIER'
);

-- Seed ROLE-VERIFIER (alias / canonical verification specialist role)
INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 
  'rol_verifier_' || t.id,
  t.id,
  'ROLE-VERIFIER',
  'Verification Specialist',
  false,
  1,
  now(),
  'SYSTEM:migration'
FROM app.tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-VERIFIER'
);

-- 3. Grant approved verification permissions to ROLE-DOC-VERIFIER and ROLE-VERIFIER
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('application.read'),
    ('document.review'),
    ('verification.read'),
    ('verification.perform'),
    ('verification.create'),
    ('verification.update'),
    ('verification.complete')
) AS p(code)
WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-VERIFIER')
ON CONFLICT DO NOTHING;

-- 4. Seed ROLE-COMPLIANCE if missing in any tenant and grant standard read permissions
INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 
  'rol_compliance_' || t.id,
  t.id,
  'ROLE-COMPLIANCE',
  'Compliance',
  false,
  1,
  now(),
  'SYSTEM:migration'
FROM app.tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-COMPLIANCE'
);

-- Grant read-only verification permissions to ROLE-COMPLIANCE and ROLE-RM
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'verification.read'
FROM app.role r
WHERE r.code IN ('ROLE-COMPLIANCE', 'ROLE-RM')
ON CONFLICT DO NOTHING;

