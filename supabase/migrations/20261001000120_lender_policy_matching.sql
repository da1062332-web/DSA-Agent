-- 20261001000120_lender_policy_matching.sql  (owner: Dipanshu — lenders, matching, reporting; task P1-04)
-- Lender policy grid and multi-lender matching. Additive, forward-only and idempotent: applying it twice changes nothing.
-- Not applied to the hosted project by this file: the owner applies it through the one-transaction wrapper, with
-- tools/sql/batch/120.verify.sql passing before (expect FAIL rows) and after (expect none). Rollback: tools/sql/batch/120.rollback.sql.
--   1. lender_policy: one lender's credit policy for one product version (min bureau score, ages, income, FOIR and LTV caps,
--      rate band, processing fee, serviceable pincodes, allowed constitutions and employment, vintage). Versioned DRAFT → ACTIVE →
--      RETIRED; at most one ACTIVE version per lender and product version. Activation is maker-checker: approved_by must not be
--      in editors (SOD-01, enforced by the API with rule.approve and step-up; the CHECK below keeps an ACTIVE row approved).
--   2. lender_match_run: one run of bre-core matchLenders for an application, with the inputs it used and their hash. Insert-only.
--   3. lender_match_result: one row per policy evaluated in a run (ELIGIBLE / NOT_ELIGIBLE / NEEDS_DATA). Insert-only.
--   4. Permissions lender_policy.read, lender_policy.manage, lender_match.run, granted to the customer-tenant roles below
--      (the same pairs as seeds/demo/platform.ts, so a new tenant gets them too). The DSA owner also gets the existing rule.approve,
--      so the owner can activate a policy someone else drafted (owner decision, 26 Nov 2026). rule.approve also approves BRE rule set
--      versions; SOD-01 still stops anyone approving their own draft.
-- Money is numeric(18,2) rupees like every other table; bre-core works in integer paise and the API converts.
-- No foreign key points at a table another P-task creates (plan §12.3): only lender, loan_product_version, loan_application.
SET search_path = app, extensions, public;

