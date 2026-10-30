-- 20261001000094_eligibility_inputs_and_provenance.sql  (owner: Dev 3, MOD-ELG Eligibility, Module 17)
-- Additive and forward-only. Not applied to the hosted project by this file: an authorised developer applies it after review
-- (see docs/PENDING_APPROVALS.md section 7 for the command and the checks).
--   1. applicant_financial_input: per-application inputs the approved eligibility rules read. Declared income (stated by the
--      applicant or estimated by sales) is kept apart from verified income, which needs an accepted income document from the
--      checklist. Credit data is kept only when it comes from an authorised report, with the report reference and its date.
--   2. eligibility_assessment: provenance of every new assessment (product version, rule set version, decision record, input
--      hash, matched rules and missing data). Existing rows keep NULL here: they were written by the stub and are not evaluations.
--   3. feature flag eligibility.manual_credit_entry: tenants opt in to recording a credit score by hand. Default off.
SET search_path = app, extensions, public;

CREATE TABLE applicant_financial_input (                         -- ENT-050 companion (MOD-ELG inputs)
  id                                 text PRIMARY KEY,
  tenant_id                          text NOT NULL REFERENCES tenant(id),
  application_id                     text NOT NULL,
  declared_monthly_income_amount     numeric(18,2) CHECK (declared_monthly_income_amount IS NULL OR declared_monthly_income_amount >= 0),
  declared_income_currency           char(3) NOT NULL DEFAULT 'INR' CHECK (declared_income_currency = 'INR'),
  declared_income_source             text CHECK (declared_income_source IS NULL OR declared_income_source IN ('APPLICANT_STATED','SALES_ESTIMATE')),
  declared_at                        timestamptz,
  declared_by                        text,
  verified_monthly_income_amount     numeric(18,2) CHECK (verified_monthly_income_amount IS NULL OR verified_monthly_income_amount >= 0),
  verified_income_currency           char(3) NOT NULL DEFAULT 'INR' CHECK (verified_income_currency = 'INR'),
  verified_income_checklist_item_id  text,
  verified_at                        timestamptz,
  verified_by                        text,
  credit_score                       smallint CHECK (credit_score IS NULL OR credit_score BETWEEN 300 AND 900),
  credit_report_reference            text CHECK (credit_report_reference IS NULL OR char_length(credit_report_reference) BETWEEN 1 AND 60),
  credit_report_date                 date,
  credit_entered_at                  timestamptz,
  credit_entered_by                  text,
  lock_version                       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  FOREIGN KEY (tenant_id, verified_income_checklist_item_id) REFERENCES checklist_item (tenant_id, id),
  CHECK ((verified_monthly_income_amount IS NULL) = (verified_income_checklist_item_id IS NULL)),
  CHECK ((declared_monthly_income_amount IS NULL) = (declared_income_source IS NULL)),
  CHECK ((credit_score IS NULL) = (credit_report_date IS NULL)),
  CHECK ((credit_score IS NULL) = (credit_report_reference IS NULL))
);
CREATE TRIGGER applicant_financial_input_touch BEFORE UPDATE ON applicant_financial_input FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('applicant_financial_input');
GRANT SELECT, INSERT, UPDATE ON applicant_financial_input TO dsa_app;

ALTER TABLE eligibility_assessment
  ADD COLUMN product_version_id   text,
  ADD COLUMN rule_set_version_id  text REFERENCES rule_set_version (id),
  ADD COLUMN rule_set_version_no  integer,
  ADD COLUMN decision_status      text,
  ADD COLUMN input_hash           text CHECK (input_hash IS NULL OR input_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN matched_rule_uids    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN missing_data         text[] NOT NULL DEFAULT '{}';
CREATE INDEX eligibility_assessment_latest_idx ON eligibility_assessment (tenant_id, application_id, assessed_at DESC, id DESC);
CREATE INDEX eligibility_assessment_product_idx ON eligibility_assessment (tenant_id, application_id, product_version_id);

INSERT INTO app.feature_flag (key, scope, value, owner, remove_by, description, updated_by)
VALUES ('eligibility.manual_credit_entry', 'TENANT', false, 'Dev 3', NULL,
        'MOD-ELG: staff may record a credit score taken from an authorised credit report. Off until the tenant policy allows manual credit data.',
        'SYSTEM:migration')
ON CONFLICT (key, scope) DO NOTHING;
