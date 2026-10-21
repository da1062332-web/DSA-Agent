-- Migration: 20261001000078_privacy_retention_and_requests.sql
-- Owner: Dev 1 (MOD-PRV SUB-PRV.03 and SUB-PRV.04; API-PRV-001..003, 005, 006)
--   ENT-097 retention_policy: a tenant's retention for one data class (the R- codes), never below the platform minimum, which
--           the API holds (periods are Proposed pending OD-008). A class with no row uses the platform default.
--   ENT-099 data_subject_request: access, correction, erasure, grievance and consent requests from a data principal, with a
--           due date and a decision. The request is tracked here; erasure itself is carried out by the retention engine or an
--           approved data correction, never by this table.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS retention_policy (                    -- ENT-097
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  data_class         text NOT NULL CHECK (data_class IN ('R-CFG','R-OPS','R-LOAN','R-FIN','R-AUD','R-SHORT')),
  retention_months   integer NOT NULL CHECK (retention_months BETWEEN 1 AND 600),
  trigger_event      text NOT NULL CHECK (trigger_event IN ('RECORD_CREATED','RELATIONSHIP_ENDED','LOAN_CLOSED','RECORD_CLOSED')),
  action             text NOT NULL CHECK (action IN ('PURGE','ANONYMISE')),
  reason             text CHECK (reason IS NULL OR char_length(reason) <= 200),
  approved_by        text NOT NULL,
  approved_at        timestamptz NOT NULL DEFAULT now(),
  lock_version       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, data_class)
);
CREATE TRIGGER retention_policy_touch BEFORE UPDATE ON retention_policy FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('retention_policy');
GRANT SELECT, INSERT, UPDATE ON retention_policy TO dsa_app;

CREATE TABLE IF NOT EXISTS data_subject_request (                -- ENT-099
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  subject_type           text NOT NULL CHECK (subject_type IN ('CUSTOMER','LEAD')),
  subject_id             text NOT NULL,
  request_type           text NOT NULL CHECK (request_type IN ('ACCESS','CORRECTION','ERASURE','GRIEVANCE','CONSENT_WITHDRAWAL')),
  channel                text NOT NULL CHECK (channel IN ('EMAIL','PHONE','IN_PERSON','PORTAL','LETTER')),
  received_at            timestamptz NOT NULL,
  due_at                 timestamptz NOT NULL,
  status                 text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','IN_PROGRESS','COMPLETED','REJECTED')),
  decision               text CHECK (decision IS NULL OR decision IN ('FULFILLED','PARTIALLY_FULFILLED','DECLINED')),
  decision_reason        text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  response_package_key   text,
  handled_by             text,
  notes                  text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  completed_at           timestamptz,
  lock_version           integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, handled_by) REFERENCES app_user (tenant_id, id),
  CHECK (due_at > received_at),
  CHECK ((status IN ('COMPLETED','REJECTED')) = (decision IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS data_subject_request_queue_idx ON data_subject_request (tenant_id, status, due_at, id);
CREATE TRIGGER data_subject_request_touch BEFORE UPDATE ON data_subject_request FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('data_subject_request');
GRANT SELECT, INSERT, UPDATE ON data_subject_request TO dsa_app;
