-- Migration: 20261001000057_role_assignment_end.sql
-- Owner: Dev 1 (Modules 2 and 3: users and roles)
-- Removing a role from a user ended in 409: the API deleted the assignment row, and dsa_app may only SELECT and INSERT on
-- user_role_assignment. Assignments are effective-dated and the principal resolver already ignores one whose range has ended,
-- so removal now ENDS the assignment (closes effective_range) and keeps the row as history. No DELETE is granted.
--  1. dsa_app may UPDATE the effective_range column only (column-level grant; RLS still limits it to the caller's tenant).
--  2. A trigger allows exactly one change: closing an open range at or before now(). It cannot reopen, extend or move one.

SET search_path = app, extensions, public;

GRANT UPDATE (effective_range) ON app.user_role_assignment TO dsa_app;

CREATE OR REPLACE FUNCTION app.user_role_assignment_close_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effective_range IS NOT DISTINCT FROM OLD.effective_range THEN
    RETURN NEW;
  END IF;
  IF isempty(OLD.effective_range) OR NOT upper_inf(OLD.effective_range) THEN
    RAISE EXCEPTION 'A role assignment that has ended cannot be changed.' USING ERRCODE = '42501';
  END IF;
  -- The new range closes the old one: same start (or empty, when it ends the moment it began), and an end that is not in the future.
  IF NOT isempty(NEW.effective_range)
     AND (lower(NEW.effective_range) IS DISTINCT FROM lower(OLD.effective_range)
          OR upper_inf(NEW.effective_range)
          OR upper(NEW.effective_range) > now()) THEN
    RAISE EXCEPTION 'A role assignment can only be ended, at or before the present moment.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_role_assignment_close_only ON app.user_role_assignment;
CREATE TRIGGER user_role_assignment_close_only BEFORE UPDATE ON app.user_role_assignment
  FOR EACH ROW EXECUTE FUNCTION app.user_role_assignment_close_only();
