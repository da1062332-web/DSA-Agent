-- Migration: 20261001000051_approved_eligibility_rules.sql
-- Owner: Akash (Dev 2 / Coordinator, Module 20/23: Business Rule Engine)
-- Covers:
-- 1. Seed approved rule sets, active version (v1), and rules for DK-application.eligibility across all tenants
-- 2. Grant eligibility.override to approver roles (ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS, ROLE-TENANT-ADMIN)
SET search_path = app, extensions, public;

-- ============================================================================
-- 1. Ensure DK-application.eligibility decision definition exists
-- ============================================================================
INSERT INTO app.decision_definition (
  key,
  registry_version,
  tier,
  input_schema,
  output_schema,
  allowed_hit_policies,
  binding_mode,
  fallback_policy,
  fallback_output,
  unknown_policy,
  recording_level,
  scope_chain,
  overridable,
  enabled
) VALUES (
  'DK-application.eligibility',
  '1-mvp',
  'T1',
  '{"type":"object","properties":{"applicant":{"type":"object"},"application":{"type":"object"},"product":{"type":"object"}},"required":["application","product"]}'::jsonb,
  '{"type":"object","properties":{"result":{"type":"string","enum":["ELIGIBLE","INELIGIBLE","REFER"]},"maxEligibleAmount":{"type":["object","null"]},"reasons":{"type":"array","items":{"type":"object"}}},"required":["result","reasons"]}'::jsonb,
  ARRAY['FIRST','PRIORITY','UNIQUE']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"result":"REFER","maxEligibleAmount":null,"reasons":[{"code":"MANUAL_REVIEW","text":"Application referred for underwriter review"}]}'::jsonb,
  'UNDETERMINED',
  'ALWAYS',
  ARRAY['PRODUCT_VERSION','TENANT_DEFAULT']::text[],
  true,
  true
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Seed active rule_set for DK-application.eligibility for all existing tenants
-- ============================================================================
INSERT INTO app.rule_set (
  id,
  tenant_id,
  decision_key,
  scope_type,
  scope_ref,
  name,
  owner_user_id,
  origin,
  status,
  created_by,
  updated_by
)
SELECT 
  'rs_elg_' || substr(md5(t.id || 'DK-application.eligibility'), 1, 22),
  t.id,
  'DK-application.eligibility',
  'TENANT_DEFAULT',
  NULL,
  'Approved Retail Eligibility Rules',
  NULL,
  'PLATFORM_SEED',
  'ACTIVE',
  'SYSTEM:platform',
  'SYSTEM:platform'
FROM app.tenant t
ON CONFLICT (tenant_id, decision_key, scope_type, coalesce(scope_ref, '-')) DO NOTHING;

