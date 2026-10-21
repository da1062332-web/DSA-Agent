-- Verify migration 0076 (webhook delivery). Read-only. Expect every row PASS.
SELECT 'webhook_subscription has secret_ciphertext and last_failure_at' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_subscription' AND column_name = 'secret_ciphertext') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_subscription' AND column_name = 'last_failure_at') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'subscriptions may be FAILING',
       CASE WHEN coalesce(position('FAILING' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = to_regclass('app.webhook_subscription') AND conname = 'webhook_subscription_status_check'))) > 0, false) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'one delivery per subscription and event',
       CASE WHEN to_regclass('app.webhook_delivery_once_uq') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'delivery log has last_error and updated_at',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_delivery_log' AND column_name = 'last_error') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_delivery_log' AND column_name = 'updated_at') THEN 'PASS' ELSE 'FAIL' END;
