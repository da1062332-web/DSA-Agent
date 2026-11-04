-- Generated from supabase/migrations/202610010098_* (pair and code lists copied, not retyped). The rehearsal test checks them.
-- Roll back migration 0098 (sub-permission expand). Read the whole file first. Order: roll back 0099 first (99.rollback.sql), then this file.
-- Prerequisite: the application release that checks these codes is rolled back first, or the API refuses the requests that need them.
--
-- Provenance: the grant table keeps no record of who added a row, so the rollback uses snapshots taken by the runbook immediately before
-- 0098 is applied: dsa_backup.permission_pre_m098 and dsa_backup.role_permission_pre_m098. A row the snapshot already had is never touched.
--
-- REFUSES unless all hold:
--   1. both snapshots exist;
--   2. the operator confirms, in this session, that no M-098 sub-permission was granted by hand after 0098 (a human check; the snapshot
--      cannot show it). Confirm with: SET dsa.rollback_m098_confirmed = 'no-human-grants';
--   3. every grant added since the snapshot, of the codes below, sits next to its parent grant on the same role (the shape the backfill
--      makes). A grant without its parent was made by hand, or its parent was removed later, and deleting it would change access.
--
-- Kept on purpose: attendance.read (granted to every customer role as a screen gate; removing it hides Workforce). lender.read and
-- product.read predate M-098 and are not in the list. No audit or historical row is touched.
SET search_path = app, extensions, public;

DO $$
BEGIN
  IF to_regclass('dsa_backup.permission_pre_m098') IS NULL OR to_regclass('dsa_backup.role_permission_pre_m098') IS NULL THEN
    RAISE EXCEPTION 'Refused: the pre-0098 snapshots dsa_backup.permission_pre_m098 and dsa_backup.role_permission_pre_m098 do not exist. The runbook takes them before 0098 is applied.';
  END IF;
  IF coalesce(current_setting('dsa.rollback_m098_confirmed', true), '') <> 'no-human-grants' THEN
    RAISE EXCEPTION 'Refused: confirm first. Check by hand that no M-098 sub-permission was granted to a role outside the backfill, then in this session run: SET dsa.rollback_m098_confirmed = ''no-human-grants'';';
  END IF;
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM app.role_permission rp
   WHERE rp.permission_code IN ('lender_case.read', 'sanction.read', 'disbursement.read', 'eligibility.read', 'org.manage', 'team.manage', 'settings.manage', 'message_template.manage', 'user.read', 'user.invite', 'user.offboard', 'role.read', 'access_review.manage', 'activity.read', 'complaint.read', 'commission.view', 'payout.view', 'ledger.view', 'reconciliation.view', 'invoice.view', 'payout.disburse', 'ledger.journal_post', 'connector.bank_account_manage', 'connector.agreement_manage', 'connector.portal_user_manage', 'performance.read', 'target.read', 'audit.seal', 'security.read', 'privacy.read', 'import.read')
     AND NOT EXISTS (SELECT 1 FROM dsa_backup.role_permission_pre_m098 s
                      WHERE s.role_id = rp.role_id AND s.permission_code = rp.permission_code)
     AND NOT EXISTS (
       SELECT 1 FROM (
  VALUES
    ('application.read', 'lender_case.read'),
    ('lender_case.submit', 'lender_case.read'),
    ('lender_case.update_status', 'lender_case.read'),

    ('sanction.record', 'sanction.read'),
    ('disbursement.record', 'sanction.read'),
    ('disbursement.verify', 'sanction.read'),
    ('disbursement.exception_approve', 'sanction.read'),
    ('sanction.record', 'disbursement.read'),
    ('disbursement.record', 'disbursement.read'),
    ('disbursement.verify', 'disbursement.read'),
    ('disbursement.exception_approve', 'disbursement.read'),

    ('application.read', 'eligibility.read'),

    ('config.manage', 'org.manage'),
    ('config.manage', 'team.manage'),
    ('user.manage', 'team.manage'),
    ('config.manage', 'settings.manage'),
    ('config.manage', 'message_template.manage'),

    ('user.manage', 'user.read'),
    ('user.manage', 'user.invite'),
    ('user.manage', 'user.offboard'),
    ('role.manage', 'role.read'),
    ('user.manage', 'role.read'),
    ('user.manage', 'access_review.manage'),

    ('lead.read', 'activity.read'),
    ('customer.read', 'activity.read'),
    ('application.read', 'activity.read'),
    ('activity.create', 'activity.read'),
    ('complaint.create', 'complaint.read'),
    ('complaint.manage', 'complaint.read'),
    ('attendance.manage', 'attendance.read'),

    ('finance.view', 'commission.view'),
    ('commission.plan.edit', 'commission.view'),
    ('commission.plan.approve', 'commission.view'),
    ('finance.view', 'payout.view'),
    ('payout.request', 'payout.view'),
    ('payout.approve', 'payout.view'),
    ('payout.record_payment', 'payout.view'),
    ('finance.view', 'ledger.view'),
    ('finance.view', 'reconciliation.view'),
    ('finance.reconcile', 'reconciliation.view'),
    ('finance.view', 'invoice.view'),
    ('invoice.manage', 'invoice.view'),
    ('payout.record_payment', 'payout.disburse'),

    ('connector.manage', 'connector.bank_account_manage'),
    ('connector.manage', 'connector.agreement_manage'),
    ('connector.manage', 'connector.portal_user_manage'),

    ('report.read', 'performance.read'),
    ('report.read', 'target.read'),
    ('target.manage', 'target.read'),

    ('audit.read', 'audit.seal'),
    ('security.incident', 'security.read'),
    ('audit.read', 'privacy.read'),
    ('customer.read', 'privacy.read'),
    ('privacy.manage', 'privacy.read'),

    ('import.run', 'import.read'),
    ('config.manage', 'import.read')
       ) AS m(parent, child)
        WHERE m.child = rp.permission_code
          AND EXISTS (SELECT 1 FROM app.role_permission p WHERE p.role_id = rp.role_id AND p.permission_code = m.parent));
  IF n > 0 THEN
    RAISE EXCEPTION 'Refused: % grant(s) added since the snapshot have no parent grant on the same role. Review them by hand first.', n;
  END IF;
