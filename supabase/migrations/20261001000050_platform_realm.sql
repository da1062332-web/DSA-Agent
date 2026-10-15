-- 0050_platform_realm.sql  (owner: Dev 1, MOD-TEN Module 1 and MOD-ADM Module 40)
-- Apply once, inside one transaction, as a role that bypasses row-level security (the hosted `postgres` role does).
-- Run the preflight and backup in tools/sql/0050 first; the rollback is tools/sql/0050/rollback.sql.
--
-- Puts platform operators in their own realm. Until now migration 0046 granted every platform.* permission to
-- ROLE-ORG-OWNER and ROLE-TENANT-ADMIN of each customer tenant, and left two global tables (feature_flag, master_data_item)
-- without row-level security although the API role can write them. This migration:
--   1. adds a platform tenant (tenant_type PLATFORM), its organisation and branch (an app_user needs a branch), and
--      ROLE-PLATFORM-SUPERADMIN and ROLE-PLATFORM-SUPPORT inside it;
--   2. moves the six operator permissions to those roles and removes them from every customer-tenant role (30 rows on hosted);
--   3. keeps data_correction.* in the tenant realm. Module 40 has tenant users request and the tenant admin approve, and
--      Module 5 (SUB-ACL.03) lets small tenants designate ROLE-ORG-OWNER as the checker, so ROLE-ORG-OWNER KEEPS
--      data_correction.approve. SOD-08 (requester is not approver) is enforced by a CHECK constraint below;
--   4. adds app.is_platform_realm() and uses it so the database itself enforces the realm:
--        - platform operators may read tenant metadata (the tenant table only) and nothing else across tenants;
--        - only a platform session may write feature flags and master data;
--        - a platform session may file and read support-access requests for any tenant, but only the target tenant's own
--          administrators can approve, deny or revoke them;
--        - data_correction_request stays tenant-isolated: platform operators cannot read the business values in it.
-- Platform users are not created here (they need a Supabase Auth account): use tools/provision-platform-admin.ts
-- (see docs/MODULE_1_PLATFORM_REALM_REVIEW.md, section 9).
SET search_path = app, extensions, public;

-- 1. The realm test. The id must match PLATFORM_TENANT_ID in packages/contracts/src/platform-realm.ts.
--    coalesce: with no tenant set app_tenant() is NULL, and NULL = 'x' is NULL, which "IF NOT ..." would treat as not-false. It must be false.
CREATE OR REPLACE FUNCTION is_platform_realm() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(app_tenant() = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', false) $$;

-- 2. A tenant type for the platform tenant.
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_tenant_type_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_tenant_type_check
  CHECK (tenant_type IN ('DSA_ORG', 'NBFC_DISTRIBUTION', 'PLATFORM'));

INSERT INTO tenant (id, slug, legal_name, tenant_type, data_region, timezone, status, created_by)
VALUES ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'platform-operations', 'Platform Operations', 'PLATFORM', 'IN',
        'Asia/Kolkata', 'ACTIVE', 'SYSTEM:migration')
ON CONFLICT (id) DO NOTHING;

-- The platform tenant needs an organisation and a branch: app_user.primary_branch_id is required and references branch.
INSERT INTO organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
VALUES ('org_01M4ZG67WZ2ZPNJ361KHB1DGK6', 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'Platform Operations', 'OTHER', 'ACTIVE',
        'SYSTEM:migration', 'SYSTEM:migration')
ON CONFLICT (id) DO NOTHING;
INSERT INTO branch (id, tenant_id, organisation_id, code, name, status, created_by, updated_by)
VALUES ('br_01M4ZJ8H51XBQ0A3RWZSBVRZAP', 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'org_01M4ZG67WZ2ZPNJ361KHB1DGK6', 'PLATFORM',
        'Platform operations', 'ACTIVE', 'SYSTEM:migration', 'SYSTEM:migration')
ON CONFLICT (id) DO NOTHING;

