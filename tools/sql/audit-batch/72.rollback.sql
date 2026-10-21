-- Roll back migration 0072. Refused once a party was removed or has a relationship (that would be lost); the append-only trigger and the unique pair come back.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'application_party' AND column_name = 'removed_at') THEN
    IF EXISTS (SELECT 1 FROM app.application_party WHERE removed_at IS NOT NULL OR relationship_to_primary IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: parties were removed or given a relationship. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TRIGGER IF EXISTS application_party_remove_only ON app.application_party;
DROP FUNCTION IF EXISTS app.application_party_remove_only();
DROP INDEX IF EXISTS app.application_party_active_customer_uq;
ALTER TABLE app.application_party DROP CONSTRAINT IF EXISTS application_party_removed_check;
ALTER TABLE app.application_party DROP COLUMN IF EXISTS relationship_to_primary, DROP COLUMN IF EXISTS removed_at, DROP COLUMN IF EXISTS removed_by;
ALTER TABLE app.application_party DROP CONSTRAINT IF EXISTS application_party_application_id_customer_id_key;
ALTER TABLE app.application_party ADD CONSTRAINT application_party_application_id_customer_id_key UNIQUE (application_id, customer_id);
DROP TRIGGER IF EXISTS application_party_append_only ON app.application_party;
CREATE TRIGGER application_party_append_only BEFORE UPDATE OR DELETE ON app.application_party FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
COMMIT;
