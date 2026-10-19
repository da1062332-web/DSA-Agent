-- Roll back migration 0066: drop the per-tenant flag overrides table. WRITES. Not applied to hosted, so nothing to roll back there yet.
-- Refuses when any override exists: those rows are an operator's decisions (one per tenant and flag) and the table is the only place they live.
-- Export them first (SELECT * FROM app.tenant_feature_flag) and run again with the table empty, or decide they can go.
-- Do not run it while the API that reads tenant overrides is deployed: the tenant page in the platform console reads this table.
BEGIN;
SET search_path = app, extensions, public;
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('app.tenant_feature_flag') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM app.tenant_feature_flag' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'rollback 0066 refused: % tenant flag override(s) exist; export them first', n;
    END IF;
    DROP TABLE app.tenant_feature_flag;
  END IF;
END $$;
COMMIT;
