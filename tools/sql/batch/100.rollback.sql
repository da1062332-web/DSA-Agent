-- Roll back migration 0100: remove the dispute category and the partner upload approval flag. Changes no other data.
-- Guarded: the rollback refuses while a partner dispute has a category or a document type is approved for partners, because dropping the
-- columns would erase that record. To roll back, first clear the values with the owner's approval (a categorised dispute is a record the
-- business keeps; a non-null category must be recorded, not erased, so the guard is deliberately strict).
-- Run inside one transaction; any RAISE rolls the whole thing back.
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE
  categorised bigint;
  approved bigint;
BEGIN
  SELECT count(*) INTO categorised FROM app.dispute WHERE category IS NOT NULL;
  SELECT count(*) INTO approved FROM app.document_type WHERE partner_upload;
  IF categorised > 0 OR approved > 0 THEN
    RAISE EXCEPTION 'migration 0100 rollback refused: % dispute(s) carry a category and % document type(s) are approved for partners. Record the decision first.',
      categorised, approved;
  END IF;
END
$$;

ALTER TABLE dispute DROP CONSTRAINT IF EXISTS dispute_category_check;
ALTER TABLE dispute DROP COLUMN IF EXISTS category;
ALTER TABLE document_type DROP COLUMN IF EXISTS partner_upload;
COMMIT;
