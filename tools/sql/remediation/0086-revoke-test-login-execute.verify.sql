-- Read-only check for the 0086 revoke. Only SELECT. Changes nothing.
-- After the revoke, each ACL must have no =X (PUBLIC), no dsa_app and no dsa_api entry. The owner entry (postgres) stays.
SELECT 'test-login function ACL (expect {postgres=X/postgres} after the revoke)' AS item,
       jsonb_build_object(
         'lookup_test_user', (SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'lookup_test_user'),
         'list_test_users', (SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'list_test_users')
       ) AS state;
