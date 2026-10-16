-- Migration: 20261001000059_role_management_grants.sql
-- Owner: Dev 1 (Modules 4 and 5: users and access control)
-- Editing or deleting a role from the API ended in 409 for everyone: dsa_app could only SELECT and INSERT on role and role_permission,
-- so the endpoints' UPDATE and DELETE statements were refused. This gives it exactly what those endpoints need, and guards it:
--  1. dsa_app may UPDATE two columns of role, name and version, and nothing else (column-level grant). RLS still limits it to its tenant.
--  2. dsa_app may DELETE from role and role_permission. RLS limits that to the caller's tenant; triggers add the rules below.
--  3. System (template) roles can never be renamed, deleted or have a permission removed through the application logins (dsa_app, dsa_api).
--     They are the baseline every tenant starts from. The owner (migrations and runbooks) is not restricted, so rollbacks still work.
--  4. A role that has ever been assigned cannot be deleted: its assignments are history (and a foreign key would refuse anyway).

SET search_path = app, extensions, public;

GRANT UPDATE (name, version) ON app.role TO dsa_app;
GRANT DELETE ON app.role, app.role_permission TO dsa_app;

CREATE OR REPLACE FUNCTION app.role_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The rules are for the application logins. The owner (migrations, runbooks, rollbacks) is not restricted by them.
  IF current_user NOT IN ('dsa_app', 'dsa_api') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF OLD.is_template THEN
    RAISE EXCEPTION 'System roles cannot be changed or deleted.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM app.user_role_assignment WHERE tenant_id = OLD.tenant_id AND role_id = OLD.id) THEN
      RAISE EXCEPTION 'A role that has been assigned keeps its assignment history and cannot be deleted.' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS role_guard ON app.role;
CREATE TRIGGER role_guard BEFORE UPDATE OR DELETE ON app.role
  FOR EACH ROW EXECUTE FUNCTION app.role_guard();

CREATE OR REPLACE FUNCTION app.role_permission_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('dsa_app', 'dsa_api') THEN
    RETURN OLD;
  END IF;
  -- A permission may be removed from a custom role only. The role's own deletion removes its permissions first, so it passes here
  -- only for a role that role_guard also lets go.
  IF EXISTS (SELECT 1 FROM app.role r WHERE r.tenant_id = OLD.tenant_id AND r.id = OLD.role_id AND r.is_template) THEN
    RAISE EXCEPTION 'Permissions of a system role cannot be removed.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS role_permission_guard ON app.role_permission;
CREATE TRIGGER role_permission_guard BEFORE DELETE ON app.role_permission
  FOR EACH ROW EXECUTE FUNCTION app.role_permission_guard();
