-- tools/sql/0050/backup.sql  — READ-ONLY. Run before migration 0050; save the single JSON result OUTSIDE the repository.
-- It holds everything the migration changes, with enough detail to restore it: the exact role_permission rows, the tables the
-- migration touches, and the definitions of the policies, constraints, columns, row-level-security flags and grants it alters.
-- The result contains user ids and tenant names (no passwords, no secrets): protect the file like production data.
SELECT jsonb_build_object(
  'format', 'dsa-0050-backup-v1',
  'taken_at', now(),
  'database', current_database(),
  'counts', jsonb_build_object(
    'role_permission', (SELECT count(*) FROM app.role_permission),
    'role', (SELECT count(*) FROM app.role),
    'tenant', (SELECT count(*) FROM app.tenant),
    'support_access_grant', (SELECT count(*) FROM app.support_access_grant),
    'data_correction_request', (SELECT count(*) FROM app.data_correction_request),
    'feature_flag', (SELECT count(*) FROM app.feature_flag),
    'master_data_item', (SELECT count(*) FROM app.master_data_item)
  ),
  -- Tables the migration writes to or changes the shape of:
  'role_permission', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tenant_id, t.role_id, t.permission_code), '[]'::jsonb) FROM app.role_permission t),
  'role', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tenant_id, t.id), '[]'::jsonb) FROM app.role t),
  'tenant', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM app.tenant t),
  'support_access_grant', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM app.support_access_grant t),
  'data_correction_request', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM app.data_correction_request t),
  'feature_flag', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.key, t.scope), '[]'::jsonb) FROM app.feature_flag t),
  'master_data_item', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.dataset, t.code), '[]'::jsonb) FROM app.master_data_item t),
  -- Definitions the migration alters, so a rollback can be checked against them:
  'policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname), '[]'::jsonb)
                 FROM pg_policies p WHERE p.schemaname = 'app' AND p.tablename IN ('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request')),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', c.conrelid::regclass::text, 'name', c.conname, 'type', c.contype::text, 'definition', pg_get_constraintdef(c.oid), 'validated', c.convalidated) ORDER BY c.conrelid::regclass::text, c.conname), '[]'::jsonb)
                    FROM pg_constraint c WHERE c.conrelid IN ('app.tenant'::regclass, 'app.support_access_grant'::regclass, 'app.data_correction_request'::regclass)),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) ORDER BY table_name, ordinal_position), '[]'::jsonb)
                FROM information_schema.columns WHERE table_schema = 'app' AND table_name IN ('support_access_grant','data_correction_request','feature_flag','master_data_item','tenant')),
  'rls', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity) ORDER BY relname), '[]'::jsonb)
            FROM pg_class WHERE relnamespace = 'app'::regnamespace AND relname IN ('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request')),
  'table_grants', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'grantee', grantee, 'privilege', privilege_type) ORDER BY table_name, grantee, privilege_type), '[]'::jsonb)
                     FROM information_schema.role_table_grants WHERE table_schema = 'app' AND table_name IN ('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request')),
  'functions', (SELECT coalesce(jsonb_agg(p.proname ORDER BY p.proname), '[]'::jsonb) FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace)
) AS backup;
