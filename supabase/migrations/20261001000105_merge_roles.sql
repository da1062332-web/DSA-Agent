-- Migration: 20261001000105_merge_roles.sql
-- Module: Access Control (MOD-ACL). Owner: Vaibhav (platform lane). Task P0-01 of the multi-lender plan.
-- Merges redundant roles and removes unused roles:
--  1. Document verifier (ROLE-DOC-VERIFIER) -> merged into Loan operations (ROLE-LOAN-OPS).
--     ROLE-LOAN-OPS gains verification.perform, verification.create, verification.update, verification.complete, document.review.
--     Open ROLE-DOC-VERIFIER holders get ROLE-LOAN-OPS with the same scope.
--  2. Rule author (ROLE-RULE-AUTHOR) & Rule approver (ROLE-RULE-APPROVER) -> merged into new role "Lender policy manager" (ROLE-POLICY-MGR).
--     ROLE-POLICY-MGR gains rule.author, rule.simulate, rule.approve, rule.publish, rule.suspend.
--     Open ROLE-RULE-AUTHOR and ROLE-RULE-APPROVER holders get ROLE-POLICY-MGR with the same scope.
--     SOD-01 (cannot approve own draft) is enforced per-action on user_id, so the merged role cannot approve its own draft.
--  3. Commission approver (ROLE-COMMISSION-APPROVER) -> retired.
--     Approvals stay with DSA owner (ROLE-ORG-OWNER, which already holds commission.plan.approve, payout.approve, payout.disburse,
--     payout.record_payment, connector.bank_change_approve).
--     Open holders get Finance executive (ROLE-FINANCE-EXEC) with the same scope; Finance executive gains NO approval codes (SOD preserved).
--  4. Sales executive (ROLE-SALES-EXEC) -> renamed to "Telecaller" (code kept so no FKs or routing guards break).
--  5. Open assignments for retired roles are ended (kept as history per M-057).
--  6. Permissions deleted from retired roles.
--  7. Retired role rows deleted where never assigned, or renamed "... (retired)" where assignment history exists.
-- Idempotent. Runs as the migration owner, so M-059 login guards do not apply.
-- Verify: tools/sql/batch/105.verify.sql. Rollback: tools/sql/batch/105.rollback.sql.

SET search_path = app, extensions, public;

DO $$
DECLARE
  v_doc_moved   integer := 0;
  v_rule_moved  integer := 0;
  v_comm_moved  integer := 0;
  v_ended       integer := 0;
  v_perms       integer := 0;
  v_deleted     integer := 0;
  v_kept        integer := 0;
  v_renamed     integer := 0;
