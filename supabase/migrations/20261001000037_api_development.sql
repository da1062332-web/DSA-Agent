-- Migration: 20261001000037_api_development.sql
-- Module 37: API Development (MOD-DEV) — Developer & Partner APIs, API Keys, Webhook Subscriptions and Delivery Logs
-- Owner: Akash (Dev 2 / Dev 6 / Platform Core)

SET search_path = app, extensions, public;

-- Seed permission codes for Module 37
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('api.read', 'Read API keys, developer configurations and API analytics', 'TASK-437'),
  ('api.manage', 'Create, rotate, and revoke API keys and developer configurations', 'TASK-437'),
  ('partner.lead_ingest', 'Ingest leads and initiate applications via Partner API gateway', 'TASK-437'),
  ('partner.application_read', 'Read application lifecycle status and sanction offers via Partner API', 'TASK-437'),
  ('webhook.manage', 'Manage partner webhook subscriptions and view delivery logs', 'TASK-437')
ON CONFLICT (code) DO NOTHING;

-- Grant permissions to default roles
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN app.permission p
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR')
  AND p.code IN ('api.read', 'api.manage', 'partner.lead_ingest', 'partner.application_read', 'webhook.manage')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ENT-121: app.api_key (Partner & Developer API Keys)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.api_key (
  id              text PRIMARY KEY,                                      -- apk_01J...
  tenant_id       text NOT NULL REFERENCES app.tenant(id),
  partner_id      text NOT NULL,                                         -- Identifier for partner/connector
  name            text NOT NULL,                                         -- Display name / label
  key_prefix      text NOT NULL,                                         -- e.g. 'dsa_live_a1b2c3'
  key_hash        text NOT NULL UNIQUE,                                  -- SHA-256 hash of secret key
  scopes          text[] NOT NULL DEFAULT ARRAY['partner.lead_ingest']::text[],
  allowed_ips     text[] DEFAULT NULL,                                   -- Optional CIDR/IP allowlist
  rate_limit_rpm  integer NOT NULL DEFAULT 120 CHECK (rate_limit_rpm > 0),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  expires_at      timestamptz DEFAULT NULL,
  last_used_at    timestamptz DEFAULT NULL,
  lock_version    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_api_key_tenant_partner ON app.api_key (tenant_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_api_key_lookup ON app.api_key (key_hash, status);

CALL enable_tenant_rls('app.api_key');
GRANT SELECT, INSERT, UPDATE ON app.api_key TO dsa_app;

DROP TRIGGER IF EXISTS trg_api_key_touch ON app.api_key;
CREATE TRIGGER trg_api_key_touch
  BEFORE UPDATE ON app.api_key
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ============================================================================
-- ENT-122: app.webhook_subscription (Partner Webhook Subscriptions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.webhook_subscription (
  id                  text PRIMARY KEY,                                  -- whs_01J...
  tenant_id           text NOT NULL REFERENCES app.tenant(id),
  partner_id          text NOT NULL,
  name                text NOT NULL,
  target_url          text NOT NULL,
  subscribed_events   text[] NOT NULL CHECK (cardinality(subscribed_events) > 0),
  secret_hash         text NOT NULL,                                     -- HMAC secret for signature verification
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED')),
  failure_count       integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_sub_tenant_partner ON app.webhook_subscription (tenant_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_webhook_sub_active ON app.webhook_subscription (tenant_id, status);

CALL enable_tenant_rls('app.webhook_subscription');
GRANT SELECT, INSERT, UPDATE ON app.webhook_subscription TO dsa_app;

DROP TRIGGER IF EXISTS trg_webhook_sub_touch ON app.webhook_subscription;
CREATE TRIGGER trg_webhook_sub_touch
  BEFORE UPDATE ON app.webhook_subscription
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ============================================================================
-- ENT-123: app.webhook_delivery_log (Webhook Delivery Audit Log)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.webhook_delivery_log (
  id                  text PRIMARY KEY,                                  -- whd_01J...
  tenant_id           text NOT NULL REFERENCES app.tenant(id),
  subscription_id     text NOT NULL REFERENCES app.webhook_subscription(id) ON DELETE CASCADE,
  event_id            text NOT NULL,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL,
  http_status         integer DEFAULT NULL,
  response_body       text DEFAULT NULL,
  duration_ms         integer DEFAULT NULL,
  attempt             integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status              text NOT NULL CHECK (status IN ('DELIVERED', 'FAILED', 'PENDING_RETRY')),
  delivered_at        timestamptz DEFAULT NULL,
  next_retry_at       timestamptz DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_del_sub ON app.webhook_delivery_log (tenant_id, subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_del_retry ON app.webhook_delivery_log (status, next_retry_at) WHERE status = 'PENDING_RETRY';

CALL enable_tenant_rls('app.webhook_delivery_log');
GRANT SELECT, INSERT, UPDATE ON app.webhook_delivery_log TO dsa_app;

-- Webhook delivery logs are immutable audit records
DROP TRIGGER IF EXISTS trg_webhook_delivery_immutable ON app.webhook_delivery_log;
CREATE TRIGGER trg_webhook_delivery_immutable
  BEFORE DELETE ON app.webhook_delivery_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
