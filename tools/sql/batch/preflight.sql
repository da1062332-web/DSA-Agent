-- Preflight for the hosted migration batch (0054, 0055, 0057 to 0063). Read-only: it changes nothing.
-- For every migration: is it already in place (so applying it again would be a no-op or an error), and are its prerequisites there?
-- Expected on the hosted project before the batch: every "already applied" row is NO and every prerequisite row is PASS.
SELECT 'prerequisite: platform realm function app.is_platform_realm() (0050)' AS item,
       CASE WHEN to_regprocedure('app.is_platform_realm()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'prerequisite: app.feature_flag and app.master_data_item (0046)',
       CASE WHEN to_regclass('app.feature_flag') IS NOT NULL AND to_regclass('app.master_data_item') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite: app.data_correction_request (0045 to 0047, 0050)',
       CASE WHEN to_regclass('app.data_correction_request') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite: app.user_role_assignment with effective_range',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'user_role_assignment' AND column_name = 'effective_range') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite: rules tables (0010) and decision_record',
       CASE WHEN to_regclass('app.rule_set_version') IS NOT NULL AND to_regclass('app.decision_record') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite: role dsa_app exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '0054 already applied? (app.api_client)', CASE WHEN to_regclass('app.api_client') IS NOT NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0055 already applied? (eligibility rule sets)', CASE WHEN EXISTS (SELECT 1 FROM app.rule_set WHERE id LIKE 'rs_elg_%') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0057 already applied? (close-only trigger)', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_role_assignment_close_only' AND NOT tgisinternal) THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0058 already applied? (flag whatsapp.notifications_enabled)', CASE WHEN EXISTS (SELECT 1 FROM app.feature_flag WHERE key = 'whatsapp.notifications_enabled') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0059 already applied? (role_guard trigger)', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_guard' AND NOT tgisinternal) THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0060 already applied? (lead.reopen)', CASE WHEN EXISTS (SELECT 1 FROM app.permission WHERE code = 'lead.reopen') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0061 already applied? (app.platform_release)', CASE WHEN to_regclass('app.platform_release') IS NOT NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0062 already applied? (failure_reason column)', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'data_correction_request' AND column_name = 'failure_reason') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0064 already applied? (loan operations holds sanction.record)', CASE WHEN EXISTS (SELECT 1 FROM app.role r JOIN app.role_permission rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id WHERE r.code = 'ROLE-LOAN-OPS' AND rp.permission_code = 'sanction.record') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0065 still needed? (the invoices table still has its old name ledger_entry)', CASE WHEN to_regclass('app.ledger_entry') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'ledger_entry' AND column_name = 'connector_id') THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0063 already applied? (app.security_event)', CASE WHEN to_regclass('app.security_event') IS NOT NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0054 data step: active users that would be given ROLE-RM (must be 0)', (SELECT count(*)::text FROM app.app_user u WHERE u.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM app.user_role_assignment ura WHERE ura.user_id = u.id AND ura.tenant_id = u.tenant_id) AND EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = u.tenant_id AND r.code = 'ROLE-RM'))
UNION ALL SELECT '0054 data step: role-less test accounts that would be deactivated (must be 0)', (SELECT count(*)::text FROM app.app_user u WHERE u.status = 'ACTIVE' AND u.email LIKE '%test%orphan%' AND NOT EXISTS (SELECT 1 FROM app.user_role_assignment ura WHERE ura.user_id = u.id))
UNION ALL SELECT 'what 0055 would reach: tenants that would get eligibility rules and the override grant', (SELECT count(*)::text FROM app.tenant)
UNION ALL SELECT 'what 0063 would reach: roles that would gain security.incident', (SELECT count(*)::text FROM app.role WHERE code IN ('ROLE-ORG-OWNER','ROLE-COMPLIANCE','ROLE-TENANT-ADMIN'));