BEGIN
  -- 1. Create ROLE-POLICY-MGR in every customer tenant where it does not exist
  INSERT INTO app.role (id, tenant_id, code, name, is_template, version, created_at, created_by)
  SELECT 'rol_policy_mgr_' || t.id, t.id, 'ROLE-POLICY-MGR', 'Lender policy manager', true, 1, now(), 'SYSTEM:migration-0105'
    FROM app.tenant t
   WHERE t.tenant_type <> 'PLATFORM'
     AND NOT EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-POLICY-MGR')
  ON CONFLICT DO NOTHING;

  -- 2. Grant permissions to ROLE-POLICY-MGR
  INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
  SELECT r.tenant_id, r.id, p.code
    FROM app.role r
   CROSS JOIN (VALUES ('rule.author'), ('rule.simulate'), ('rule.approve'), ('rule.publish'), ('rule.suspend')) AS p(code)
   WHERE r.code = 'ROLE-POLICY-MGR'
  ON CONFLICT DO NOTHING;

  -- 3. Grant verification and document review permissions to ROLE-LOAN-OPS in all customer tenants
  INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
  SELECT r.tenant_id, r.id, p.code
    FROM app.role r
    JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
   CROSS JOIN (VALUES ('document.review'), ('verification.perform'), ('verification.create'), ('verification.update'), ('verification.complete')) AS p(code)
   WHERE r.code = 'ROLE-LOAN-OPS'
  ON CONFLICT DO NOTHING;

  -- 4. Move open ROLE-DOC-VERIFIER holders to ROLE-LOAN-OPS with the same scope
  INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
  SELECT 'ura_m105_doc_' || a.id, a.tenant_id, a.user_id, target.id, a.scope_type, a.scope_branch_ids, 'SYSTEM:migration-0105'
    FROM app.user_role_assignment a
    JOIN app.role src ON src.tenant_id = a.tenant_id AND src.id = a.role_id AND src.code = 'ROLE-DOC-VERIFIER'
    JOIN app.role target ON target.tenant_id = a.tenant_id AND target.code = 'ROLE-LOAN-OPS'
   WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
     AND NOT EXISTS (
           SELECT 1 FROM app.user_role_assignment x
            WHERE x.tenant_id = a.tenant_id AND x.user_id = a.user_id AND x.role_id = target.id
              AND NOT isempty(x.effective_range) AND upper_inf(x.effective_range))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_doc_moved = ROW_COUNT;

  -- 5. Move open ROLE-RULE-AUTHOR and ROLE-RULE-APPROVER holders to ROLE-POLICY-MGR with the same scope
  INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
  SELECT 'ura_m105_pol_' || a.id, a.tenant_id, a.user_id, target.id, a.scope_type, a.scope_branch_ids, 'SYSTEM:migration-0105'
    FROM app.user_role_assignment a
    JOIN app.role src ON src.tenant_id = a.tenant_id AND src.id = a.role_id AND src.code IN ('ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER')
    JOIN app.role target ON target.tenant_id = a.tenant_id AND target.code = 'ROLE-POLICY-MGR'
   WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
     AND NOT EXISTS (
           SELECT 1 FROM app.user_role_assignment x
            WHERE x.tenant_id = a.tenant_id AND x.user_id = a.user_id AND x.role_id = target.id
              AND NOT isempty(x.effective_range) AND upper_inf(x.effective_range))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rule_moved = ROW_COUNT;

  -- 6. Move open ROLE-COMMISSION-APPROVER holders to ROLE-FINANCE-EXEC with the same scope
  -- (They keep the finance view pages; approval stays with ROLE-ORG-OWNER; Finance executive gains no approval codes)
  INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
  SELECT 'ura_m105_com_' || a.id, a.tenant_id, a.user_id, target.id, a.scope_type, a.scope_branch_ids, 'SYSTEM:migration-0105'
    FROM app.user_role_assignment a
    JOIN app.role src ON src.tenant_id = a.tenant_id AND src.id = a.role_id AND src.code = 'ROLE-COMMISSION-APPROVER'
    JOIN app.role target ON target.tenant_id = a.tenant_id AND target.code = 'ROLE-FINANCE-EXEC'
   WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
     AND NOT EXISTS (
           SELECT 1 FROM app.user_role_assignment x
            WHERE x.tenant_id = a.tenant_id AND x.user_id = a.user_id AND x.role_id = target.id
              AND NOT isempty(x.effective_range) AND upper_inf(x.effective_range))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_comm_moved = ROW_COUNT;

  -- 7. End open assignments for all four retired roles
  UPDATE app.user_role_assignment a
     SET effective_range = CASE WHEN lower(a.effective_range) < now()
                                THEN tstzrange(lower(a.effective_range), now(), '[)')
                                ELSE 'empty'::tstzrange END
    FROM app.role r
   WHERE r.tenant_id = a.tenant_id AND r.id = a.role_id
     AND r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
     AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range);
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  -- 8. Delete permission grants from the four retired roles
  DELETE FROM app.role_permission rp
   USING app.role r
   WHERE r.tenant_id = rp.tenant_id AND r.id = rp.role_id
     AND r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER');
  GET DIAGNOSTICS v_perms = ROW_COUNT;

  -- 9. Delete retired roles where never assigned; rename where history points to them
  DELETE FROM app.role r
   WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
     AND NOT EXISTS (SELECT 1 FROM app.user_role_assignment a WHERE a.tenant_id = r.tenant_id AND a.role_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM app.access_review_item i WHERE i.tenant_id = r.tenant_id AND i.role_id = r.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE app.role r
     SET name = CASE r.code
                  WHEN 'ROLE-DOC-VERIFIER' THEN 'Document verifier (retired)'
                  WHEN 'ROLE-RULE-AUTHOR' THEN 'Rule author (retired)'
                  WHEN 'ROLE-RULE-APPROVER' THEN 'Rule approver (retired)'
                  WHEN 'ROLE-COMMISSION-APPROVER' THEN 'Commission and Payout Approver (retired)'
                  ELSE r.name
                END,
         version = r.version + 1
   WHERE r.code IN ('ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
     AND r.name NOT LIKE '%(retired)';
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  -- 10. Rename ROLE-SALES-EXEC to "Telecaller"
  UPDATE app.role
     SET name = 'Telecaller', version = version + 1
   WHERE code = 'ROLE-SALES-EXEC' AND name <> 'Telecaller';
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  RAISE NOTICE 'M-105: moved assignments (doc: %, rule: %, comm: %), ended: %, perms deleted: %, roles deleted: %, roles kept retired: %, roles renamed: %',
    v_doc_moved, v_rule_moved, v_comm_moved, v_ended, v_perms, v_deleted, v_kept, v_renamed;
END
$$;
