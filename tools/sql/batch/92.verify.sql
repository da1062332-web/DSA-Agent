-- Verify migration 0092 (staff invitations). Read-only. Expect every row PASS.
-- Migration 0093 adds six more columns to this table, so this check counts only the fourteen columns of 0092.
SELECT 'app.staff_invitation has the fourteen columns of migration 0092' AS "check",
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'app' AND table_name = 'staff_invitation'
                     AND column_name IN ('id', 'tenant_id', 'user_id', 'status', 'sent_at', 'expires_at', 'accepted_at',
                                         'resend_count', 'last_failure', 'lock_version', 'created_at', 'created_by', 'updated_at', 'updated_by')) = 14
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'one pending invitation per user (partial unique index staff_invitation_one_pending) exists',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'staff_invitation_one_pending'
                          AND indexdef ILIKE '%UNIQUE%WHERE%PENDING%')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'row-level security is enabled on app.staff_invitation',
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'staff_invitation' AND c.relrowsecurity)
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can select, insert and update app.staff_invitation, and cannot delete from it',
       CASE WHEN has_table_privilege('dsa_app', 'app.staff_invitation', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.staff_invitation', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.staff_invitation', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.staff_invitation', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END;
