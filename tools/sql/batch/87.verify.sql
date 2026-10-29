-- Verify migration 0087 (public views over the app tables). Read-only. Expect every row PASS, except the INFO row.
SELECT 'public views for tenant, app_user and lead exist with security_invoker = true' AS "check",
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname IN ('tenant', 'app_user', 'lead')
                     AND c.reloptions @> ARRAY['security_invoker=true']) = 3
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'dsa_app has USAGE on schema public',
       CASE WHEN has_schema_privilege('dsa_app', 'public', 'USAGE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'views in public (INFO: 0087 made one per app table that existed on its date; 142 on hosted, 2026-10-29)',
       (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'v');
