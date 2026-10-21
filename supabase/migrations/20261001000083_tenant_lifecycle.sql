-- Migration: 20261001000083_tenant_lifecycle.sql
-- Owner: Dev 1 (MOD-TEN; API-TEN-001, 003, 004, 005, 006)
-- A platform session may only read the tenant table (M-050), so each lifecycle change is one SECURITY DEFINER function that
-- first checks is_platform_realm(). The functions are the whole write surface for tenants from the platform realm.
--   platform_provision_tenant: the tenant, its organisation and first branch, a ROLE-TENANT-ADMIN role holding every
--     non-platform permission, and the first administrator as an INVITED user (bound to an Auth account at first sign-in).
--     A taken slug raises 23505 (409 TENANT_SLUG_TAKEN in the API).
--   platform_set_tenant_status: suspend (ACTIVE → SUSPENDED) and reactivate (SUSPENDED → ACTIVE). Sign-in of a suspended
--     tenant's users already fails (resolve-principal checks tenant.status).
--   platform_request_offboarding: two approvers. The first operator's call records the request; a different operator's
--     call approves it and moves the tenant to OFFBOARDING. The exit export and purge are R3 (MOD-TEN SUB-TEN.02).
--   platform_set_entitlements: the modules a tenant may use, versioned (If-Match). The API answers 403 MODULE_NOT_ENABLED.

SET search_path = app, extensions, public;

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS entitlements_version integer NOT NULL DEFAULT 0;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

