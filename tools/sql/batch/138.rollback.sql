-- Roll back migration 0138: the verification check_type CHECK no longer accepts BANK_ACCOUNT. Changes no row.
-- Guarded: refused while any BANK_ACCOUNT verification exists. A verification record is immutable (verification_no_mutation), so it cannot be
-- deleted or changed, and a CHECK that does not allow its value would leave the table with a row that breaks its own rule. Keep the value then.
-- Run it only with the application version that does not run bank-account checks: that code writes BANK_ACCOUNT records, and after this
-- rollback the insert is refused (after the Rs 1 transfer was already sent).
-- The list is read from the constraint and BANK_ACCOUNT is removed from it; the list is never retyped. Idempotent: when the CHECK does not
-- list BANK_ACCOUNT it does nothing. One transaction; any RAISE rolls the whole thing back.
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE
  v_rows   bigint;
  v_found  integer;
  v_name   text;
  v_def    text;
  v_values text[];
BEGIN
  SELECT count(*) INTO v_rows FROM app.verification WHERE check_type = 'BANK_ACCOUNT';
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'migration 0138 rollback refused: % BANK_ACCOUNT verification record(s) exist. Verification records are immutable; keep the value.', v_rows;
  END IF;

  SELECT count(*), min(k.conname::text), min(pg_get_constraintdef(k.oid))
    INTO v_found, v_name, v_def
    FROM pg_constraint k
   WHERE k.conrelid = 'app.verification'::regclass
     AND k.contype = 'c'
     AND pg_get_constraintdef(k.oid) LIKE '%check_type%';
  IF v_found <> 1 THEN
    RAISE EXCEPTION 'migration 0138 rollback refused: expected exactly one CHECK on app.verification.check_type, found %', v_found;
  END IF;

  IF v_def NOT LIKE '%''BANK_ACCOUNT''%' THEN
    RETURN; -- already without BANK_ACCOUNT: nothing to do
  END IF;

  SELECT array_agg(m[1] ORDER BY n)
    INTO v_values
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n)
   WHERE m[1] <> 'BANK_ACCOUNT';

  EXECUTE format('ALTER TABLE app.verification DROP CONSTRAINT %I', v_name);
  EXECUTE format(
    'ALTER TABLE app.verification ADD CONSTRAINT %I CHECK (check_type IN (%s))',
    v_name,
    (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord) FROM unnest(v_values) WITH ORDINALITY AS u(v, ord))
  );
END
$$;
COMMIT;
