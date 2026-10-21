-- Roll back migration 0077. The table is dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.inbound_webhook') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.inbound_webhook) THEN
      RAISE EXCEPTION 'Rollback aborted: app.inbound_webhook holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.inbound_webhook;
COMMIT;
