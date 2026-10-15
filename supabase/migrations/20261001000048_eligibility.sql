-- 0048_eligibility.sql  (owner: Dev 3, MOD-ELG Eligibility, DSA Notion MODULE 17, ENT-050)
-- Additive. Applied to the hosted project on 2026-10-15 with Vaibhav's approval; table, RLS policy, grants and permission verified.
-- Stores each preliminary eligibility assessment of an application. Results are per product version and per criterion
-- (PASS, FAIL or UNKNOWN). A criterion whose data or rule is unavailable is UNKNOWN. Overrides are appended with a reason.
-- Assessments are never deleted. No role is granted eligibility.override here: who may override is a business decision.
SET search_path = app, extensions, public;

CREATE TABLE eligibility_assessment (                              -- ENT-050
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  application_id      text NOT NULL,
  assessed_at         timestamptz NOT NULL DEFAULT now(),
  results             jsonb NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  decision_record_ids text[] NOT NULL DEFAULT '{}',
  overrides           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(overrides) = 'array'),
  lock_version        integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id)
);
CREATE INDEX eligibility_assessment_app_idx ON eligibility_assessment (tenant_id, application_id, assessed_at DESC);

CREATE TRIGGER eligibility_assessment_touch BEFORE UPDATE ON eligibility_assessment FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('eligibility_assessment');
GRANT SELECT, INSERT, UPDATE ON eligibility_assessment TO dsa_app;

INSERT INTO permission (code, description, introduced_in) VALUES
  ('eligibility.override', 'Override an eligibility result with a recorded reason', 'MOD-ELG')
ON CONFLICT DO NOTHING;
