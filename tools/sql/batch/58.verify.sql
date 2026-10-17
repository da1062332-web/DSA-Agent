-- Verify migration 0058 (two feature flags). Read-only. Expect every row PASS.
SELECT 'flag crm.lead_auto_qualify exists' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM app.feature_flag WHERE key = 'crm.lead_auto_qualify' AND scope = 'TENANT') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'flag whatsapp.notifications_enabled exists',
       CASE WHEN EXISTS (SELECT 1 FROM app.feature_flag WHERE key = 'whatsapp.notifications_enabled' AND scope = 'GLOBAL') THEN 'PASS' ELSE 'FAIL' END;
