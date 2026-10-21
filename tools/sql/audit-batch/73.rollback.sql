-- Roll back migration 0073. Drops the two functions (nothing is stored by them).
BEGIN;
SET search_path = app, extensions, public;
DROP FUNCTION IF EXISTS app.handover_owned_records(text, text, text);
DROP FUNCTION IF EXISTS app.new_ulid();
COMMIT;
