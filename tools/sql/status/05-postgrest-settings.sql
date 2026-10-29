-- Read-only: settings that start with pgrst. (PostgREST reads its exposed schemas from these, if the project sets them in SQL.) Only SELECT. Changes nothing.
SELECT 'pgrst settings (role level and database level)' AS item,
       jsonb_build_object(
         'role_level', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', r.rolname, 'settings', r.rolconfig)), '[]'::jsonb)
                        FROM pg_roles r
                        WHERE r.rolconfig IS NOT NULL
                          AND EXISTS (SELECT 1 FROM unnest(r.rolconfig) AS c WHERE c LIKE 'pgrst.%')),
         'database_level', (SELECT coalesce(jsonb_agg(s.setconfig), '[]'::jsonb)
                            FROM pg_db_role_setting s
                            WHERE EXISTS (SELECT 1 FROM unnest(s.setconfig) AS c WHERE c LIKE 'pgrst.%'))
       ) AS state;
