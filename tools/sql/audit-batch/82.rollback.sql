-- Roll back migration 0082. The tables are dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.setting') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.setting) THEN
      RAISE EXCEPTION 'Rollback aborted: app.setting holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.label_set') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.label_set) THEN
      RAISE EXCEPTION 'Rollback aborted: app.label_set holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.business_calendar') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.business_calendar) THEN
      RAISE EXCEPTION 'Rollback aborted: app.business_calendar holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.picklist_value') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.picklist_value) THEN
      RAISE EXCEPTION 'Rollback aborted: app.picklist_value holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.config_bundle_draft') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.config_bundle_draft) THEN
      RAISE EXCEPTION 'Rollback aborted: app.config_bundle_draft holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.config_bundle_draft, app.picklist_value, app.business_calendar, app.label_set, app.setting;
COMMIT;
