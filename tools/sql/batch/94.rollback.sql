-- Roll back migration 20261001000094 (MOD-ELG applicant figures, assessment provenance, feature flag). WRITES.
-- Use only if the migration must come out before the new code is used. It refuses, and changes nothing, when a rollback would
-- destroy data: applicant figures, assessment provenance, or a tenant's own setting of the credit-entry flag. Export or clear those
-- first, then run it again. Run it as one transaction, so it either completes or changes nothing.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.applicant_financial_input) THEN
    RAISE EXCEPTION 'applicant_financial_input has rows: export and clear them before rolling back 0094';
  END IF;
  IF EXISTS (SELECT 1 FROM app.eligibility_assessment
              WHERE product_version_id IS NOT NULL OR rule_set_version_id IS NOT NULL OR rule_set_version_no IS NOT NULL
                 OR decision_status IS NOT NULL OR input_hash IS NOT NULL
                 OR cardinality(matched_rule_uids) > 0 OR cardinality(missing_data) > 0) THEN
    RAISE EXCEPTION 'eligibility assessments carry provenance: rolling back would drop it';
  END IF;
  IF EXISTS (SELECT 1 FROM app.tenant_feature_flag WHERE key = 'eligibility.manual_credit_entry') THEN
    RAISE EXCEPTION 'a tenant has its own setting of eligibility.manual_credit_entry: remove it before rolling back 0094';
  END IF;
END $$;
DROP INDEX IF EXISTS app.eligibility_assessment_product_idx;
DROP INDEX IF EXISTS app.eligibility_assessment_latest_idx;
ALTER TABLE app.eligibility_assessment
  DROP COLUMN IF EXISTS missing_data,
  DROP COLUMN IF EXISTS matched_rule_uids,
  DROP COLUMN IF EXISTS input_hash,
  DROP COLUMN IF EXISTS decision_status,
  DROP COLUMN IF EXISTS rule_set_version_no,
  DROP COLUMN IF EXISTS rule_set_version_id,
  DROP COLUMN IF EXISTS product_version_id;
DROP TABLE IF EXISTS app.applicant_financial_input;
DELETE FROM app.feature_flag WHERE key = 'eligibility.manual_credit_entry' AND scope = 'TENANT';
COMMIT;
