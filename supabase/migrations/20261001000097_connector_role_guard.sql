-- Migration 0097: a connector portal login holds no role, and no staff account holds a reserved (ROLE-CONNECTOR) role.
-- Why: the permission check reads role grants only and never looks at user_type, so a role on a portal login reaches the tenant's
-- leads, applications and documents. Portal access is decided by the login's identity and its linked connector (/portal/v1), not by a
-- role. The API refuses such an assignment (apps/api/src/modules/platform/role-guards.ts). This migration makes the database refuse it
-- for every writer: the API, another migration, a tool, or a statement typed by hand.
--
-- Fail-closed: the precheck below stops this migration while a connector login holds a role that is not yet ended, or a staff account
-- holds a reserved role. It changes no existing row. Ending such an assignment is a separate, approved step: the audited API route
-- DELETE /v1/users/:id/roles/:roleId (docs/CONNECTOR_CONTAINMENT_RUNBOOK.md). It runs after migration 0054, so 0054's backfill on a
-- fresh database is not affected.
--
-- Concurrency: the assignment trigger takes a FOR SHARE lock on the user and the role row before it reads them. The user_type trigger
-- takes the user row lock before it looks for roles. A role assignment and a change of user type therefore wait for each other and
-- cannot interleave (tests: connector-role-guard.int.spec.ts, TEST-CONROLE-DB-006 and -007).
--
-- Rollback: 97.rollback.sql drops these triggers and functions. It restores the earlier behaviour and changes no data.
SET search_path = app, extensions, public;

-- Precheck: refuse to apply while the database holds a connector-login role or a staff reserved-role assignment that has not ended.
-- "Not ended" means the assignment is open-ended, or ends after now (it would be in force later).
DO $$
DECLARE
  v_connector_roles integer;
  v_reserved_staff integer;
BEGIN
  SELECT count(*) INTO v_connector_roles
    FROM app.user_role_assignment ura
    JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
   WHERE u.user_type = 'CONNECTOR' AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now());
  SELECT count(*) INTO v_reserved_staff
    FROM app.user_role_assignment ura
    JOIN app.app_user u ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
    JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
   WHERE u.user_type = 'STAFF' AND r.code LIKE 'ROLE-CONNECTOR%'
     AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now());
  IF v_connector_roles > 0 OR v_reserved_staff > 0 THEN
    RAISE EXCEPTION 'migration 0097 refused: % role assignment(s) on connector portal logins and % reserved-role assignment(s) on staff accounts have not ended. End them first (docs/CONNECTOR_CONTAINMENT_RUNBOOK.md), then apply this migration.',
      v_connector_roles, v_reserved_staff
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

-- 1. A role assignment: the user must be STAFF, and the role must not be in the reserved namespace.
CREATE OR REPLACE FUNCTION app.user_role_assignment_user_type_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_user_type text;
  v_role_code text;
BEGIN
  -- FOR SHARE: a concurrent change of this user's type waits for this statement, and this statement waits for that change.
  SELECT u.user_type INTO v_user_type FROM app.app_user u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id FOR SHARE;
  SELECT r.code INTO v_role_code FROM app.role r WHERE r.id = NEW.role_id AND r.tenant_id = NEW.tenant_id FOR SHARE;
  -- A missing user or role is reported by the foreign keys, not here.
  IF v_user_type IS NULL OR v_role_code IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_user_type = 'CONNECTOR' THEN
    RAISE EXCEPTION 'a connector portal login cannot hold the role % (portal access does not come from a role)', v_role_code
      USING ERRCODE = '42501';
  END IF;
  IF v_user_type IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'this kind of user cannot hold a role: %', v_user_type USING ERRCODE = '42501';
  END IF;
  IF v_role_code LIKE 'ROLE-CONNECTOR%' THEN
    RAISE EXCEPTION 'a staff account cannot hold the reserved connector role %', v_role_code USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.user_role_assignment_user_type_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS user_role_assignment_user_type_guard ON app.user_role_assignment;
CREATE TRIGGER user_role_assignment_user_type_guard
  BEFORE INSERT OR UPDATE OF user_id, role_id ON app.user_role_assignment
  FOR EACH ROW EXECUTE FUNCTION app.user_role_assignment_user_type_guard();

-- 2. A change of user type: a user that holds a role that has not ended cannot become anything but STAFF.
-- The row lock is taken first, so a concurrent assignment (which takes the same lock) finishes before this check reads the roles.
CREATE OR REPLACE FUNCTION app.app_user_type_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.user_type IS DISTINCT FROM OLD.user_type AND NEW.user_type IS DISTINCT FROM 'STAFF' THEN
    PERFORM 1 FROM app.app_user u WHERE u.id = NEW.id AND u.tenant_id = NEW.tenant_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM app.user_role_assignment ura
       WHERE ura.user_id = NEW.id AND ura.tenant_id = NEW.tenant_id
         AND (upper_inf(ura.effective_range) OR upper(ura.effective_range) > now())
    ) THEN
      RAISE EXCEPTION 'user % cannot become % while it holds a role; end its role assignments first', NEW.id, NEW.user_type
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.app_user_type_role_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS app_user_type_role_guard ON app.app_user;
CREATE TRIGGER app_user_type_role_guard
  BEFORE UPDATE OF user_type ON app.app_user
  FOR EACH ROW EXECUTE FUNCTION app.app_user_type_role_guard();

-- 3. A role may not be created or renamed into the reserved namespace.
CREATE OR REPLACE FUNCTION app.role_reserved_code_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
BEGIN
  IF NEW.code LIKE 'ROLE-CONNECTOR%' THEN
    RAISE EXCEPTION 'the role code % is reserved for the connector portal', NEW.code USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION app.role_reserved_code_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS role_reserved_code_guard ON app.role;
CREATE TRIGGER role_reserved_code_guard
  BEFORE INSERT OR UPDATE OF code ON app.role
  FOR EACH ROW EXECUTE FUNCTION app.role_reserved_code_guard();
