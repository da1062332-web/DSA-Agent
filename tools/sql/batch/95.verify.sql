-- Verify migration 0095 (PUBLIC's EXECUTE removed from schema app). Read-only. Expect every row PASS, except the INFO row.
-- The routine names are the 24 that PUBLIC could execute on 2026-10-29. Requires the Supabase roles anon, authenticated and dsa_app.
SELECT 'no routine in schema app is executable by PUBLIC' AS "check",
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             WHERE n.nspname = 'app' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'anon and authenticated cannot execute any routine in schema app',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app'
                                AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app holds an explicit EXECUTE on each of the 24 routines that PUBLIC could run',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'app'
                                AND p.proname IN ('app_tenant', 'application_party_remove_only', 'apply_attribution_change',
                                                  'audit_event_seal_guard', 'check_journal_balance', 'consent_only_withdraw',
                                                  'document_version_content_guard', 'enable_tenant_rls', 'forbid_delete',
                                                  'forbid_mutation', 'is_platform_realm', 'lead_attribution_immutable',
                                                  'ledger_journal_guard', 'lender_query_answer_once', 'message_template_guard',
                                                  'new_ulid', 'package_freeze_guard', 'platform_require_realm',
                                                  'product_version_terms_immutable', 'role_guard', 'role_permission_guard',
                                                  'rsv_immutable_after_draft', 'touch_row', 'user_role_assignment_close_only')
                                AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                                 WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'dsa_app')
                                                   AND a.privilege_type = 'EXECUTE'))
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'INFO (not a pass or fail): routines in schema app that dsa_app can execute now',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND has_function_privilege('dsa_app', p.oid, 'EXECUTE'));
