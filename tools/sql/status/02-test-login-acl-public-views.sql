-- Read-only confirmation for the hosted status document. Only SELECT. Changes nothing.
SELECT 'ACL of the test-login functions (EXECUTE grants; "=X" means PUBLIC)' AS item,
       jsonb_build_object(
         'lookup_test_user', (SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'lookup_test_user'),
         'list_test_users', (SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'list_test_users')
       ) AS state
UNION ALL SELECT 'public views readable or writable by anon / authenticated (catalog check)',
       jsonb_build_object(
         'views_total', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v'),
         'anon_select', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v' AND has_table_privilege('anon', c.oid, 'SELECT')),
         'authenticated_write', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v' AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE')))
       )
UNION ALL SELECT 'migration 0092 table and columns (expect present when applied)',
       jsonb_build_object(
         'staff_invitation_columns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'staff_invitation'),
         'staff_invitation_one_pending_index', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'staff_invitation_one_pending')
       )
UNION ALL SELECT 'migration 0093 delivery columns (expect present when applied)',
       jsonb_build_object(
         'delivery_state_column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'staff_invitation' AND column_name = 'delivery_state'),
         'due_index', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'staff_invitation_delivery_due')
       )
UNION ALL SELECT 'app.authenticate_user overloads (any signature)',
       jsonb_build_object(
         'overloads', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = 'authenticate_user')
       )
UNION ALL SELECT 'migration ledger rows (supabase_migrations.schema_migrations), if the table exists',
       jsonb_build_object(
         'table_exists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
       );
