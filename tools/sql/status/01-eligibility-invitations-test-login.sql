-- Read-only status of the hosted project for the Eligibility and migration documents. Only SELECT. Changes nothing.
SELECT 'eligibility prerequisites (0048, 0055, 0068)' AS item,
       jsonb_build_object(
         'eligibility_assessment', to_regclass('app.eligibility_assessment') IS NOT NULL,
         'tenant_feature_flag', to_regclass('app.tenant_feature_flag') IS NOT NULL,
         'rule_sets_for_DK_application_eligibility', (SELECT count(*) FROM app.rule_set WHERE decision_key = 'DK-application.eligibility')
       ) AS state
UNION ALL SELECT 'migration 0094 objects (expect all absent)',
       jsonb_build_object(
         'applicant_financial_input', to_regclass('app.applicant_financial_input') IS NOT NULL,
         'eligibility_assessment.input_hash', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'eligibility_assessment' AND column_name = 'input_hash'),
         'flag eligibility.manual_credit_entry', EXISTS (SELECT 1 FROM app.feature_flag WHERE key = 'eligibility.manual_credit_entry')
       )
UNION ALL SELECT 'migration 0092 and 0093 objects (expect absent)',
       jsonb_build_object(
         'staff_invitation', to_regclass('app.staff_invitation') IS NOT NULL,
         'pending_staff_invitation_deliveries', to_regprocedure('app.pending_staff_invitation_deliveries(integer, integer)') IS NOT NULL
       )
UNION ALL SELECT 'migration 0086 functions (test-login lookups)',
       jsonb_build_object(
         'lookup_test_user_exists', to_regprocedure('app.lookup_test_user(text)') IS NOT NULL,
         'list_test_users_exists', to_regprocedure('app.list_test_users()') IS NOT NULL,
         'dsa_app_execute_lookup', CASE WHEN to_regprocedure('app.lookup_test_user(text)') IS NULL THEN NULL ELSE has_function_privilege('dsa_app', 'app.lookup_test_user(text)', 'EXECUTE') END,
         'dsa_app_execute_list', CASE WHEN to_regprocedure('app.list_test_users()') IS NULL THEN NULL ELSE has_function_privilege('dsa_app', 'app.list_test_users()', 'EXECUTE') END,
         'dsa_api_execute_list', CASE WHEN to_regprocedure('app.list_test_users()') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_api') THEN NULL ELSE has_function_privilege('dsa_api', 'app.list_test_users()', 'EXECUTE') END
       )
UNION ALL SELECT 'public schema views and grants (migration 0087, remediation R8)',
       jsonb_build_object(
         'views_in_public', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'v'),
         'anon_grants_on_public', (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'),
         'authenticated_write_grants_on_public', (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE'))
       )
UNION ALL SELECT 'app.authenticate_user and app_user.password_hash (remediation P1-2)',
       jsonb_build_object(
         'authenticate_user_exists', to_regprocedure('app.authenticate_user(text)') IS NOT NULL,
         'password_hash_column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'app_user' AND column_name = 'password_hash')
       )
UNION ALL SELECT 'row-level security on reference tables (remediation P2-5)',
       jsonb_build_object(
         'decision_definition', (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'decision_definition'),
         'decision_dependency', (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'decision_dependency'),
         'permission', (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'permission')
       );
