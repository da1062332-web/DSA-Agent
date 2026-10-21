-- Verify migration 0070 (permission catalogue spec additions). Read-only. Expect every row PASS.
SELECT 'the fifteen permission codes are defined' AS check,
       CASE WHEN (SELECT count(*) FROM app.permission WHERE code IN ('document.view', 'document.download', 'document.waive', 'privacy.manage', 'lead.merge', 'lead.archive', 'application.assign', 'application.close', 'application.withdraw', 'application.reopen', 'task.assign', 'integration.dlq_manage', 'automation.manage', 'automation.operate', 'decision.evaluate')) = 15 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'compliance roles hold privacy.manage',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code = 'ROLE-COMPLIANCE' AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.tenant_id = r.tenant_id AND rp.permission_code = 'privacy.manage')) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'tenant-admin roles hold integration.dlq_manage',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code = 'ROLE-TENANT-ADMIN' AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.tenant_id = r.tenant_id AND rp.permission_code = 'integration.dlq_manage')) THEN 'PASS' ELSE 'FAIL' END;
