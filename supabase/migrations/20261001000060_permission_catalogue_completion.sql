-- Migration: 20261001000060_permission_catalogue_completion.sql
-- Owner: Dev 1 (Module 5: access control)
-- The permission codes in packages/contracts (the 100-code catalogue frozen at Gate 1) and the app.permission table had drifted: nine codes were
-- in the contracts but in no migration and not on hosted. Code that checks them (commission plans, lead reopen) could never be satisfied,
-- because role_permission.permission_code is a foreign key to this table, so no role could ever hold them.
-- This only DEFINES them. It grants none of them to any role: commission is deferred to Release 3 (TASK-418), and lead.reopen falls
-- back to lead.update when nobody holds it. A tenant administrator can grant them to a custom role through the role editor.
--   Used by code:        commission.plan.edit, commission.plan.approve (Module 29), lead.reopen (Module 7)
--   Named in the specs:  commission.calculate, customer.reveal_sensitive (Module 8, S3 reveal, not in the MVP), lender.read,
--                        lender.manage, product.read, product.manage (Modules 14 and 15)

SET search_path = app, extensions, public;

INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('commission.plan.edit',        'Create and edit commission plans and propose recalculations',        'GATE-1'),
  ('commission.plan.approve',     'Approve a commission plan version (the editor cannot, SOD-02)',      'GATE-1'),
  ('commission.calculate',        'Run or re-run a commission calculation',                             'GATE-1'),
  ('customer.reveal_sensitive',   'Reveal one masked sensitive customer field with a reason',           'GATE-1'),
  ('lead.reopen',                 'Reopen a closed lead (without it, lead.update is accepted)',         'GATE-1'),
  ('lender.read',                 'Read lenders, contacts and empanelments',                            'GATE-1'),
  ('lender.manage',               'Create and edit lenders, contacts and empanelments',                 'GATE-1'),
  ('product.read',                'Read loan products and their versions',                              'GATE-1'),
  ('product.manage',              'Create and edit loan products and publish versions',                 'GATE-1')
ON CONFLICT (code) DO NOTHING;
