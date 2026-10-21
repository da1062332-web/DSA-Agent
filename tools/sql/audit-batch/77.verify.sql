-- Verify migration 0077 (inbound webhooks). Read-only. Expect every row PASS.
SELECT 'inbound_webhook exists with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.inbound_webhook')) AND relrowsecurity AND relforcerowsecurity) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'received webhooks are append-only',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.inbound_webhook') AND tgname = 'inbound_webhook_append_only' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END;
