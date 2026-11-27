-- Migration 0138: a verification record can hold the check type BANK_ACCOUNT (the bank-account penny drop, task P1-06).
-- Why: the server now runs a penny drop at the tenant's KYC provider (a Rs 1 transfer to the customer's account, which returns the name the
-- bank holds) and stores the answer as a verification record. The CHECK on verification.check_type lists nine types and BANK_ACCOUNT is not
-- one of them (BANK_STATEMENT is the analysis of an uploaded statement, P4-15), so the insert would be refused AFTER the Rs 1 was sent.
--
-- What it does: widens that one CHECK so it also accepts BANK_ACCOUNT. The list is READ from the existing constraint and BANK_ACCOUNT is
-- appended; the list is never retyped, so a database whose list differs from a fresh build keeps every value it has. The constraint keeps its
-- name. Additive: no row is read or changed (the table is append-only, verification_no_mutation) and no value is removed.
--
-- Idempotent: when the CHECK already accepts BANK_ACCOUNT it does nothing. It refuses, and changes nothing, when it cannot find exactly one
-- CHECK on check_type or does not understand the list it finds.
-- Not applied to hosted. The owner applies it, and BEFORE the application code that runs bank-account checks is deployed.

SET search_path = app, extensions, public;

DO $$
DECLARE
  v_found  integer;
  v_name   text;
  v_def    text;
  v_values text[];
BEGIN
  SELECT count(*), min(k.conname::text), min(pg_get_constraintdef(k.oid))
    INTO v_found, v_name, v_def
    FROM pg_constraint k
   WHERE k.conrelid = 'app.verification'::regclass
     AND k.contype = 'c'
     AND pg_get_constraintdef(k.oid) LIKE '%check_type%';
  IF v_found <> 1 THEN
    RAISE EXCEPTION 'migration 0138 refused: expected exactly one CHECK on app.verification.check_type, found %', v_found;
  END IF;

  IF v_def LIKE '%''BANK_ACCOUNT''%' THEN
    RETURN; -- already accepted: nothing to do
  END IF;

  SELECT array_agg(m[1] ORDER BY n)
    INTO v_values
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n);
  IF v_values IS NULL
     OR NOT (v_values @> ARRAY['PAN', 'GST'])
     OR EXISTS (SELECT 1 FROM unnest(v_values) AS v WHERE v !~ '^[A-Z_]+$') THEN
    RAISE EXCEPTION 'migration 0138 refused: the check-type list of constraint % is not the expected list of quoted names', v_name;
  END IF;

  EXECUTE format('ALTER TABLE app.verification DROP CONSTRAINT %I', v_name);
  EXECUTE format(
    'ALTER TABLE app.verification ADD CONSTRAINT %I CHECK (check_type IN (%s))',
    v_name,
    (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord)
       FROM unnest(v_values || 'BANK_ACCOUNT'::text) WITH ORDINALITY AS u(v, ord))
  );
END
$$;
