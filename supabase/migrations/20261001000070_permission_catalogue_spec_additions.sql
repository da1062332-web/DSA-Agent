-- Migration: 20261001000070_permission_catalogue_spec_additions.sql
-- Owner: Dev 1 (Module 5: access control)
-- Permission codes named by the DSA module pages but missing from the catalogue, needed by endpoints built in the 2026-10-19
-- audit follow-up. Each is defined, then granted to the tenant roles the module page names (role_permission is per tenant role,
-- so every existing tenant role with that code receives it; new tenants get them from seeds/demo/platform.ts).
--   MOD-DOC (Module 20):  document.view, document.download (ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-RM, ROLE-LOAN-OPS,
--                         ROLE-DOC-VERIFIER; ROLE-COMPLIANCE view), document.waive (ROLE-BRANCH-MGR, ROLE-LOAN-OPS)
--   MOD-PRV (Module 38):  privacy.manage (ROLE-COMPLIANCE)
--   MOD-LEAD (Module 7):  lead.merge, lead.archive (ROLE-ORG-OWNER, ROLE-BRANCH-MGR)
--   MOD-APP (Module 16):  application.assign (ORG-OWNER, BRANCH-MGR, TEAM-MGR), application.close (ORG-OWNER, BRANCH-MGR,
--                         LOAN-OPS), application.withdraw (RM, TEAM-MGR, BRANCH-MGR, LOAN-OPS, ORG-OWNER),
--                         application.reopen (TEAM-MGR, BRANCH-MGR, ORG-OWNER)
--   MOD-TASK (Module 9):  task.assign (TEAM-MGR, BRANCH-MGR, ORG-OWNER)
--   MOD-INT (Module 35):  integration.dlq_manage (ROLE-TENANT-ADMIN)
--   MOD-WFA (Module 24):  automation.manage, automation.operate (ROLE-TENANT-ADMIN)
--   MOD-BRE (Module 23):  decision.evaluate (defined only; evaluations are made by the system for the calling module)

SET search_path = app, extensions, public;

INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('document.view',          'View document metadata and short-lived view links (logged)',            'AUDIT-2026-10-19'),
  ('document.download',      'Download a document version (logged, with step-up for S3 documents)',        'AUDIT-2026-10-19'),
  ('document.waive',         'Waive or mark a checklist document as not applicable, with a reason',   'AUDIT-2026-10-19'),
  ('privacy.manage',         'Legal holds, retention policies and data-subject requests',              'AUDIT-2026-10-19'),
  ('lead.merge',             'Review duplicate pairs and merge or dismiss them',                       'AUDIT-2026-10-19'),
  ('lead.archive',           'Archive and restore leads',                                              'AUDIT-2026-10-19'),
  ('application.assign',     'Assign the operations owner or queue of an application',                 'AUDIT-2026-10-19'),
  ('application.close',      'Close a disbursed or terminal application',                              'AUDIT-2026-10-19'),
  ('application.withdraw',   'Withdraw an application at the customer''s request',                     'AUDIT-2026-10-19'),
  ('application.reopen',     'Reopen a cancelled or withdrawn application',                            'AUDIT-2026-10-19'),
  ('task.assign',            'Assign, reassign and bulk-reassign tasks',                               'AUDIT-2026-10-19'),
  ('integration.dlq_manage', 'Replay or discard failed integration and outbox deliveries',             'AUDIT-2026-10-19'),
  ('automation.manage',      'Enable automation versions and run dry runs',                            'AUDIT-2026-10-19'),
  ('automation.operate',     'Intervene in running automation executions',                             'AUDIT-2026-10-19'),
  ('decision.evaluate',      'Evaluate a decision key directly (diagnostics)',                         'AUDIT-2026-10-19')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, g.code
  FROM app.role r
  JOIN (VALUES
    ('ROLE-ORG-OWNER', 'document.view'), ('ROLE-BRANCH-MGR', 'document.view'), ('ROLE-RM', 'document.view'),
    ('ROLE-LOAN-OPS', 'document.view'), ('ROLE-DOC-VERIFIER', 'document.view'), ('ROLE-COMPLIANCE', 'document.view'),
    ('ROLE-ORG-OWNER', 'document.download'), ('ROLE-BRANCH-MGR', 'document.download'), ('ROLE-RM', 'document.download'),
    ('ROLE-LOAN-OPS', 'document.download'), ('ROLE-DOC-VERIFIER', 'document.download'),
    ('ROLE-BRANCH-MGR', 'document.waive'), ('ROLE-LOAN-OPS', 'document.waive'),
    ('ROLE-COMPLIANCE', 'privacy.manage'),
    ('ROLE-ORG-OWNER', 'lead.merge'), ('ROLE-BRANCH-MGR', 'lead.merge'),
    ('ROLE-ORG-OWNER', 'lead.archive'), ('ROLE-BRANCH-MGR', 'lead.archive'),
    ('ROLE-ORG-OWNER', 'application.assign'), ('ROLE-BRANCH-MGR', 'application.assign'), ('ROLE-TEAM-MGR', 'application.assign'),
    ('ROLE-ORG-OWNER', 'application.close'), ('ROLE-BRANCH-MGR', 'application.close'), ('ROLE-LOAN-OPS', 'application.close'),
    ('ROLE-RM', 'application.withdraw'), ('ROLE-TEAM-MGR', 'application.withdraw'), ('ROLE-BRANCH-MGR', 'application.withdraw'),
    ('ROLE-LOAN-OPS', 'application.withdraw'), ('ROLE-ORG-OWNER', 'application.withdraw'),
    ('ROLE-TEAM-MGR', 'application.reopen'), ('ROLE-BRANCH-MGR', 'application.reopen'), ('ROLE-ORG-OWNER', 'application.reopen'),
    ('ROLE-TEAM-MGR', 'task.assign'), ('ROLE-BRANCH-MGR', 'task.assign'), ('ROLE-ORG-OWNER', 'task.assign'),
    ('ROLE-TENANT-ADMIN', 'integration.dlq_manage'),
    ('ROLE-TENANT-ADMIN', 'automation.manage'), ('ROLE-TENANT-ADMIN', 'automation.operate')
  ) AS g(role_code, code) ON g.role_code = r.code
ON CONFLICT DO NOTHING;
