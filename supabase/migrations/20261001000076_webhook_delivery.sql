-- Migration: 20261001000076_webhook_delivery.sql
-- Owner: MOD-API (Module 36; API-API-005, API-API-006)
-- Outbound webhooks are delivered from the database, not from memory:
--   webhook_subscription.secret_ciphertext: the signing secret, AES-256-GCM under a key derived from the deployment secret.
--     The secret is shown once at creation; secret_hash stays for comparison. A subscription that kept failing for 24 hours
--     is FAILING (MOD-API: "Retries with backoff for 24 hours, then the subscription is marked FAILING").
--   webhook_delivery_log: one row per (subscription, event), updated on each attempt (attempt, last_error, next_retry_at).

SET search_path = app, extensions, public;

ALTER TABLE webhook_subscription ADD COLUMN IF NOT EXISTS secret_ciphertext text;
ALTER TABLE webhook_subscription ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE webhook_subscription DROP CONSTRAINT IF EXISTS webhook_subscription_status_check;
ALTER TABLE webhook_subscription ADD CONSTRAINT webhook_subscription_status_check
  CHECK (status IN ('ACTIVE', 'PAUSED', 'FAILING', 'REVOKED'));

ALTER TABLE webhook_delivery_log ADD COLUMN IF NOT EXISTS last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500);
ALTER TABLE webhook_delivery_log ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_once_uq ON webhook_delivery_log (subscription_id, event_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_tenant_created_idx ON webhook_delivery_log (tenant_id, created_at DESC, id DESC);
