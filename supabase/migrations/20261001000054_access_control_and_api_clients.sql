-- Migration: 20261001000054_access_control_and_api_clients.sql
-- Owner: Akash (Dev 2 / Coordinator, Modules 5, 23, 36)
-- Covers:
-- 1. Module 5 (Access Control): Seed role.manage permission, grant to admin roles, and reconcile hosted users with valid roles
-- 2. Module 23 (Business Rule Engine): Seed DK-application.eligibility decision definition and dependency
-- 3. Module 36 (API Management): app.api_client table for external client credentials and management
SET search_path = app, extensions, public;

-- ============================================================================
-- 1. Module 5: Access Control (role.manage & user reconciliation)
-- ============================================================================

INSERT INTO app.permission (code, description, introduced_in)
VALUES ('role.manage', 'Manage roles, permission mappings, and role assignments', 'MOD-ACL')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'role.manage'
FROM app.role r
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')
ON CONFLICT DO NOTHING;

-- Reconcile active hosted users without assigned roles: assign ROLE-RM as default valid role
INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
SELECT 
  'ura_' || substr(md5(random()::text || u.id), 1, 26),
  u.tenant_id,
  u.id,
  (SELECT r.id FROM app.role r WHERE r.tenant_id = u.tenant_id AND r.code = 'ROLE-RM' LIMIT 1),
  'OWN',
  ARRAY[]::text[],
  'SYSTEM:platform'
FROM app.app_user u
WHERE u.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM app.user_role_assignment ura 
    WHERE ura.user_id = u.id AND ura.tenant_id = u.tenant_id
  )
  AND EXISTS (
    SELECT 1 FROM app.role r WHERE r.tenant_id = u.tenant_id AND r.code = 'ROLE-RM'
  )
ON CONFLICT DO NOTHING;

-- Deactivate orphaned test accounts that have no role and no activity
UPDATE app.app_user
SET status = 'DEACTIVATED', updated_at = now()
WHERE status = 'ACTIVE'
  AND email LIKE '%test%orphan%'
  AND NOT EXISTS (
    SELECT 1 FROM app.user_role_assignment ura 
    WHERE ura.user_id = app.app_user.id
  );

-- ============================================================================
-- 2. Module 23: Business Rule Engine (DK-application.eligibility)
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

INSERT INTO app.decision_dependency (decision_key, depends_on_key, required)
VALUES ('DK-application.completeness', 'DK-application.eligibility', false)
ON CONFLICT (decision_key, depends_on_key) DO NOTHING;

-- ============================================================================
-- 3. Module 36: API Management (app.api_client)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.api_client (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES app.tenant(id),
  client_id text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  name text NOT NULL,
  partner_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')) DEFAULT 'ACTIVE',
  scopes text[] NOT NULL DEFAULT ARRAY['partner.lead_ingest'],
  rate_limit_rpm integer NOT NULL DEFAULT 120,
  allowed_ips text[],
  last_used_at timestamptz,
  lock_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_client_tenant ON app.api_client (tenant_id, status);
DROP POLICY IF EXISTS tenant_isolation ON app.api_client;
CALL enable_tenant_rls('api_client');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.api_client TO dsa_app;
