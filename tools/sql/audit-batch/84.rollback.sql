-- Roll back migration 0084. The table is dropped only when empty.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.referral_consent_otp') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.referral_consent_otp) THEN
      RAISE EXCEPTION 'Rollback aborted: app.referral_consent_otp holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.referral_consent_otp;
COMMIT;
