-- Migration: 20261001000042_audit_tamper_evidence.sql
-- Module 37: Audit (MOD-AUD) — Tamper Evidence, Hash Chain & Evidence Packs (ENT-095, TASK-105, TASK-408)
-- Owner: Dev 1 / Dev 6

SET search_path = app, extensions, public;

-- ============================================================================
-- ENT-095: Add hash chain columns to app.audit_event
-- ============================================================================
ALTER TABLE app.audit_event ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE app.audit_event ADD COLUMN IF NOT EXISTS hash text;

-- Performance & cursor pagination indexes for audit search (API-AUD-001, API-AUD-002)
CREATE INDEX IF NOT EXISTS audit_event_cursor_idx ON app.audit_event (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_event_correlation_idx ON app.audit_event (tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS audit_event_decision_idx ON app.audit_event (tenant_id, decision_record_id) WHERE decision_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_event_seq_idx ON app.audit_event (tenant_id, seq);
CREATE INDEX IF NOT EXISTS audit_event_unsealed_idx ON app.audit_event (tenant_id, seq) WHERE hash IS NULL;

-- Allow dsa_app to update only prev_hash and hash for sealing
GRANT UPDATE (prev_hash, hash) ON app.audit_event TO dsa_app;

-- Tamper-evidence trigger: replaces plain forbid_mutation() to allow one-time sealing
-- of prev_hash and hash on unsealed rows, while strictly forbidding deletion or any business-data update
CREATE OR REPLACE FUNCTION app.audit_event_seal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'table audit_event is append-only (DELETE rejected)' USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.hash IS NOT NULL THEN
      RAISE EXCEPTION 'table audit_event already sealed (tamper protection: hash cannot be modified)' USING ERRCODE = '42501';
    END IF;
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.occurred_at <> OLD.occurred_at
       OR NEW.actor_type <> OLD.actor_type OR NEW.actor_id <> OLD.actor_id OR NEW.action <> OLD.action
       OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.before IS DISTINCT FROM OLD.before OR NEW.after IS DISTINCT FROM OLD.after
       OR NEW.correlation_id <> OLD.correlation_id THEN
      RAISE EXCEPTION 'table audit_event is immutable (business state modification rejected)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_event_append_only ON app.audit_event;
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.audit_event_seal_guard();

-- ============================================================================
-- Evidence Packs (TASK-408 Evidence Export)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.evidence_pack (
  id              text PRIMARY KEY,                                      -- evp_01J...
  tenant_id       text NOT NULL REFERENCES app.tenant(id),
  requested_by    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_count    integer DEFAULT NULL,
  checksum        text DEFAULT NULL,
  file_path       text DEFAULT NULL,
  error_message   text DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz DEFAULT NULL,
  expires_at      timestamptz DEFAULT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS evidence_pack_tenant_idx ON app.evidence_pack (tenant_id, created_at DESC);

CALL enable_tenant_rls('evidence_pack');
GRANT SELECT, INSERT, UPDATE ON app.evidence_pack TO dsa_app;

-- ============================================================================
-- Permissions: Seed audit.export_evidence and grant to auditor/compliance roles
-- ============================================================================
INSERT INTO app.permission (code, description, task_ref) VALUES
  ('audit.export_evidence', 'Generate and export tamper-evident audit evidence packs', 'TASK-408')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN app.permission p
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-AUDITOR', 'ROLE-COMPLIANCE', 'ROLE-TENANT-ADMIN', 'AUDITOR', 'COMPLIANCE', 'ORG_OWNER', 'TENANT_ADMIN')
  AND p.code = 'audit.export_evidence'
ON CONFLICT DO NOTHING;
