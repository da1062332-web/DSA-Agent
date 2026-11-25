-- Migration: 20261001000103_retire_verifier_role.sql
-- Module: Access Control (MOD-ACL). Owner: Dev 1. Asked for by the project owner on 2026-11-25 (multi-lender scope review, roles
-- verdict "Remove").
-- Retires ROLE-VERIFIER ("Verification Specialist"). A multi-lender DSA does not run field investigation, CPV or RCU: the lender's own
-- agencies do. M-047 added the role as an alias of ROLE-DOC-VERIFIER with the same seven permissions. The demo seed and the
-- provisioning tool never create it, so only tenants that existed when M-047 ran have it.
--  1. A user with an open ROLE-VERIFIER assignment and no open ROLE-DOC-VERIFIER assignment gets a ROLE-DOC-VERIFIER assignment with
--     the same scope, so nobody loses document review.
--  2. Open ROLE-VERIFIER assignments are ended now. The rows stay as history (M-057: assignments are ended, never deleted).
--  3. ROLE-VERIFIER loses every permission.
--  4. The role row is deleted where it was never assigned. Where assignment history exists, the row stays (the history points at it)
--     with no permissions, renamed "Verification specialist (retired)".
-- The dead role codes that M-006, M-027, M-028, M-032, M-034, M-036, M-042 and M-053 grant to (ROLE-SUPERVISOR, ROLE-AGENT,
-- ROLE-READONLY, ROLE-AUDITOR, ROLE-FINANCE-APPROVER, ROLE-SUPER-ADMIN and the legacy AUDITOR, COMPLIANCE, ORG_OWNER, TENANT_ADMIN)
-- need no change here: no migration or seed creates a role with those codes, so those grants wrote no rows. The merged migrations
-- stay as they are (MANIFEST rule 1). A tenant's own custom role that happens to use one of those codes is left alone.
-- Idempotent. Runs as the migration owner, so the application-login guards of M-059 do not apply.
-- Verify: tools/sql/batch/103.verify.sql. Rollback: tools/sql/batch/103.rollback.sql.

SET search_path = app, extensions, public;

DO $$
DECLARE
  v_moved   integer;
  v_ended   integer;
  v_perms   integer;
  v_deleted integer;
  v_kept    integer;
BEGIN
  -- 1. Same scope on ROLE-DOC-VERIFIER for every open ROLE-VERIFIER holder who does not already hold it.
  INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
  SELECT 'ura_m103_' || a.id, a.tenant_id, a.user_id, d.id, a.scope_type, a.scope_branch_ids, 'SYSTEM:migration-0103'
    FROM app.user_role_assignment a
    JOIN app.role v ON v.tenant_id = a.tenant_id AND v.id = a.role_id AND v.code = 'ROLE-VERIFIER'
    JOIN app.role d ON d.tenant_id = a.tenant_id AND d.code = 'ROLE-DOC-VERIFIER'
   WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
     AND NOT EXISTS (
           SELECT 1 FROM app.user_role_assignment x
            WHERE x.tenant_id = a.tenant_id AND x.user_id = a.user_id AND x.role_id = d.id
              AND NOT isempty(x.effective_range) AND upper_inf(x.effective_range))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- 2. End the open ROLE-VERIFIER assignments. One that has not started yet ends empty (M-057 allows exactly these two shapes).
  UPDATE app.user_role_assignment a
     SET effective_range = CASE WHEN lower(a.effective_range) < now()
                                THEN tstzrange(lower(a.effective_range), now(), '[)')
                                ELSE 'empty'::tstzrange END
    FROM app.role v
   WHERE v.tenant_id = a.tenant_id AND v.id = a.role_id AND v.code = 'ROLE-VERIFIER'
     AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range);
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  -- 3. No permissions left on the role.
  DELETE FROM app.role_permission rp
   USING app.role v
   WHERE v.tenant_id = rp.tenant_id AND v.id = rp.role_id AND v.code = 'ROLE-VERIFIER';
  GET DIAGNOSTICS v_perms = ROW_COUNT;

  -- 4. Delete the role where nothing points at it; otherwise keep it, empty and marked retired.
  DELETE FROM app.role v
   WHERE v.code = 'ROLE-VERIFIER'
     AND NOT EXISTS (SELECT 1 FROM app.user_role_assignment a WHERE a.tenant_id = v.tenant_id AND a.role_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM app.access_review_item i WHERE i.tenant_id = v.tenant_id AND i.role_id = v.id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE app.role v
     SET name = 'Verification specialist (retired)', version = v.version + 1
   WHERE v.code = 'ROLE-VERIFIER' AND v.name <> 'Verification specialist (retired)';
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  RAISE NOTICE 'M-103: % assignment(s) moved to ROLE-DOC-VERIFIER, % ended, % permission grant(s) removed, % role row(s) deleted, % kept as retired',
    v_moved, v_ended, v_perms, v_deleted, v_kept;
END
$$;
