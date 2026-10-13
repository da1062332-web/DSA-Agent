-- 0004_activity_updates.sql (owner: Dev 1, TASK-109 / MOD-ACT)
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- Add optimistic concurrency, audit metadata, and soft-hiding support to ENT-032 activity
ALTER TABLE activity
  ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by text;

-- Replace forbid_mutation trigger with touch_row for updates, while continuing to forbid deletes
DROP TRIGGER IF EXISTS activity_append_only ON activity;

CREATE TRIGGER activity_touch_row
  BEFORE UPDATE ON activity
  FOR EACH ROW
  EXECUTE FUNCTION touch_row();

CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % cannot be deleted; soft-hide instead', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER activity_forbid_delete
  BEFORE DELETE ON activity
  FOR EACH ROW
  EXECUTE FUNCTION forbid_delete();

-- Grant UPDATE privilege to dsa_app (DELETE is strictly omitted to preserve REL-001 check b)
GRANT UPDATE ON activity TO dsa_app;

-- Seed permission for activity updates
INSERT INTO permission (code, description, introduced_in)
VALUES ('activity.update', 'Update or hide activity records', 'MVP-4D')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS activity_visibility_idx ON activity (tenant_id, is_hidden, occurred_at DESC);