END $$;

DELETE FROM app.role_permission rp
 WHERE rp.permission_code IN ('lender_case.read', 'sanction.read', 'disbursement.read', 'eligibility.read', 'org.manage', 'team.manage', 'settings.manage', 'message_template.manage', 'user.read', 'user.invite', 'user.offboard', 'role.read', 'access_review.manage', 'activity.read', 'complaint.read', 'commission.view', 'payout.view', 'ledger.view', 'reconciliation.view', 'invoice.view', 'payout.disburse', 'ledger.journal_post', 'connector.bank_account_manage', 'connector.agreement_manage', 'connector.portal_user_manage', 'performance.read', 'target.read', 'audit.seal', 'security.read', 'privacy.read', 'import.read')
   AND NOT EXISTS (SELECT 1 FROM dsa_backup.role_permission_pre_m098 s
                    WHERE s.role_id = rp.role_id AND s.permission_code = rp.permission_code);

DELETE FROM app.permission p
 WHERE p.code IN ('lender_case.read', 'sanction.read', 'disbursement.read', 'eligibility.read', 'org.manage', 'team.manage', 'settings.manage', 'message_template.manage', 'user.read', 'user.invite', 'user.offboard', 'role.read', 'access_review.manage', 'activity.read', 'complaint.read', 'commission.view', 'payout.view', 'ledger.view', 'reconciliation.view', 'invoice.view', 'payout.disburse', 'ledger.journal_post', 'connector.bank_account_manage', 'connector.agreement_manage', 'connector.portal_user_manage', 'performance.read', 'target.read', 'audit.seal', 'security.read', 'privacy.read', 'import.read')
   AND NOT EXISTS (SELECT 1 FROM dsa_backup.permission_pre_m098 s WHERE s.code = p.code)
   AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.permission_code = p.code);
