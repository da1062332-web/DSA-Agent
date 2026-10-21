-- PREPARED, NOT RUN. Puts back exactly the operator grants that remove-operator-grants-from-customer-roles.v2.sql deletes (the state seen on hosted
-- on 2026-10-19), on the two reviewed roles. Only needed if removing them turns out to be wrong. WRITES. Repeatable (ON CONFLICT DO NOTHING).
BEGIN;
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
  FROM app.role r
  JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
 CROSS JOIN (VALUES ('platform.console'), ('platform.flags'), ('platform.master_data'), ('platform.jobs'), ('platform.support_access'), ('platform.release')) AS p(code)
 WHERE r.id IN ('role_01M4SXZCV20465ZCBDMYGM2410', 'role_01M595WG8J9KP9MCH8Q31C69M3')
ON CONFLICT DO NOTHING;
COMMIT;