-- 1. Lender policy -----------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lender_policy (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  lender_id              text NOT NULL,
  product_version_id     text NOT NULL,
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  version_no             integer NOT NULL CHECK (version_no >= 1),
  min_bureau_score       smallint CHECK (min_bureau_score IS NULL OR min_bureau_score BETWEEN 300 AND 900),
  min_age                smallint CHECK (min_age IS NULL OR min_age BETWEEN 18 AND 100),
  max_age_at_maturity    smallint CHECK (max_age_at_maturity IS NULL OR max_age_at_maturity BETWEEN 18 AND 100),
  min_income             numeric(18,2) CHECK (min_income IS NULL OR min_income >= 0),
  foir_cap_bps           integer CHECK (foir_cap_bps IS NULL OR foir_cap_bps BETWEEN 1 AND 10000),
  ltv_cap_bps            integer CHECK (ltv_cap_bps IS NULL OR ltv_cap_bps BETWEEN 1 AND 10000),
  rate_min_bps           integer NOT NULL CHECK (rate_min_bps BETWEEN 0 AND 10000),
  rate_max_bps           integer NOT NULL CHECK (rate_max_bps BETWEEN 0 AND 10000),
  processing_fee_bps     integer CHECK (processing_fee_bps IS NULL OR processing_fee_bps BETWEEN 0 AND 10000),
  -- Full 6-digit pincodes or leading-digit prefixes (2–6 digits); empty serves everywhere.
  serviceable_pincodes   text[] NOT NULL DEFAULT '{}'
                         CHECK (array_to_string(serviceable_pincodes, ',') ~ '^([1-9][0-9]{1,5}(,[1-9][0-9]{1,5})*)?$'),
  allowed_constitutions  text[] NOT NULL DEFAULT '{}'
                         CHECK (array_to_string(allowed_constitutions, ',') ~ '^([A-Z][A-Z_]{1,39}(,[A-Z][A-Z_]{1,39})*)?$'),
  -- The application's applicant_type values (loan_application.applicant_type).
  allowed_employment     text[] NOT NULL DEFAULT '{}'
                         CHECK (allowed_employment <@ ARRAY['SALARIED','SELF_EMPLOYED_PROFESSIONAL','SELF_EMPLOYED_BUSINESS','NON_INDIVIDUAL']::text[]),
  min_vintage_months     integer CHECK (min_vintage_months IS NULL OR min_vintage_months BETWEEN 0 AND 1200),
  document_profile_id    text,
  effective_from         timestamptz NOT NULL,
  effective_to           timestamptz,
  -- Maker-checker (SOD-01): everyone who created or edited this version; the approver must not be one of them.
  editors                text[] NOT NULL DEFAULT '{}',
  approved_by            text,
  approved_at            timestamptz,
  retired_at             timestamptz,
  lock_version           integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lender_id, product_version_id, version_no),
  FOREIGN KEY (tenant_id, lender_id)          REFERENCES lender (tenant_id, id),
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES loan_product_version (tenant_id, id),
  CHECK (rate_max_bps >= rate_min_bps),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (min_age IS NULL OR max_age_at_maturity IS NULL OR max_age_at_maturity >= min_age),
  CHECK (status = 'DRAFT' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approved_by IS NULL OR NOT (approved_by = ANY (editors))),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS lender_policy_one_active_uq
  ON lender_policy (tenant_id, lender_id, product_version_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS lender_policy_lender_idx ON lender_policy (tenant_id, lender_id, status);
CREATE INDEX IF NOT EXISTS lender_policy_active_idx ON lender_policy (tenant_id, product_version_id) WHERE status = 'ACTIVE';
CREATE OR REPLACE TRIGGER lender_policy_touch BEFORE UPDATE ON lender_policy FOR EACH ROW EXECUTE FUNCTION touch_row();

-- 2. Match runs (insert-only) ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lender_match_run (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  application_id   text NOT NULL,
  inputs           jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  inputs_hash      text NOT NULL CHECK (inputs_hash ~ '^sha256:[0-9a-f]{64}$'),
  evaluated_at     timestamptz NOT NULL,
  policy_count     integer NOT NULL CHECK (policy_count >= 0),
  eligible_count   integer NOT NULL CHECK (eligible_count >= 0 AND eligible_count <= policy_count),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS lender_match_run_latest_idx
  ON lender_match_run (tenant_id, application_id, evaluated_at DESC, id DESC);

-- 3. Match results (insert-only) ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lender_match_result (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  run_id               text NOT NULL,
  rank                 integer NOT NULL CHECK (rank >= 1),
  policy_id            text NOT NULL,
  lender_id            text NOT NULL,
  product_version_id   text NOT NULL,
  outcome              text NOT NULL CHECK (outcome IN ('ELIGIBLE','NOT_ELIGIBLE','NEEDS_DATA')),
  reasons              text[] NOT NULL DEFAULT '{}',
  missing_fields       text[] NOT NULL DEFAULT '{}',
  eligible_amount      numeric(18,2) CHECK (eligible_amount IS NULL OR eligible_amount > 0),
  limited_by           text CHECK (limited_by IS NULL OR limited_by IN ('REQUESTED','PRODUCT_MAX','FOIR','LTV')),
  emi_min              numeric(18,2) CHECK (emi_min IS NULL OR emi_min >= 0),
  emi_max              numeric(18,2) CHECK (emi_max IS NULL OR emi_max >= 0),
  foir_bps             integer CHECK (foir_bps IS NULL OR foir_bps >= 0),
  processing_fee       numeric(18,2) CHECK (processing_fee IS NULL OR processing_fee >= 0),
  currency             char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, rank),
  FOREIGN KEY (tenant_id, run_id)             REFERENCES lender_match_run (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_id)          REFERENCES lender_policy (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id)          REFERENCES lender (tenant_id, id),
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES loan_product_version (tenant_id, id),
  CHECK ((outcome = 'ELIGIBLE') = (eligible_amount IS NOT NULL)),
  CHECK ((outcome = 'ELIGIBLE') = (emi_min IS NOT NULL AND emi_max IS NOT NULL)),
  CHECK (outcome <> 'NOT_ELIGIBLE' OR cardinality(reasons) > 0),
  CHECK (outcome <> 'NEEDS_DATA' OR cardinality(missing_fields) > 0)
);

-- Row-level security (tenant_id = app_tenant()). enable_tenant_rls creates the policy, so skip a table that already has it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lender_policy','lender_match_run','lender_match_result'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format('CALL enable_tenant_rls(%L)', 'app.' || t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON lender_policy TO dsa_app;
GRANT SELECT, INSERT ON lender_match_run, lender_match_result TO dsa_app;   -- history is never rewritten

-- 4. Permissions and role grants ---------------------------------------------------------------------------------------------
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('lender_policy.read', 'View lender policies (the policy grid) and their versions', 'M-120'),
  ('lender_policy.manage', 'Create and edit lender policy drafts and retire policies; activation also needs rule.approve', 'M-120'),
  ('lender_match.run', 'Run multi-lender matching for an application and view its results', 'M-120')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, g.permission_code
  FROM (VALUES
    ('ROLE-ORG-OWNER',  'lender_policy.read'),
    ('ROLE-ORG-OWNER',  'lender_policy.manage'),
    ('ROLE-ORG-OWNER',  'lender_match.run'),
    ('ROLE-ORG-OWNER',  'rule.approve'),
    ('ROLE-POLICY-MGR', 'lender_policy.read'),
    ('ROLE-POLICY-MGR', 'lender_policy.manage'),
    ('ROLE-LOAN-OPS',   'lender_policy.read'),
    ('ROLE-LOAN-OPS',   'lender_match.run'),
    ('ROLE-BRANCH-MGR', 'lender_policy.read'),
    ('ROLE-BRANCH-MGR', 'lender_match.run'),
    ('ROLE-RM',         'lender_policy.read'),
    ('ROLE-RM',         'lender_match.run')
  ) AS g(role_code, permission_code)
  JOIN app.role r ON r.code = g.role_code
  JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
ON CONFLICT DO NOTHING;
