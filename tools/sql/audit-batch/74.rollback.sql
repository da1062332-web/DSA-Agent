-- Roll back migration 0074. Refused once a link, a review, a merged or an archived lead exists.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.apply_link') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.apply_link) THEN
      RAISE EXCEPTION 'Rollback aborted: app.apply_link holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.duplicate_review') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.duplicate_review) THEN
      RAISE EXCEPTION 'Rollback aborted: app.duplicate_review holds rows. Manual review required.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lead' AND column_name = 'merged_into_id') THEN
    IF EXISTS (SELECT 1 FROM app.lead WHERE merged_into_id IS NOT NULL OR archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: leads are merged or archived. Manual review required.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS app.resolve_public_apply_link(text);
DROP TABLE IF EXISTS app.duplicate_review, app.apply_link;
ALTER TABLE app.lead DROP CONSTRAINT IF EXISTS lead_merged_into_fk, DROP CONSTRAINT IF EXISTS lead_merged_into_check,
  DROP CONSTRAINT IF EXISTS lead_archived_at_check;
ALTER TABLE app.lead DROP COLUMN IF EXISTS merged_into_id, DROP COLUMN IF EXISTS archived_at;
COMMIT;