INSERT INTO permission (code, description, introduced_in) VALUES
  ('platform.tenant.create', 'Provision a tenant (MOD-TEN)', 'M-083'),
  ('platform.tenant.suspend', 'Suspend or reactivate a tenant (MOD-TEN)', 'M-083'),
  ('platform.tenant.offboard', 'Start offboarding a tenant, two approvers (MOD-TEN)', 'M-083'),
  ('platform.tenant.entitlements', 'Set the modules a tenant may use (MOD-TEN)', 'M-083')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG', 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ', code
  FROM permission WHERE code LIKE 'platform.tenant.%'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant_offboarding (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  requested_by  text NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  approved_by   text,
  approved_at   timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_offboarding_one_open ON tenant_offboarding (tenant_id) WHERE approved_at IS NULL;
ALTER TABLE tenant_offboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_offboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON tenant_offboarding FOR SELECT USING (is_platform_realm());
GRANT SELECT ON tenant_offboarding TO dsa_app;

CREATE OR REPLACE FUNCTION platform_require_realm() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform realm only' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION platform_provision_tenant(
  p_slug text, p_legal_name text, p_type text, p_region text, p_timezone text,
  p_admin_email text, p_admin_name text, p_actor text
) RETURNS TABLE (tenant_id text, admin_user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  t text := 'ten_' || new_ulid();
  o text := 'org_' || new_ulid();
  b text := 'br_' || new_ulid();
  r text := 'role_' || new_ulid();
  u text := 'usr_' || new_ulid();
BEGIN
  PERFORM platform_require_realm();
  INSERT INTO tenant (id, slug, legal_name, tenant_type, data_region, timezone, status, created_by)
  VALUES (t, p_slug, p_legal_name, p_type, p_region, p_timezone, 'ACTIVE', p_actor);
  INSERT INTO organisation (id, tenant_id, legal_name, constitution, status, created_by, updated_by)
  VALUES (o, t, p_legal_name, 'OTHER', 'ACTIVE', p_actor, p_actor);
  INSERT INTO branch (id, tenant_id, organisation_id, code, name, status, created_by, updated_by)
  VALUES (b, t, o, 'HO', 'Head office', 'ACTIVE', p_actor, p_actor);
  INSERT INTO role (id, tenant_id, code, name, is_template, created_by)
  VALUES (r, t, 'ROLE-TENANT-ADMIN', 'Tenant administrator', false, p_actor);
  INSERT INTO role_permission (tenant_id, role_id, permission_code)
  SELECT t, r, code FROM permission WHERE code NOT LIKE 'platform.%';
  INSERT INTO app_user (id, tenant_id, idp_subject, email, display_name, user_type, status, availability, primary_branch_id,
                        created_by, updated_by)
  VALUES (u, t, 'invite:' || u, lower(p_admin_email), p_admin_name, 'STAFF', 'INVITED', 'OFF_DUTY', b, p_actor, p_actor);
  INSERT INTO user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
  VALUES ('ura_' || new_ulid(), t, u, r, 'TENANT', '{}', p_actor);
  RETURN QUERY SELECT t, u;
END $$;

CREATE OR REPLACE FUNCTION platform_set_tenant_status(p_tenant text, p_status text, p_reason text, p_actor text)
RETURNS TABLE (id text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  cur text;
BEGIN
  PERFORM platform_require_realm();
  IF p_tenant = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG' THEN
    RAISE EXCEPTION 'the platform tenant cannot change status' USING ERRCODE = '22023';
  END IF;
  SELECT t.status INTO cur FROM tenant t WHERE t.id = p_tenant FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;
  IF NOT ((cur = 'ACTIVE' AND p_status = 'SUSPENDED') OR (cur = 'SUSPENDED' AND p_status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'tenant % cannot move from % to %', p_tenant, cur, p_status USING ERRCODE = 'P0001', HINT = 'INVALID_TRANSITION';
  END IF;
  UPDATE tenant t SET status = p_status, status_reason = p_reason, status_changed_at = now() WHERE t.id = p_tenant;
  RETURN QUERY SELECT p_tenant, p_status;
END $$;

CREATE OR REPLACE FUNCTION platform_request_offboarding(p_tenant text, p_reason text, p_actor text)
RETURNS TABLE (offboarding_id text, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  open_row tenant_offboarding%ROWTYPE;
  cur text;
BEGIN
  PERFORM platform_require_realm();
  SELECT t.status INTO cur FROM tenant t WHERE t.id = p_tenant FOR UPDATE;
  IF cur IS NULL OR p_tenant = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG' THEN RETURN; END IF;
  IF cur = 'OFFBOARDING' THEN
    RAISE EXCEPTION 'tenant % is already offboarding', p_tenant USING ERRCODE = 'P0001', HINT = 'INVALID_STATE';
  END IF;
  SELECT * INTO open_row FROM tenant_offboarding o WHERE o.tenant_id = p_tenant AND o.approved_at IS NULL FOR UPDATE;
  IF open_row.id IS NULL THEN
    INSERT INTO tenant_offboarding (id, tenant_id, reason, requested_by)
    VALUES ('tob_' || new_ulid(), p_tenant, p_reason, p_actor)
    RETURNING tenant_offboarding.id INTO open_row.id;
    RETURN QUERY SELECT open_row.id, 'AWAITING_SECOND_APPROVER'::text;
    RETURN;
  END IF;
  IF open_row.requested_by = p_actor THEN
    RAISE EXCEPTION 'offboarding needs a second approver' USING ERRCODE = 'P0001', HINT = 'SOD_VIOLATION';
  END IF;
  UPDATE tenant_offboarding o SET approved_by = p_actor, approved_at = now() WHERE o.id = open_row.id;
  UPDATE tenant t SET status = 'OFFBOARDING', status_reason = open_row.reason, status_changed_at = now() WHERE t.id = p_tenant;
  RETURN QUERY SELECT open_row.id, 'OFFBOARDING'::text;
END $$;

CREATE OR REPLACE FUNCTION platform_set_entitlements(p_tenant text, p_entitlements jsonb, p_expected_version integer, p_actor text)
RETURNS TABLE (id text, entitlements jsonb, entitlements_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  cur integer;
BEGIN
  PERFORM platform_require_realm();
  SELECT t.entitlements_version INTO cur FROM tenant t WHERE t.id = p_tenant FOR UPDATE;
  IF cur IS NULL THEN RETURN; END IF;
  IF cur <> p_expected_version THEN
    RAISE EXCEPTION 'stale entitlements version % (current %)', p_expected_version, cur USING ERRCODE = 'P0001', HINT = 'VERSION_CONFLICT';
  END IF;
  UPDATE tenant t SET entitlements = p_entitlements, entitlements_version = cur + 1 WHERE t.id = p_tenant;
  RETURN QUERY SELECT t.id, t.entitlements, t.entitlements_version FROM tenant t WHERE t.id = p_tenant;
END $$;

-- Every tenant reads its own entitlements (the module gate); tenant_self already allows its own row.
REVOKE ALL ON FUNCTION platform_provision_tenant(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_set_tenant_status(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_request_offboarding(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_set_entitlements(text, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_provision_tenant(text, text, text, text, text, text, text, text) TO dsa_app;
GRANT EXECUTE ON FUNCTION platform_set_tenant_status(text, text, text, text) TO dsa_app;
GRANT EXECUTE ON FUNCTION platform_request_offboarding(text, text, text) TO dsa_app;
GRANT EXECUTE ON FUNCTION platform_set_entitlements(text, jsonb, integer, text) TO dsa_app;
GRANT EXECUTE ON FUNCTION platform_require_realm() TO dsa_app;
