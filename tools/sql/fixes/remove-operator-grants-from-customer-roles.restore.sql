-- PREPARED, NOT RUN. Puts back exactly the six rows that remove-operator-grants-from-customer-roles.sql deletes (the state seen on hosted on 2026-10-17).
-- Only needed if removing them turns out to be wrong. WRITES.
BEGIN;
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT t.id, 'role_01M4SXZCV20465ZCBDMYGM2410', p.code
  FROM app.tenant t
 CROSS JOIN (VALUES ('platform.console'), ('platform.flags'), ('platform.master_data'), ('platform.jobs'), ('platform.support_access'), ('platform.release')) AS p(code)
 WHERE t.slug = 'demo-alpha'
   AND EXISTS (SELECT 1 FROM app.role r WHERE r.id = 'role_01M4SXZCV20465ZCBDMYGM2410' AND r.tenant_id = t.id)
ON CONFLICT DO NOTHING;
COMMIT;
