-- Verify migration 0075 (customer merge). Read-only. Expect every row PASS.
SELECT 'customer.merged_into_id exists with its check' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'customer' AND column_name = 'merged_into_id') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.customer') AND conname = 'customer_merged_into_check') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'merge_customer_links exists and runs as the caller',
       CASE WHEN to_regprocedure('app.merge_customer_links(text, text, text)') IS NOT NULL AND NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.merge_customer_links(text, text, text)')), false) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app may move the primary flag of a contact point',
       CASE WHEN coalesce((SELECT has_column_privilege('dsa_app', a.attrelid, a.attnum, 'UPDATE') FROM pg_attribute a WHERE a.attrelid = to_regclass('app.customer_contact_point') AND a.attname = 'is_primary' AND NOT a.attisdropped), false) THEN 'PASS' ELSE 'FAIL' END;
