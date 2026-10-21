-- Migration: 20261001000072_application_party_removal.sql
-- Owner: Dev 3 (MOD-APP SUB-APP.02 parties, API-APP-006)
-- API-APP-006 adds or removes a co-applicant or guarantor. application_party is append-only (M-021), so a removal is recorded,
-- not deleted: removed_at and removed_by are set once, never on the PRIMARY party, and nothing else in the row may change.

SET search_path = app, extensions, public;

ALTER TABLE application_party ADD COLUMN IF NOT EXISTS relationship_to_primary text
  CHECK (relationship_to_primary IS NULL OR relationship_to_primary IN ('SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'PARTNER', 'DIRECTOR', 'OTHER'));
ALTER TABLE application_party ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE application_party ADD COLUMN IF NOT EXISTS removed_by text;
ALTER TABLE application_party DROP CONSTRAINT IF EXISTS application_party_removed_check;
ALTER TABLE application_party ADD CONSTRAINT application_party_removed_check
  CHECK ((removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL OR role <> 'PRIMARY'));

-- A removed co-applicant may be added again later, so a customer is unique among the parties still on the application.
ALTER TABLE application_party DROP CONSTRAINT IF EXISTS application_party_application_id_customer_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS application_party_active_customer_uq
  ON application_party (application_id, customer_id) WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION application_party_remove_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'application_party rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.removed_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['removed_at', 'removed_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['removed_at', 'removed_by']) THEN
    RAISE EXCEPTION 'application_party % can only be marked removed, once', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS application_party_append_only ON application_party;
CREATE TRIGGER application_party_remove_only BEFORE UPDATE OR DELETE ON application_party
  FOR EACH ROW EXECUTE FUNCTION application_party_remove_only();
GRANT UPDATE (removed_at, removed_by) ON application_party TO dsa_app;
