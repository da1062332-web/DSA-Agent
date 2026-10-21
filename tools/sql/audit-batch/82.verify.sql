-- Verify migration 0082 (tenant configuration). Read-only. Expect every row PASS.
SELECT 'the five configuration tables exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.setting'), to_regclass('app.label_set'), to_regclass('app.business_calendar'), to_regclass('app.picklist_value'), to_regclass('app.config_bundle_draft')) AND relrowsecurity AND relforcerowsecurity) = 5 THEN 'PASS' ELSE 'FAIL' END AS result;
