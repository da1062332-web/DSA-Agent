-- Roll back migration 0075. Refused once a customer was merged.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'customer' AND column_name = 'merged_into_id') THEN
    IF EXISTS (SELECT 1 FROM app.customer WHERE merged_into_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: customers were merged. Manual review required.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS app.merge_customer_links(text, text, text);
ALTER TABLE app.customer DROP CONSTRAINT IF EXISTS customer_merged_into_fk, DROP CONSTRAINT IF EXISTS customer_merged_into_check;
ALTER TABLE app.customer DROP COLUMN IF EXISTS merged_into_id;
REVOKE UPDATE (is_primary) ON app.customer_contact_point FROM dsa_app;
COMMIT;
