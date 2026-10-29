-- Verify migration 0090 (notification source event and its unique index). Read-only. Expect every row PASS.
SELECT 'app.notification.source_event_id exists' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'app' AND table_name = 'notification' AND column_name = 'source_event_id')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'unique partial index notification_source_event_uq on (tenant_id, user_id, source_event_id) exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname = 'app' AND indexname = 'notification_source_event_uq'
                            AND indexdef ILIKE '%UNIQUE%(tenant_id, user_id, source_event_id)%')
            THEN 'PASS' ELSE 'FAIL' END;
