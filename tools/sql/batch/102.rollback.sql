-- Roll back migration 0102: remove the rule that a partner dispute must have a category. Changes no data.
-- Safe: the database accepts a partner dispute without a category again. The API still requires one, so the application behaviour is the same.
-- Run before 0101 and 0100 when rolling back the whole set.
BEGIN;
SET search_path = app, extensions, public;

ALTER TABLE dispute DROP CONSTRAINT IF EXISTS dispute_partner_category_required;
COMMIT;