-- ============================================================================
-- 3. Seed active rule_set_version for DK-application.eligibility
-- ============================================================================
INSERT INTO app.rule_set_version (
  id,
  tenant_id,
  rule_set_id,
  version_no,
  status,
  hit_policy,
  authoring_form,
  definition,
  default_output,
  content_hash,
  effective_range,
  change_reason,
  created_by,
  published_by,
  published_at
)
SELECT 
  'rsv_elg_' || substr(md5(rs.id || '_v1'), 1, 21),
  rs.tenant_id,
  rs.id,
  1,
  'ACTIVE',
  'FIRST',
  'RULES',
  '{"schemaVersion":1,"hitPolicy":"FIRST","defaultOutput":{"result":"REFER","maxEligibleAmount":null,"reasons":[{"code":"MANUAL_REVIEW","text":"Application referred for underwriter review"}]},"rules":[{"uid":"RUL-ELG-001","name":"Low Credit Score Rejection","description":"Reject applicant if credit bureau score is below 600","orderNo":0,"priority":100,"enabled":true,"conditions":[{"field":"applicant.credit_score","operator":"<","value":600}],"output":{"result":"INELIGIBLE","maxEligibleAmount":null,"reasons":[{"code":"CREDIT_SCORE_LOW","text":"Credit bureau score below acceptable threshold (min 600)"}]},"explanation":"Bureau score of applicant is below credit risk cutoff"},{"uid":"RUL-ELG-002","name":"Minimum Net Monthly Income Rejection","description":"Reject applicant if monthly net income is below 25,000 INR","orderNo":1,"priority":90,"enabled":true,"conditions":[{"field":"applicant.monthly_income.amount","operator":"<","value":25000}],"output":{"result":"INELIGIBLE","maxEligibleAmount":null,"reasons":[{"code":"INCOME_BELOW_MINIMUM","text":"Monthly net income is below minimum requirement of 25,000 INR"}]},"explanation":"Net take-home income does not meet minimum retail borrowing cutoff"},{"uid":"RUL-ELG-003","name":"Prime Borrower High Eligibility Pass","description":"Applicant with credit score >= 750 and income >= 75,000 qualifies for prime sanction","orderNo":2,"priority":80,"enabled":true,"conditions":[{"field":"applicant.credit_score","operator":">=","value":750},{"field":"applicant.monthly_income.amount","operator":">=","value":75000}],"output":{"result":"ELIGIBLE","maxEligibleAmount":{"amount":"2500000.00","currency":"INR"},"reasons":[{"code":"PRIME_BORROWER_ELIGIBLE","text":"Applicant meets prime credit and income benchmarks"}]},"explanation":"High credit score and strong income qualification"},{"uid":"RUL-ELG-004","name":"Standard Salaried Borrower Pass","description":"Applicant with credit score >= 650 and income >= 25,000 qualifies for standard sanction","orderNo":3,"priority":70,"enabled":true,"conditions":[{"field":"applicant.credit_score","operator":">=","value":650},{"field":"applicant.monthly_income.amount","operator":">=","value":25000}],"output":{"result":"ELIGIBLE","maxEligibleAmount":{"amount":"1000000.00","currency":"INR"},"reasons":[{"code":"STANDARD_ELIGIBLE","text":"Applicant satisfies standard eligibility criteria"}]},"explanation":"Satisfies baseline credit and income requirements"}]}'::jsonb,
  '{"result":"REFER","maxEligibleAmount":null,"reasons":[{"code":"MANUAL_REVIEW","text":"Application referred for underwriter review"}]}'::jsonb,
  'sha256:9e492649899860eb1d5491c443d001b167a6d8bd0fbefb45bd6fa827e9f5b3d2',
  tstzrange(now() - interval '30 days', NULL, '[)'),
  'Approved retail eligibility rules and underwriting criteria',
  'SYSTEM:platform',
  'SYSTEM:platform',
  now()
FROM app.rule_set rs
WHERE rs.decision_key = 'DK-application.eligibility'
  AND rs.scope_type = 'TENANT_DEFAULT'
ON CONFLICT (rule_set_id, version_no) DO NOTHING;

-- ============================================================================
-- 4. Seed indexed rules in rule_set_rule for fast inspection and audit
-- ============================================================================
INSERT INTO app.rule_set_rule (
  tenant_id,
  version_id,
  rule_uid,
  name,
  order_no,
  priority,
  enabled
)
SELECT 
  rsv.tenant_id,
  rsv.id,
  r->>'uid',
  r->>'name',
  (r->>'orderNo')::integer,
  (r->>'priority')::integer,
  (r->>'enabled')::boolean
FROM app.rule_set_version rsv,
     jsonb_array_elements(rsv.definition->'rules') AS r
WHERE rsv.content_hash = 'sha256:9e492649899860eb1d5491c443d001b167a6d8bd0fbefb45bd6fa827e9f5b3d2'
ON CONFLICT (version_id, rule_uid) DO NOTHING;

-- ============================================================================
-- 5. Grant eligibility.override to approver roles (ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS)
-- ============================================================================
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'eligibility.override'
FROM app.role r
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS', 'ROLE-TENANT-ADMIN')
ON CONFLICT DO NOTHING;