-- 3. The two platform roles, inside the platform tenant only.
INSERT INTO role (id, tenant_id, code, name, is_template, created_by) VALUES
  ('role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'ROLE-PLATFORM-SUPERADMIN', 'Platform super admin', false, 'SYSTEM:migration'),
  ('role_01M4ZG67WYKTMHNAX6RB8RYQYR', 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'ROLE-PLATFORM-SUPPORT', 'Platform support (metadata only)', false, 'SYSTEM:migration')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Superadmin: every operator permission, plus audit.read for the platform tenant's own audit trail.
-- Support: tenant metadata and support-access requests only (MODULE 1: "metadata only").
INSERT INTO role_permission (tenant_id, role_id, permission_code) VALUES
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.console'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.flags'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.master_data'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.jobs'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.support_access'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'platform.release'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', 'audit.read'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYR', 'platform.console'),
  ('ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYR', 'platform.support_access')
ON CONFLICT DO NOTHING;

-- 4. Remove the operator permissions from every customer-tenant role (migration 0046 gave them to ORG-OWNER and TENANT-ADMIN).
DELETE FROM role_permission
 WHERE permission_code IN ('platform.console', 'platform.flags', 'platform.master_data', 'platform.jobs',
                           'platform.support_access', 'platform.release')
   AND tenant_id <> 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
-- data_correction.approve stays on ROLE-ORG-OWNER and ROLE-TENANT-ADMIN (see the header): nothing else is deleted.

-- 5. The platform console reads tenant metadata across tenants. This is the one cross-tenant read on a business table's
--    parent; the tenant row holds no business data. Writes to tenant stay limited to a tenant's own row (tenant_self).
CREATE POLICY platform_read ON tenant FOR SELECT USING (is_platform_realm());

-- 6. Global tables: anyone may read (flags and master data drive every tenant), only a platform session may write.
ALTER TABLE feature_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;
CREATE POLICY flag_read ON feature_flag FOR SELECT USING (true);
CREATE POLICY flag_insert ON feature_flag FOR INSERT WITH CHECK (is_platform_realm());
CREATE POLICY flag_update ON feature_flag FOR UPDATE USING (is_platform_realm()) WITH CHECK (is_platform_realm());

ALTER TABLE master_data_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_data_item FORCE ROW LEVEL SECURITY;
CREATE POLICY master_read ON master_data_item FOR SELECT USING (true);
CREATE POLICY master_insert ON master_data_item FOR INSERT WITH CHECK (is_platform_realm());
CREATE POLICY master_update ON master_data_item FOR UPDATE USING (is_platform_realm()) WITH CHECK (is_platform_realm());

-- 7. Support access. Columns the API needs (the table was empty of real data; one row is a leftover live-test record),
--    a four-hour ceiling (ENT-018), and policies that separate asking from approving.
ALTER TABLE support_access_grant ADD COLUMN IF NOT EXISTS scope        text        NOT NULL DEFAULT 'READ_METADATA_AND_CONFIG';
ALTER TABLE support_access_grant ADD COLUMN IF NOT EXISTS incident_ref text        NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE support_access_grant ADD COLUMN IF NOT EXISTS starts_at    timestamptz NOT NULL DEFAULT now();
ALTER TABLE support_access_grant DROP CONSTRAINT IF EXISTS support_access_grant_status_check;
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'));
-- NOT VALID: the leftover test row predates this rule; every new or changed row is checked.
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_window_check
  CHECK (expires_at > starts_at AND expires_at <= starts_at + interval '4 hours') NOT VALID;

DROP POLICY IF EXISTS tenant_isolation ON support_access_grant;
-- The target tenant sees its own requests; a platform session sees all of them (they hold no business data).
CREATE POLICY grant_tenant_read ON support_access_grant FOR SELECT
  USING (tenant_id = app_tenant() OR is_platform_realm());
-- Only a platform session files a request, only as PENDING and not approved, and never for the platform tenant itself.
CREATE POLICY grant_platform_request ON support_access_grant FOR INSERT
  WITH CHECK (is_platform_realm() AND status = 'PENDING' AND approved_by IS NULL
              AND tenant_id <> app_tenant());
-- Only the target tenant decides, denies or revokes. The platform realm has no UPDATE policy: it cannot approve its own request.
CREATE POLICY grant_tenant_decide ON support_access_grant FOR UPDATE
  USING (tenant_id = app_tenant() AND status IN ('PENDING', 'ACTIVE'))
  WITH CHECK (tenant_id = app_tenant() AND status IN ('ACTIVE', 'DENIED', 'REVOKED'));

-- 8. The one cross-tenant aggregate the console shows: active users per tenant. It returns counts only (no rows, no names),
--    and refuses to run outside a platform session. SECURITY DEFINER lets it count past the tenant policies of app_user.
CREATE OR REPLACE FUNCTION platform_tenant_user_counts() RETURNS TABLE (tenant_id text, active_users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform_tenant_user_counts is for the platform realm only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.tenant_id, count(*)::bigint FROM app_user u WHERE u.status = 'ACTIVE' GROUP BY u.tenant_id;
END
$$;
REVOKE ALL ON FUNCTION platform_tenant_user_counts() FROM PUBLIC;
-- Supabase's default privileges can also hand new functions to its own API roles; the app schema is not exposed to them, but
-- least privilege says they get nothing. (These roles do not exist on a plain PostgreSQL, hence the check.)
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION platform_tenant_user_counts() FROM %I', r);
    END IF;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION platform_tenant_user_counts() TO dsa_app;

-- 9. data_correction_request keeps its tenant_isolation policy: it holds business values and references, so the platform realm
--    gets no access to it. The 0046 shape (entity, field, old and new value) does not match the API (justification, script
--    reference, requester, approver), so the API columns are added and the legacy ones become optional. The only existing row is a
--    leftover live-test record. SOD-08 (ENT-112): the approver differs from the requester, as a constraint.
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS justification       text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS script_ref          text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS target_entity       text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS change_description  text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS dry_run_diff_key    text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS dry_run_diff        text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS requested_by        text;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS executed_at         timestamptz;
ALTER TABLE data_correction_request ADD COLUMN IF NOT EXISTS executor_identity   text NOT NULL DEFAULT 'SERVICE:data-correction-executor';
ALTER TABLE data_correction_request ALTER COLUMN entity_type  DROP NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN entity_id    DROP NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN field_name   DROP NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN new_value    DROP NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN reason       DROP NOT NULL;
ALTER TABLE data_correction_request ALTER COLUMN submitted_by DROP NOT NULL;
ALTER TABLE data_correction_request DROP CONSTRAINT IF EXISTS data_correction_request_status_check;
ALTER TABLE data_correction_request ADD CONSTRAINT data_correction_request_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'));
ALTER TABLE data_correction_request ADD CONSTRAINT data_correction_request_sod08_check
  CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by);
-- A row is either the legacy shape (submitted_by) or the API shape (requester, justification and script reference).
ALTER TABLE data_correction_request ADD CONSTRAINT data_correction_request_shape_check
  CHECK (submitted_by IS NOT NULL OR (requested_by IS NOT NULL AND justification IS NOT NULL AND script_ref IS NOT NULL));
