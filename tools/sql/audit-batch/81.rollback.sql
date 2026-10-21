-- Roll back migration 0081. The tables are dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.access_review') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.access_review) THEN
      RAISE EXCEPTION 'Rollback aborted: app.access_review holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.access_review_item') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.access_review_item) THEN
      RAISE EXCEPTION 'Rollback aborted: app.access_review_item holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.access_review_item, app.access_review;
COMMIT;
