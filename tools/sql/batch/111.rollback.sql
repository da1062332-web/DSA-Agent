-- Rollback migration 0111 (application collateral, task P1-03).
-- Refuses while any collateral row exists, removed ones included: dropping them would destroy loan-file data, which needs a decision,
-- not a script. Otherwise it drops the empty table. One transaction; run the verify script afterwards (its rows then FAIL, as before
-- the apply).
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE v_rows bigint;
BEGIN
  IF to_regclass('app.application_collateral') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM app.application_collateral' INTO v_rows;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'Rollback 0111 refused: % application collateral rows exist', v_rows;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS application_collateral;

COMMIT;
