-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §4.
-- Owner (v1.2 Assignment Matrix §3): Dev 1. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0002_kernel_infra.sql  (owner: Dev 1, TASK-103)
CREATE TABLE idempotency_key (                                   -- ENT-109
  tenant_id        text NOT NULL REFERENCES tenant(id),
  principal_id     text NOT NULL,
  key              text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  method           text NOT NULL,
  path             text NOT NULL,
  request_hash     char(64) NOT NULL,
  status           text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response_status  integer,
  response_body    jsonb,
  resource_ref     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (tenant_id, principal_id, key),
  CHECK (status <> 'COMPLETED' OR response_status IS NOT NULL)
);

CREATE TABLE dedupe_registry (                                   -- ENT-116 (AG-13)
  tenant_id   text NOT NULL REFERENCES tenant(id),
  namespace   text NOT NULL CHECK (namespace IN ('DECISION')),
  key         text NOT NULL CHECK (char_length(key) BETWEEN 3 AND 300),
  ref_id      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  PRIMARY KEY (tenant_id, namespace, key)
);

CREATE TABLE outbox_event (                                      -- ENT-108 (not partitioned in MVP: ADR-4D-03)
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  event_type      text NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  event_version   smallint NOT NULL DEFAULT 1,
  subject_type    text NOT NULL,
  subject_id      text NOT NULL,
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  correlation_id  text NOT NULL,
  causation_id    text,
  chain_depth     smallint NOT NULL DEFAULT 0 CHECK (chain_depth BETWEEN 0 AND 3),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);
CREATE INDEX outbox_event_unpublished_idx ON outbox_event (created_at) WHERE published_at IS NULL;
CREATE INDEX outbox_event_subject_idx     ON outbox_event (tenant_id, subject_type, subject_id, created_at);

CREATE TABLE audit_event (                                       -- ENT-095 (hash chain columns arrive with TASK-408)
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  seq                   bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  actor_type            text NOT NULL CHECK (actor_type IN ('USER','SERVICE')),
  actor_id              text NOT NULL,
  action                text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type           text NOT NULL,
  entity_id             text,
  permission_used       text,
  approval_ref          text,
  reason                text,
  decision_record_id    text,
  before                jsonb,
  after                 jsonb,
  external_side_effect  boolean NOT NULL DEFAULT false,
  correlation_id        text NOT NULL,
  ip                    inet,
  user_agent            text
);
CREATE INDEX audit_event_entity_idx ON audit_event (tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_event_actor_idx  ON audit_event (tenant_id, actor_id, occurred_at DESC);
CREATE INDEX audit_event_action_idx ON audit_event (tenant_id, action, occurred_at DESC);
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER dedupe_registry_append_only BEFORE UPDATE OR DELETE ON dedupe_registry FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('idempotency_key');  CALL enable_tenant_rls('dedupe_registry');
CALL enable_tenant_rls('outbox_event');     CALL enable_tenant_rls('audit_event');

GRANT SELECT, INSERT, UPDATE ON idempotency_key TO dsa_app;
GRANT SELECT, INSERT ON dedupe_registry, outbox_event, audit_event TO dsa_app;
