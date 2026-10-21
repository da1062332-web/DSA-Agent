-- Roll back migration 0071. The tables are dropped only when all are empty (documents, their history and the access log are records).
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.document_type') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document_type) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document_type holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.document') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.document_version') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document_version) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document_version holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.document_review') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document_review) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document_review holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.document_access_log') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document_access_log) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document_access_log holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.upload_intent') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.upload_intent) THEN
      RAISE EXCEPTION 'Rollback aborted: app.upload_intent holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.legal_hold') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.legal_hold) THEN
      RAISE EXCEPTION 'Rollback aborted: app.legal_hold holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.document_archive') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.document_archive) THEN
      RAISE EXCEPTION 'Rollback aborted: app.document_archive holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS app.resolve_upload_intent(text);
DROP TABLE IF EXISTS app.document_archive, app.legal_hold, app.upload_intent, app.document_access_log, app.document_review,
  app.document_version, app.document, app.document_type;
DROP FUNCTION IF EXISTS app.document_version_content_guard();
COMMIT;
