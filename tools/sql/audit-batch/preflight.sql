-- Preflight for the audit migration batch (0066, 0069 to 0084). READ-ONLY. Run against the linked project before applying.
-- Rows "prerequisite ..." must all be PASS. Rows "00NN still needed" answer YES (apply it) or NO (already there), judged by an object
-- the migration creates. The "info" rows show what already exists that a migration would leave alone (ON CONFLICT DO NOTHING).
SELECT 'prerequisite 0050 platform realm (is_platform_realm)' AS item,
       CASE WHEN to_regprocedure('app.is_platform_realm()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'prerequisite 0067 outbox relay (pending_outbox_events, dead_lettered_at)',
       CASE WHEN to_regprocedure('app.pending_outbox_events(integer)') IS NOT NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'outbox_event' AND column_name = 'dead_lettered_at')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite 0068 tenant feature flags',
       CASE WHEN to_regclass('app.tenant_feature_flag') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite 0037 webhook tables',
       CASE WHEN to_regclass('app.webhook_subscription') IS NOT NULL AND to_regclass('app.webhook_delivery_log') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'prerequisite 0027 connector table',
       CASE WHEN to_regclass('app.connector') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '0066 still needed (lender_query)',
       CASE WHEN to_regclass('app.lender_query') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0069 still needed (worker_queue_state)',
       CASE WHEN to_regclass('app.worker_queue_state') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0070 still needed (permission codes of the audit)',
       CASE WHEN EXISTS (SELECT 1 FROM app.permission WHERE introduced_in = 'AUDIT-2026-10-19') THEN 'NO' ELSE 'YES' END
UNION ALL SELECT '0071 still needed (documents)',
       CASE WHEN to_regclass('app.document_version') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0072 still needed (application_party.removed_at)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'application_party' AND column_name = 'removed_at') THEN 'NO' ELSE 'YES' END
UNION ALL SELECT '0073 still needed (handover_owned_records)',
       CASE WHEN to_regprocedure('app.handover_owned_records(text, text, text)') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0074 still needed (apply_link)',
       CASE WHEN to_regclass('app.apply_link') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0075 still needed (customer.merged_into_id)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'customer' AND column_name = 'merged_into_id') THEN 'NO' ELSE 'YES' END
UNION ALL SELECT '0076 still needed (webhook_subscription.secret_ciphertext)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_subscription' AND column_name = 'secret_ciphertext') THEN 'NO' ELSE 'YES' END
UNION ALL SELECT '0077 still needed (inbound_webhook)',
       CASE WHEN to_regclass('app.inbound_webhook') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0078 still needed (retention_policy)',
       CASE WHEN to_regclass('app.retention_policy') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0079 still needed (lender.reason_map)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lender' AND column_name = 'reason_map') THEN 'NO' ELSE 'YES' END
UNION ALL SELECT '0080 still needed (reference_list)',
       CASE WHEN to_regclass('app.reference_list') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0081 still needed (access_review)',
       CASE WHEN to_regclass('app.access_review') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0082 still needed (setting)',
       CASE WHEN to_regclass('app.setting') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0083 still needed (tenant_offboarding)',
       CASE WHEN to_regclass('app.tenant_offboarding') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT '0084 still needed (referral_consent_otp)',
       CASE WHEN to_regclass('app.referral_consent_otp') IS NULL THEN 'YES' ELSE 'NO' END
UNION ALL SELECT 'info 0070 codes that already exist (kept as they are)',
       coalesce((SELECT string_agg(code, ', ' ORDER BY code) FROM app.permission
                  WHERE code IN ('document.view','document.download','document.waive','privacy.manage','lead.merge','lead.archive',
                                 'application.assign','application.close','application.withdraw','application.reopen','task.assign',
                                 'integration.dlq_manage','automation.manage','automation.operate','decision.evaluate')
                    AND introduced_in <> 'AUDIT-2026-10-19'), 'none')
UNION ALL SELECT 'info 0083 platform.tenant codes that already exist (kept as they are)',
       coalesce((SELECT string_agg(code, ', ' ORDER BY code) FROM app.permission WHERE code LIKE 'platform.tenant.%' AND introduced_in <> 'M-083'), 'none');
