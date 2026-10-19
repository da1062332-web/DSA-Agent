-- Migration: 20261001000068_tenant_feature_flag_overrides.sql
-- Module 1 / 30 (MOD-ADM, SUB-ADM.02): per-tenant feature flag overrides (owner: Platform squad)
--
-- app.feature_flag is keyed by (key, scope) and has no tenant column, so a TENANT-scoped flag could only ever be ONE row shared by every
-- tenant: there was nowhere to say "on for Alpha, off for Beta". The platform console needs exactly that, from a tenant's own page.
--
-- Overrides live in their own table, not in feature_flag, so that:
--   - a change made for one tenant can never touch a GLOBAL row or another tenant's row (different table, tenant in the primary key);
--   - feature_flag, its policies and everything that reads it stay exactly as they are (migrations 0046, 0050, 0058).
-- The row in feature_flag with scope TENANT is the DEFINITION and the platform-wide default; an override exists only for a flag that has one.
-- Effective value for a tenant = its override, else the TENANT-scope default. GLOBAL flags have no override (they are the same for everyone).
--
-- Access: a platform session reads and writes every row; a customer tenant's own session can read ITS rows only (so tenant code can later ask
-- "is this flag on for me?") and can never write. No DELETE for dsa_app (NFR-SEC-003): "back to default" is an override set to the default value.
-- Idempotent. Nothing is changed in existing tables.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS app.tenant_feature_flag (
  tenant_id     text        NOT NULL REFERENCES app.tenant(id),
  key           text        NOT NULL,
  scope         text        NOT NULL DEFAULT 'TENANT' CHECK (scope = 'TENANT'),
  value         boolean     NOT NULL,
  lock_version  integer     NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text        NOT NULL,
  PRIMARY KEY (tenant_id, key),
  -- Only a flag that is defined with scope TENANT can be overridden; a typo or a GLOBAL flag is refused by the database.
  FOREIGN KEY (key, scope) REFERENCES app.feature_flag (key, scope)
);

ALTER TABLE app.tenant_feature_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_feature_flag FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_flag_read ON app.tenant_feature_flag;
CREATE POLICY tenant_flag_read ON app.tenant_feature_flag FOR SELECT
  USING (is_platform_realm() OR tenant_id = app_tenant());

DROP POLICY IF EXISTS tenant_flag_insert ON app.tenant_feature_flag;
CREATE POLICY tenant_flag_insert ON app.tenant_feature_flag FOR INSERT
  WITH CHECK (is_platform_realm());

DROP POLICY IF EXISTS tenant_flag_update ON app.tenant_feature_flag;
CREATE POLICY tenant_flag_update ON app.tenant_feature_flag FOR UPDATE
  USING (is_platform_realm()) WITH CHECK (is_platform_realm());

GRANT SELECT, INSERT, UPDATE ON app.tenant_feature_flag TO dsa_app;
