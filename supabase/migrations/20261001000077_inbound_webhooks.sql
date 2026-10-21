-- Migration: 20261001000077_inbound_webhooks.sql
-- Owner: MOD-INT (Module 35; API-INT-006)
-- Generic inbound provider webhooks. The unauthenticated request names its connection (public_entry_index, M-006); the body is
-- verified with that connection's signing secret, its timestamp must be within 5 minutes, and a provider event id is accepted
-- once per tenant and provider (the unique key is the de-duplication). The payload is kept for the consumer of the
-- integration.webhook_received event.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS inbound_webhook (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  provider           text NOT NULL CHECK (provider ~ '^[a-z0-9_-]{2,40}$'),
  connection_id      text NOT NULL,
  provider_event_id  text NOT NULL CHECK (char_length(provider_event_id) BETWEEN 1 AND 200),
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS inbound_webhook_received_idx ON inbound_webhook (tenant_id, received_at DESC);
CALL enable_tenant_rls('inbound_webhook');
CREATE TRIGGER inbound_webhook_append_only BEFORE UPDATE OR DELETE ON inbound_webhook FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
GRANT SELECT, INSERT ON inbound_webhook TO dsa_app;
