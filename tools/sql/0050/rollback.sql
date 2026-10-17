-- tools/sql/0050/rollback.sql  — WRITES. Undoes migration 0050. Use only if 0050 was applied and must be reverted.
-- Run it INSIDE ONE TRANSACTION together with the grant restore, exactly as docs/MODULE_1_PLATFORM_REALM_REVIEW.md section 12 shows:
--     ( echo "BEGIN;"; cat tools/sql/0050/rollback.sql; node tools/sql/0050/restore-grants.mjs <backup.json>; echo "COMMIT;" ) > rollback-run.sql
-- It stops (and changes nothing) if data exists that the old shape cannot hold. What it does NOT undo:
--   * platform users created in Supabase Auth: delete those accounts in the dashboard (Authentication, Users);
--   * audit events about platform actions: the audit trail is append-only. If any exist, the platform tenant is SUSPENDED, not deleted.
SET search_path = app, extensions, public;

-- 0. Refuse to roll back over data that only the new shape can hold.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM support_access_grant WHERE status = 'DENIED') THEN
    RAISE EXCEPTION 'ROLLBACK STOPPED: support_access_grant has DENIED rows, which the original status check cannot hold. Export them, then change them to REVOKED or remove them, and run again.';
  END IF;
  IF EXISTS (SELECT 1 FROM data_correction_request WHERE status = 'FAILED' OR entity_type IS NULL OR entity_id IS NULL OR field_name IS NULL
                                                         OR new_value IS NULL OR reason IS NULL OR submitted_by IS NULL) THEN
    RAISE EXCEPTION 'ROLLBACK STOPPED: data_correction_request has rows in the new shape (requested through the API). The original table cannot hold them. Export them first, then remove them, and run again.';
  END IF;
END
$$;

-- 1. support_access_grant: back to one tenant_isolation policy, the original status check and columns.
DROP POLICY IF EXISTS grant_tenant_read ON support_access_grant;
DROP POLICY IF EXISTS grant_platform_request ON support_access_grant;
DROP POLICY IF EXISTS grant_tenant_decide ON support_access_grant;
CREATE POLICY tenant_isolation ON support_access_grant USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE support_access_grant DROP CONSTRAINT IF EXISTS support_access_grant_window_check;
ALTER TABLE support_access_grant DROP CONSTRAINT IF EXISTS support_access_grant_status_check;
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'));
ALTER TABLE support_access_grant DROP COLUMN IF EXISTS scope;
ALTER TABLE support_access_grant DROP COLUMN IF EXISTS incident_ref;
ALTER TABLE support_access_grant DROP COLUMN IF EXISTS starts_at;

-- 2. data_correction_request: back to the 0046 shape.
ALTER TABLE data_correction_request DROP CONSTRAINT IF EXISTS data_correction_request_shape_check;
ALTER TABLE data_correction_request DROP CONSTRAINT IF EXISTS data_correction_request_sod08_check;
ALTER TABLE data_correction_request DROP CONSTRAINT IF EXISTS data_correction_request_status_check;
ALTER TABLE data_correction_request ADD CONSTRAINT data_correction_request_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'));
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS justification;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS script_ref;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS target_entity;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS change_description;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS dry_run_diff_key;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS dry_run_diff;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS requested_by;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS executed_at;
ALTER TABLE data_correction_request DROP COLUMN IF EXISTS executor_identity;
ALTER TABLE data_correction_request ALTER COLUMN entity_type  SET NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN entity_id    SET NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN field_name   SET NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN new_value    SET NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN reason       SET NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN submitted_by SET NOT NULL;

-- 3. The global tables go back to having no row-level security (as before 0050).
DROP POLICY IF EXISTS flag_read ON feature_flag;
DROP POLICY IF EXISTS flag_insert ON feature_flag;
DROP POLICY IF EXISTS flag_update ON feature_flag;
ALTER TABLE feature_flag NO FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flag DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_read ON master_data_item;
DROP POLICY IF EXISTS master_insert ON master_data_item;
DROP POLICY IF EXISTS master_update ON master_data_item;
ALTER TABLE master_data_item NO FORCE ROW LEVEL SECURITY;
ALTER TABLE master_data_item DISABLE ROW LEVEL SECURITY;

-- 4. tenant: only the tenant's own row is readable again.
DROP POLICY IF EXISTS platform_read ON tenant;

-- 5. The functions (the policies that used them are gone).
DROP FUNCTION IF EXISTS platform_tenant_user_counts();
DROP FUNCTION IF EXISTS is_platform_realm();

-- 6. The platform tenant. Everything inside it (users, assignments, grants, roles, branch, organisation) is removed. The tenant row
--    itself is deleted too, unless audit events (append-only) still point at it: then it is SUSPENDED and its type stays allowed.
DELETE FROM user_role_assignment WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DELETE FROM app_user WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DELETE FROM role_permission WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DELETE FROM role WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DELETE FROM branch WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DELETE FROM organisation WHERE tenant_id = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
DO $$
DECLARE pt constant text := 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
BEGIN
  BEGIN
    DELETE FROM tenant WHERE id = pt;
    ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_tenant_type_check;
    ALTER TABLE tenant ADD CONSTRAINT tenant_tenant_type_check CHECK (tenant_type IN ('DSA_ORG', 'NBFC_DISTRIBUTION'));
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
    RAISE NOTICE 'The platform tenant is still referenced (audit events are append-only); it is SUSPENDED instead of deleted and its type stays allowed.';
    UPDATE tenant SET status = 'SUSPENDED' WHERE id = pt;
  END;
END
$$;

-- 7. The 30 operator grants that 0050 deleted are put back by restore-grants.mjs, from the backup taken before it (see the header).
