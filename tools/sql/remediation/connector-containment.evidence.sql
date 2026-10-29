-- Evidence export for the partner-login containment (docs/CONNECTOR_CONTAINMENT_RUNBOOK.md, section 4). Read-only: only SELECT.
-- PREPARED, NOT RUN. Run only after checkpoint C5 is approved in writing, against the linked project, and keep the output with the
-- owner. It returns metadata only: no task titles or completion notes, no IP addresses, no user-agent strings, no tokens.
-- Client details are reduced to three booleans and three families. Record the SHA-256 of the saved output with the export.
SELECT 'assignment and login (state before any action)' AS item,
       jsonb_build_object(
         'assignment', (SELECT jsonb_build_object('id', ura.id, 'role_id', ura.role_id, 'scope', ura.scope_type,
                                                  'created_by', ura.created_by, 'open_ended', upper_inf(ura.effective_range),
                                                  'created_at', lower(ura.effective_range))
                          FROM app.user_role_assignment ura WHERE ura.id = 'ura_01M613R78QEHGBZZKF8RZPYAV3'),
         'login', (SELECT jsonb_build_object('user_type', u.user_type, 'status', u.status, 'connector_id', u.connector_id,
                                             'updated_at', u.updated_at)
                     FROM app.app_user u WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'connector', (SELECT jsonb_build_object('id', c.id, 'status', c.status, 'relationship_owner_user_id', c.relationship_owner_user_id)
                         FROM app.connector c WHERE c.id = 'con_001')
       ) AS state
UNION ALL
SELECT 'audit events about the login, its assignment or its connector (metadata only)',
       jsonb_build_object(
         'events', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'occurred_at', a.occurred_at, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
                      'actor_id', a.actor_id, 'loopback', (a.ip::text IN ('::1', '127.0.0.1')),
                      'browser', CASE WHEN a.user_agent ILIKE '%Chrome%' THEN 'chrome'
                                      WHEN a.user_agent IS NULL THEN 'none' ELSE 'other' END,
                      'os', CASE WHEN a.user_agent ILIKE '%Windows%' THEN 'windows' ELSE 'other' END)
                    ORDER BY a.occurred_at), '[]'::jsonb)
                    FROM app.audit_event a
                   WHERE a.actor_id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'
                      OR a.entity_id IN ('ura_01M613R78QEHGBZZKF8RZPYAV3', 'usr_01M613P3AKR8Z5Q81E2F79GY60', 'con_001'))
       )
UNION ALL
SELECT 'the partner task (metadata only; title and completion note are not read)',
       jsonb_build_object(
         'task', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'type', t.type, 'status', t.status, 'priority', t.priority, 'linked_type', t.linked_type,
                    'linked_id', t.linked_id, 'owner_user_id', t.owner_user_id, 'created_by', t.created_by,
                    'created_by_source', t.created_by_source, 'created_at', t.created_at, 'completed_at', t.completed_at)), '[]'::jsonb)
                    FROM app.task t WHERE t.id = 'task_01M614QYZPY26HF1WZVN0TRB6Q')
       )
UNION ALL
SELECT 'records the login created or changed, by kind and day (counts only)',
       jsonb_build_object(
         'by_action_and_day', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'day', x.day, 'events', x.n)
                                 ORDER BY x.day, x.action), '[]'::jsonb)
                                 FROM (SELECT a.action, date_trunc('day', a.occurred_at) AS day, count(*) AS n
                                         FROM app.audit_event a
                                        WHERE a.actor_id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'
                                        GROUP BY a.action, date_trunc('day', a.occurred_at)) x)
       )
UNION ALL
SELECT 'sign-in sessions of the login (counts and times only; no tokens)',
       jsonb_build_object(
         'sessions', (SELECT count(*) FROM auth.sessions s JOIN auth.users au ON au.id = s.user_id
                       JOIN app.app_user u ON au.id::text = u.idp_subject WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'first_session_at', (SELECT min(s.created_at) FROM auth.sessions s JOIN auth.users au ON au.id = s.user_id
                               JOIN app.app_user u ON au.id::text = u.idp_subject WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'last_session_at', (SELECT max(s.created_at) FROM auth.sessions s JOIN auth.users au ON au.id = s.user_id
                              JOIN app.app_user u ON au.id::text = u.idp_subject WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'last_sign_in_at', (SELECT max(au.last_sign_in_at) FROM auth.users au
                              JOIN app.app_user u ON au.id::text = u.idp_subject WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60')
       );
