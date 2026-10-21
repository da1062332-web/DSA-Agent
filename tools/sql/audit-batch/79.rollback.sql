-- Roll back migration 0079. Refused once a lender has a reason map.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lender' AND column_name = 'reason_map') THEN
    IF EXISTS (SELECT 1 FROM app.lender WHERE reason_map <> '[]'::jsonb) THEN
      RAISE EXCEPTION 'Rollback aborted: lenders have reason maps. Manual review required.';
    END IF;
  END IF;
END $$;
ALTER TABLE app.lender DROP CONSTRAINT IF EXISTS lender_reason_map_check;
ALTER TABLE app.lender DROP COLUMN IF EXISTS reason_map;
COMMIT;
