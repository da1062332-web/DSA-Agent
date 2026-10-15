-- Migration: 20261001000011_rules_registry_mvp.sql (owner: Dev 2, Module 23: Business Rule Engine)
SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS decision_dependency (
  decision_key   text NOT NULL REFERENCES decision_definition(key),
  depends_on_key text NOT NULL REFERENCES decision_definition(key),
  required       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (decision_key, depends_on_key),
  CHECK (decision_key <> depends_on_key)
);

GRANT SELECT ON decision_dependency TO dsa_app;

-- Seed the 6 MVP Decision Definitions (TASK-204)
INSERT INTO decision_definition (
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
) VALUES
(
  'DK-lead.duplicate',
  '1-mvp',
  'T2',
  '{"type":"object","properties":{"pair":{"type":"object"},"existing":{"type":"object"}},"required":["pair","existing"]}'::jsonb,
  '{"type":"object","properties":{"classification":{"type":"string","enum":["NONE","POSSIBLE","EXACT","ATTRIBUTION_CONFLICT"]},"action":{"type":"string","enum":["NONE","FLAG","LINK","BLOCK"]},"reasons":{"type":"array","items":{"type":"string"}}},"required":["classification","action","reasons"]}'::jsonb,
  ARRAY['UNIQUE','FIRST','PRIORITY']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"classification":"NONE","action":"NONE","reasons":[]}'::jsonb,
  'IGNORE',
  'ALWAYS',
  ARRAY['BRANCH','TENANT_DEFAULT']::text[],
  true,
  true
),
(
  'DK-customer.duplicate',
  '1-mvp',
  'T2',
  '{"type":"object","properties":{"pair":{"type":"object"},"existing":{"type":"object"}},"required":["pair","existing"]}'::jsonb,
  '{"type":"object","properties":{"classification":{"type":"string","enum":["NONE","POSSIBLE","EXACT","ATTRIBUTION_CONFLICT"]},"action":{"type":"string","enum":["NONE","FLAG","LINK","BLOCK"]},"reasons":{"type":"array","items":{"type":"string"}}},"required":["classification","action","reasons"]}'::jsonb,
  ARRAY['UNIQUE','FIRST','PRIORITY']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"classification":"NONE","action":"NONE","reasons":[]}'::jsonb,
  'IGNORE',
  'ALWAYS',
  ARRAY['BRANCH','TENANT_DEFAULT']::text[],
  true,
  true
),
(
  'DK-lead.assignment',
  '1-mvp',
  'T2',
  '{"type":"object","properties":{"lead":{"type":"object"},"context":{"type":"object"}},"required":["lead","context"]}'::jsonb,
  '{"type":"object","properties":{"pool":{"type":"object"},"strategy":{"type":"string","enum":["SPECIFIC_USER","ROUND_ROBIN","LEAST_LOADED","QUEUE_ONLY"]},"reasonText":{"type":"string"}},"required":["pool","strategy","reasonText"]}'::jsonb,
  ARRAY['UNIQUE','FIRST','PRIORITY']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"pool":{"queueKind":"UNASSIGNED"},"strategy":"QUEUE_ONLY","reasonText":"Default unassigned queue"}'::jsonb,
  'IGNORE',
  'ALWAYS',
  ARRAY['BRANCH','TENANT_DEFAULT']::text[],
  true,
  true
),
(
  'DK-sla.target',
  '1-mvp',
  'T3',
  '{"type":"object","properties":{"sla":{"type":"object"},"record":{"type":"object"}},"required":["sla","record"]}'::jsonb,
  '{"type":"object","properties":{"target_business_minutes":{"type":"number"},"warning_pct":{"type":"number"},"calendar":{"type":"string"}},"required":["target_business_minutes","warning_pct","calendar"]}'::jsonb,
  ARRAY['FIRST','PRIORITY']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"target_business_minutes":1440,"warning_pct":80,"calendar":"ALWAYS"}'::jsonb,
  'IGNORE',
  'ALWAYS',
  ARRAY['BRANCH','TENANT_DEFAULT']::text[],
  true,
  true
),
(
  'DK-document.requirements',
  '1-mvp',
  'T2',
  '{"type":"object","properties":{"product":{"type":"object"},"party":{"type":"object"},"application":{"type":"object"}},"required":["product","party","application"]}'::jsonb,
  '{"type":"object","properties":{"documents":{"type":"array","items":{"type":"object"}}},"required":["documents"]}'::jsonb,
  ARRAY['COLLECT','RULE_ORDER']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"documents":[{"typeCode":"PAN_CARD","mandatory":true,"count":1,"periodMonths":0}]}'::jsonb,
  'IGNORE',
  'ALWAYS',
  ARRAY['LENDER','PRODUCT_VERSION','TENANT_DEFAULT']::text[],
  true,
  true
),
(
  'DK-application.completeness',
  '1-mvp',
  'T1',
  '{"type":"object","properties":{"application":{"type":"object"},"product":{"type":"object"},"parties":{"type":"object"}},"required":["application","product","parties"]}'::jsonb,
  '{"type":"object","properties":{"result":{"type":"string","enum":["COMPLETE","INCOMPLETE"]},"reasons":{"type":"array","items":{"type":"object"}}},"required":["result","reasons"]}'::jsonb,
  ARRAY['FIRST','UNIQUE']::text[],
  'EVAL',
  'DEFAULT_OUTPUT',
  '{"result":"INCOMPLETE","reasons":[{"code":"INITIAL_ASSESSMENT","text":"Checklist verification incomplete"}]}'::jsonb,
  'UNDETERMINED',
  'ALWAYS',
  ARRAY['PRODUCT_VERSION','TENANT_DEFAULT']::text[],
  false,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Seed decision dependencies
INSERT INTO decision_dependency (decision_key, depends_on_key, required)
VALUES ('DK-application.completeness', 'DK-document.requirements', true)
ON CONFLICT (decision_key, depends_on_key) DO NOTHING;
