-- Post-action check for the partner-login containment (docs/CONNECTOR_CONTAINMENT_RUNBOOK.md). Read-only: only SELECT.
-- Run after the operator has ended the RM assignment through the audited API, and again after any suspension decision.
-- It reports the state; it corrects nothing. An unexpected value is for the owner to decide on, not for this file to fix.
-- Expected values are in the runbook's precondition table. Identifiers are those in the 2026-10-29 audit.
SELECT 'partner login: the RM assignment is ended, its row is kept, and no role is open' AS item,
       jsonb_build_object(
         'assignment', (SELECT jsonb_build_object('id', ura.id, 'role', r.code, 'scope', ura.scope_type,
                                                  'ended', upper(ura.effective_range) <= now(),
                                                  'upper_inf', upper_inf(ura.effective_range))
                          FROM app.user_role_assignment ura
                          JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
                         WHERE ura.id = 'ura_01M613R78QEHGBZZKF8RZPYAV3'),
         'open_roles_on_login', (SELECT count(*) FROM app.user_role_assignment ura
                                  WHERE ura.user_id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'
                                    AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())),
         'role_rows_kept_for_login', (SELECT count(*) FROM app.user_role_assignment ura
                                       WHERE ura.user_id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'login', (SELECT jsonb_build_object('user_type', u.user_type, 'status', u.status, 'connector_id', u.connector_id)
                     FROM app.app_user u WHERE u.id = 'usr_01M613P3AKR8Z5Q81E2F79GY60'),
         'connector_status', (SELECT c.status FROM app.connector c WHERE c.id = 'con_001'),
         'role_ended_event_recorded', (SELECT count(*) FROM app.audit_event a
                                        WHERE a.action = 'role.assignment_ended'
                                          AND a.entity_id = 'ura_01M613R78QEHGBZZKF8RZPYAV3')
       ) AS state
UNION ALL
SELECT 'platform-wide: open role assignments on connector portal logins (expect 0)',
       jsonb_build_object('count', (SELECT count(*) FROM app.user_role_assignment ura
                                      JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
                                     WHERE u.user_type = 'CONNECTOR'
                                       AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())))
UNION ALL
SELECT 'platform-wide: open reserved ROLE-CONNECTOR assignments on staff (expect 0)',
       jsonb_build_object('count', (SELECT count(*) FROM app.user_role_assignment ura
                                      JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
                                      JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
                                     WHERE u.user_type = 'STAFF' AND r.code LIKE 'ROLE-CONNECTOR%'
                                       AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())))
UNION ALL
SELECT 'migration 0097 state (installed = true only after the approved apply)',
       jsonb_build_object('guard_trigger_installed', EXISTS (SELECT 1 FROM pg_trigger
                                                              WHERE tgname = 'user_role_assignment_user_type_guard'
                                                                AND NOT tgisinternal));
