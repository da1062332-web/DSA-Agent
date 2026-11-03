-- Generated from supabase/migrations/202610010099_* (pair and code lists copied, not retyped). The rehearsal test checks them.
-- Roll back migration 0099 (per-role grants). Run this before 98.rollback.sql. Read the whole file first.
--
-- Provenance: the runbook takes dsa_backup.role_permission_pre_m099 immediately before 0099 is applied (after 0098). Only rows that the
-- snapshot did not have, and that are listed below, are removed. A grant the role held before 0099 is never touched.
--
-- REFUSES unless both hold:
--   1. the snapshot exists;
--   2. the operator confirms, in this session, that no listed grant was made by hand after 0099 (a human check; the snapshot cannot show it).
--      Confirm with: SET dsa.rollback_m099_confirmed = 'no-human-grants';
-- No audit or historical row is touched.
SET search_path = app, extensions, public;

DO $$
BEGIN
  IF to_regclass('dsa_backup.role_permission_pre_m099') IS NULL THEN
    RAISE EXCEPTION 'Refused: the pre-0099 snapshot dsa_backup.role_permission_pre_m099 does not exist. The runbook takes it before 0099 is applied.';
  END IF;
  IF coalesce(current_setting('dsa.rollback_m099_confirmed', true), '') <> 'no-human-grants' THEN
    RAISE EXCEPTION 'Refused: confirm first. Check by hand that no listed grant was made outside 0099, then in this session run: SET dsa.rollback_m099_confirmed = ''no-human-grants'';';
  END IF;
END $$;

DELETE FROM app.role_permission rp
 USING app.role r, app.tenant t
 WHERE rp.role_id = r.id
   AND t.id = r.tenant_id
   AND t.tenant_type <> 'PLATFORM'
   AND (r.code, rp.permission_code) IN (
     SELECT g.role_code, g.permission_code FROM (
  VALUES
    -- Tenant Administrator: integration and API administration
    ('ROLE-TENANT-ADMIN', 'api.manage'),
    ('ROLE-TENANT-ADMIN', 'api.read'),
    ('ROLE-TENANT-ADMIN', 'integration.manage'),
    ('ROLE-TENANT-ADMIN', 'integration.read'),
    ('ROLE-TENANT-ADMIN', 'webhook.manage'),

    -- DSA Owner: executive visibility of the staff directory
    ('ROLE-ORG-OWNER', 'user.read'),

    -- Branch Manager: branch performance, targets and the application work the page names. report.read and target.manage
    -- are what the split-off performance.read and target.read were backfilled from in migration 98, and this role held neither then.
    ('ROLE-BRANCH-MGR', 'report.read'),
    ('ROLE-BRANCH-MGR', 'target.manage'),
    ('ROLE-BRANCH-MGR', 'application.update'),
    ('ROLE-BRANCH-MGR', 'performance.read'),
    ('ROLE-BRANCH-MGR', 'target.read'),

    -- Relationship Manager: uploads documents and shares them with the customer
    ('ROLE-RM', 'document.upload'),
    ('ROLE-RM', 'share.create'),

    -- Sales Executive: edits the interactions they log
    ('ROLE-SALES-EXEC', 'activity.update'),

    -- Compliance: the report catalogue, without team performance
    ('ROLE-COMPLIANCE', 'report.read'),

    -- Finance Executive: raises payout requests and verifies disbursements, SOD-04
    ('ROLE-FINANCE-EXEC', 'payout.request'),
    ('ROLE-FINANCE-EXEC', 'disbursement.verify'),
    ('ROLE-FINANCE-EXEC', 'disbursement.read')
     ) AS g(role_code, permission_code))
   AND NOT EXISTS (SELECT 1 FROM dsa_backup.role_permission_pre_m099 s
                    WHERE s.role_id = rp.role_id AND s.permission_code = rp.permission_code);
