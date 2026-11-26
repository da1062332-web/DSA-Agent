-- Migration: 20261001000107_merge_roles_dedupe.sql
-- Module: Access Control (MOD-ACL). Owner: Vaibhav (platform lane). Correction to M-105 (task P0-01); M-105 itself is merged and stays unchanged.
-- Bug in M-105: a user who held BOTH Rule author and Rule approver got TWO open ROLE-POLICY-MGR assignments, because step 5 inserted one
-- row per source assignment and its NOT EXISTS check only sees rows that existed before the statement ran. The same would happen to anyone
-- who held two retired roles that map to the same target. This migration ends the extra row, keeping the one with the lowest id (the ended
-- row stays as history per M-057). It touches only rows created by M-105, so it is a no-op where M-105 created no duplicate (hosted already
-- had its one duplicate ended by hand in the apply transaction on 2026-11-26).
-- Idempotent. Verify: tools/sql/batch/107.verify.sql. No rollback needed: a second open assignment of the same role is never wanted.

SET search_path = app, extensions, public;

DO $$
DECLARE
  v_ended integer := 0;
BEGIN
  WITH ranked AS (
    SELECT a.id,
           row_number() OVER (PARTITION BY a.tenant_id, a.user_id, a.role_id ORDER BY a.id) AS rn
      FROM app.user_role_assignment a
     WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
  )
  UPDATE app.user_role_assignment a
     SET effective_range = 'empty'::tstzrange
    FROM ranked
   WHERE ranked.id = a.id
     AND ranked.rn > 1
     AND a.created_by = 'SYSTEM:migration-0105';
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  RAISE NOTICE 'M-107: duplicate open assignments from M-105 ended: %', v_ended;
END
$$;
