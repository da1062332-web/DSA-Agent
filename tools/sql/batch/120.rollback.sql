-- Roll back migration 0120 (P1-04 lender policy grid and multi-lender matching). Owner: Dipanshu.
-- Run as the migration owner. One transaction: everything goes or nothing does.
-- DATA LOSS: drops every lender policy and every match run and result. Before running it on hosted, snapshot them:
--   CREATE TABLE dsa_backup.lender_policy_pre_rb120 AS TABLE app.lender_policy;  (and the two match tables)
-- Audit rows written by the P1-04 API stay (the audit log is append-only); they keep their entity ids.
BEGIN;
SET search_path = app, extensions, public;

DELETE FROM app.role_permission
 WHERE permission_code IN ('lender_policy.read', 'lender_policy.manage', 'lender_match.run');

-- M-120 gave the DSA owner rule.approve. role_permission does not record who added a grant, so check the pre-apply snapshot first:
-- if a tenant's owner already held rule.approve before M-120, leave that tenant out of this statement.
DELETE FROM app.role_permission rp
 USING app.role r
 WHERE r.tenant_id = rp.tenant_id AND r.id = rp.role_id
   AND r.code = 'ROLE-ORG-OWNER' AND rp.permission_code = 'rule.approve';

DROP TABLE IF EXISTS app.lender_match_result;
DROP TABLE IF EXISTS app.lender_match_run;
DROP TABLE IF EXISTS app.lender_policy;

DELETE FROM app.permission
 WHERE code IN ('lender_policy.read', 'lender_policy.manage', 'lender_match.run')
   AND introduced_in = 'M-120';

COMMIT;
