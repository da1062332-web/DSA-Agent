-- Migration: 20261001000119_delete_retired_roles.sql
-- Module: Access Control (MOD-ACL). Owner: Bhushan (range 0110-0119). Follow-up to P0-01 (M-103, M-105), asked for by the project owner
-- on 2026-11-27: retired roles are removed, not kept and hidden.
--
-- M-103 retired ROLE-VERIFIER and M-105 retired ROLE-DOC-VERIFIER, ROLE-RULE-AUTHOR, ROLE-RULE-APPROVER and ROLE-COMMISSION-APPROVER.
-- Where an assignment had ever pointed at one, those migrations kept the role row, renamed "... (retired)" with no permissions, so the
-- Access Control page still listed it. This migration deletes, in customer tenants only:
--   1. the ended assignments of the retired roles (their history; the audit trail keeps its own record),
--   2. any permission grant left on them (none expected),
--   3. the retired role rows.
-- It refuses, changing nothing, while any open assignment still holds a retired role: those holders must be moved first (M-105 did).
-- RETIRED_ROLE_CODES (apps/api/src/modules/platform/role-guards.ts) still stops the codes from being created or assigned again.
-- Idempotent: a second run finds nothing to delete. Runs as the migration owner (the M-057 trigger guards UPDATE only, not DELETE).
-- Before applying to hosted take the snapshots dsa_backup.role_pre_m119 and dsa_backup.user_role_assignment_pre_m119.
-- Verify: tools/sql/batch/119.verify.sql. Rollback: tools/sql/batch/119.rollback.sql (restores from the snapshots).

SET search_path = app, extensions, public;

DO $$
DECLARE
  v_open    integer := 0;
  v_assign  integer := 0;
  v_perms   integer := 0;
  v_roles   integer := 0;
BEGIN
  SELECT count(*) INTO v_open
    FROM user_role_assignment a
    JOIN role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
    JOIN tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
   WHERE r.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER')
     AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range);
  IF v_open > 0 THEN
    RAISE EXCEPTION 'M-119 refused: % open assignment(s) still hold a retired role; move those users to a live role first', v_open;
  END IF;

  DELETE FROM user_role_assignment a
   USING role r, tenant t
   WHERE r.tenant_id = a.tenant_id AND r.id = a.role_id
     AND t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
     AND r.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER');
  GET DIAGNOSTICS v_assign = ROW_COUNT;

  DELETE FROM role_permission rp
   USING role r, tenant t
   WHERE r.tenant_id = rp.tenant_id AND r.id = rp.role_id
     AND t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
     AND r.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER');
  GET DIAGNOSTICS v_perms = ROW_COUNT;

  DELETE FROM role r
   USING tenant t
   WHERE t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
     AND r.code IN ('ROLE-VERIFIER', 'ROLE-DOC-VERIFIER', 'ROLE-RULE-AUTHOR', 'ROLE-RULE-APPROVER', 'ROLE-COMMISSION-APPROVER');
  GET DIAGNOSTICS v_roles = ROW_COUNT;

  RAISE NOTICE 'M-119: ended assignments deleted: %, grants deleted: %, retired roles deleted: %', v_assign, v_perms, v_roles;
END
$$;
