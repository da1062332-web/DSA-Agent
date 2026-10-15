-- 20261001000043_integrations.sql
-- Module 28: Integration Management (MOD-INT, TASK-419)
-- Covers: SUB-INT.01 (Adapter Framework, ENT-103 integration_connection, API-INT-001, API-INT-002)

SET search_path = app, extensions, public;

-- 1. Register permission codes in platform registry
INSERT INTO permission (code, description, introduced_in) VALUES
  ('integration.manage', 'Configure, test, and manage external provider integrations and adapters', 'TASK-419'),
  ('integration.read', 'Read configured integrations, capabilities, and health status', 'TASK-419')
ON CONFLICT (code) DO NOTHING;

-- Grant to default platform roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('integration.manage'),
    ('integration.read')
) AS p(code)
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR')
ON CONFLICT DO NOTHING;

-- 2. Define ENT-103: Integration Connection Table
-- Zero Plaintext Secrets: only opaque credential_ref resolving via vault is persisted.
CREATE TABLE IF NOT EXISTS app.integration_connection (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES app.tenant(id),
  provider            text NOT NULL,
  capability          text NOT NULL,
  environment         text NOT NULL CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
  credential_ref      text NOT NULL,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEGRADED', 'SUSPENDED')),
  health              jsonb,
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  CONSTRAINT integration_connection_tenant_provider_capability_key UNIQUE (tenant_id, provider, capability)
);

-- 3. Indexes for tenant lookups and cursor pagination
CREATE INDEX IF NOT EXISTS integration_connection_tenant_status_idx 
  ON app.integration_connection (tenant_id, status);

CREATE INDEX IF NOT EXISTS integration_connection_cursor_idx 
  ON app.integration_connection (tenant_id, updated_at DESC, id DESC);

-- 4. Enable Row Level Security (RLS)
CALL enable_tenant_rls('integration_connection');

-- 5. Role grants for application database user (strictly SELECT, INSERT, UPDATE; NO DELETE as per NFR-SEC-003)
GRANT SELECT, INSERT, UPDATE ON app.integration_connection TO dsa_app;
