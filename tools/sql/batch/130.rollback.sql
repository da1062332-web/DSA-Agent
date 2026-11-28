-- Roll back migration 0130 (credit-bureau soft pull, task P1-05). Owner: Prathamesh.
-- Run it only with the application version that does not read credit_report or accept BUREAU_PULL. One transaction: any RAISE rolls the whole
-- thing back.
-- Guarded. It is REFUSED while any credit_report row exists (a report is history: the table is append-only, so it cannot be emptied first, and
-- dropping it would destroy it) and while any BUREAU_PULL consent exists (a consent record is legal evidence that must stay, and a CHECK that
-- does not allow its purpose would leave the table with a row that breaks its own rule). Keep the objects in that case.
-- Otherwise it removes what 0130 added: the two role grants and permissions, the table, and BUREAU_PULL from the two consent_record CHECKs.
-- The CHECKs are rebuilt from the lists they hold (never retyped) and keep their names. Idempotent when nothing is left to remove.
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE
  v_reports  bigint := 0;
  v_consents bigint;
  v_n        integer;
  v_name     text;
  v_def      text;
  v_values   text[];
BEGIN
  IF to_regclass('app.credit_report') IS NOT NULL THEN
    SELECT count(*) INTO v_reports FROM app.credit_report;
  END IF;
  IF v_reports > 0 THEN
    RAISE EXCEPTION 'migration 0130 rollback refused: % credit_report row(s) exist. Credit reports are history and the table is append-only; keep it.', v_reports;
  END IF;
  SELECT count(*) INTO v_consents FROM app.consent_record WHERE purpose = 'BUREAU_PULL';
  IF v_consents > 0 THEN
    RAISE EXCEPTION 'migration 0130 rollback refused: % BUREAU_PULL consent record(s) exist. Consent records are legal evidence; keep the purpose.', v_consents;
  END IF;

  -- The purpose list, without BUREAU_PULL.
  SELECT count(*), min(c.name), min(c.def) INTO v_n, v_name, v_def
    FROM (SELECT k.conname::text AS name, pg_get_constraintdef(k.oid) AS def
            FROM pg_constraint k
           WHERE k.conrelid = 'app.consent_record'::regclass AND k.contype = 'c') c
   WHERE c.def LIKE '%''CONTACT''%' AND c.def LIKE '%''MARKETING''%' AND c.def NOT LIKE '%purpose_target%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'migration 0130 rollback refused: expected exactly one CHECK on app.consent_record.purpose, found %', v_n;
  END IF;
  IF v_def LIKE '%''BUREAU_PULL''%' THEN
    SELECT array_agg(m[1] ORDER BY n) INTO v_values
      FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n)
     WHERE m[1] <> 'BUREAU_PULL';
    EXECUTE format('ALTER TABLE app.consent_record DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE app.consent_record ADD CONSTRAINT %I CHECK (purpose IN (%s))',
      v_name,
      (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord) FROM unnest(v_values) WITH ORDINALITY AS u(v, ord))
    );
  END IF;

  -- The purpose_target rule, without BUREAU_PULL.
  SELECT count(*), min(c.name), min(c.def) INTO v_n, v_name, v_def
    FROM (SELECT k.conname::text AS name, pg_get_constraintdef(k.oid) AS def
            FROM pg_constraint k
           WHERE k.conrelid = 'app.consent_record'::regclass AND k.contype = 'c') c
   WHERE c.def LIKE '%purpose_target IS NOT NULL%' AND c.def LIKE '%''VERIFICATION_CHECK''%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'migration 0130 rollback refused: expected exactly one CHECK that requires purpose_target, found %', v_n;
  END IF;
  IF v_def LIKE '%''BUREAU_PULL''%' THEN
    SELECT array_agg(m[1] ORDER BY n) INTO v_values
      FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n)
     WHERE m[1] <> 'BUREAU_PULL';
    EXECUTE format('ALTER TABLE app.consent_record DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE app.consent_record ADD CONSTRAINT %I CHECK (purpose NOT IN (%s) OR purpose_target IS NOT NULL)',
      v_name,
      (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord) FROM unnest(v_values) WITH ORDINALITY AS u(v, ord))
    );
  END IF;
END
$$;

-- The permissions are new in M-130, so no role could hold them before it: removing every grant of them removes only what it added, plus
-- anything an administrator granted since (which has no meaning without the permission).
DELETE FROM app.role_permission WHERE permission_code IN ('credit_report.pull', 'credit_report.read');

DROP TABLE IF EXISTS app.credit_report;

DELETE FROM app.permission
 WHERE code IN ('credit_report.pull', 'credit_report.read')
   AND introduced_in = 'M-130';

COMMIT;
