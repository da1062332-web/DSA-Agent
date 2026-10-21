-- Roll back migration 0066. The table is dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.lender_query') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.lender_query) THEN
      RAISE EXCEPTION 'Rollback aborted: app.lender_query holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.lender_query;
DROP FUNCTION IF EXISTS app.lender_query_answer_once();
COMMIT;
