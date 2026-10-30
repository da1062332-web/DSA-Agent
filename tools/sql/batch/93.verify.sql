-- Verify migration 0093 (staff invitation delivery and the worker's function). Read-only. Expect every row PASS.
SELECT 'app.staff_invitation has the six delivery columns of migration 0093' AS "check",
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'app' AND table_name = 'staff_invitation'
                     AND column_name IN ('delivery_state', 'delivery_attempts', 'requested_at', 'next_attempt_at', 'claimed_at', 'claimed_by')) = 6
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'constraint staff_invitation_claim_held exists (a SENDING row names its claim)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_invitation_claim_held')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'index staff_invitation_delivery_due exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'staff_invitation_delivery_due')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'app.pending_staff_invitation_deliveries(integer, integer) exists and is SECURITY DEFINER',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'pending_staff_invitation_deliveries' AND p.prosecdef)
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'PUBLIC, anon, authenticated and service_role cannot execute the worker function',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             WHERE n.nspname = 'app' AND p.proname = 'pending_staff_invitation_deliveries'
                               AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles
                                                                    WHERE rolname IN ('anon', 'authenticated', 'service_role')))
                               AND a.privilege_type = 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can execute the worker function',
       CASE WHEN has_function_privilege('dsa_app', 'app.pending_staff_invitation_deliveries(integer, integer)', 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END;
