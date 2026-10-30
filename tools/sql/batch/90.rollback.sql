-- Roll back migration 0090: drop the unique index and the source_event_id column.
-- Refuses, and changes nothing, if any notification carries a source_event_id (that would lose data).
BEGIN;
DO $$
BEGIN
  IF to_regclass('app.notification') IS NULL THEN
    RAISE NOTICE 'app.notification is absent; nothing to do';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM app.notification WHERE source_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'notifications carry source_event_id; rollback refused, nothing was changed';
  END IF;
  DROP INDEX IF EXISTS app.notification_source_event_uq;
  ALTER TABLE app.notification DROP COLUMN IF EXISTS source_event_id;
END $$;
COMMIT;
