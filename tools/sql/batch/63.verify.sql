-- Verify migration 0063 (security events and incidents). Read-only. Expect every row PASS.
SELECT 'tables security_event and incident_record exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.security_event'), to_regclass('app.incident_record')) AND relrowsecurity AND relforcerowsecurity) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'permissions security.incident and security.vuln are defined',
       CASE WHEN (SELECT count(*) FROM app.permission WHERE code IN ('security.incident','security.vuln')) = 2 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'security events are append-only (immutability trigger)',
       CASE WHEN to_regclass('app.security_event') IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.security_event') AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'owner, compliance and tenant-admin roles hold security.incident',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code IN ('ROLE-ORG-OWNER','ROLE-COMPLIANCE','ROLE-TENANT-ADMIN')
                              AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = 'security.incident')) THEN 'PASS' ELSE 'FAIL' END;
