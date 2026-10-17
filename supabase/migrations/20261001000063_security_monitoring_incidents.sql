<<<<<<<< HEAD:supabase/migrations/20261001000063_security_monitoring_incidents.sql
-- Migration: 20261001000063_security_monitoring_incidents.sql (renumbered from a second 0043; the SQL below is unchanged)
========
-- Migration: 20261001000057_security_monitoring_incidents.sql
>>>>>>>> piyush:supabase/migrations/20261001000057_security_monitoring_incidents.sql
-- Module 39: Security (MOD-SEC) — Security Events & Incident Management (ENT-096, ENT-102, TASK-431)
-- Owner: Dev 1 / InfoSec Lead (Platform squad)

SET search_path = app, extensions, public;

-- ============================================================================
-- ENT-096: Security Events (SUB-SEC.01)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.security_event (
  id          text PRIMARY KEY,                                      -- sec_01J...
  tenant_id   text NOT NULL REFERENCES app.tenant(id),
  type        text NOT NULL,
  principal   text NOT NULL,
  ip          text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS security_event_cursor_idx ON app.security_event (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS security_event_filter_idx ON app.security_event (tenant_id, severity, type);
CREATE INDEX IF NOT EXISTS security_event_principal_idx ON app.security_event (tenant_id, principal);

CALL enable_tenant_rls('security_event');
GRANT SELECT, INSERT ON app.security_event TO dsa_app;

-- Append-only trigger for security events
DROP TRIGGER IF EXISTS security_event_immutable ON app.security_event;
CREATE TRIGGER security_event_immutable
  BEFORE UPDATE OR DELETE ON app.security_event
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ============================================================================
-- ENT-102: Incident Records (SUB-SEC.02)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app.incident_record (
  id                      text PRIMARY KEY,                           -- inc_01J...
  tenant_id               text NOT NULL REFERENCES app.tenant(id),
  type                    text NOT NULL,
  severity                text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  detected_at             timestamptz NOT NULL,
  personal_data_involved  boolean NOT NULL DEFAULT false,
  affected_tenants        jsonb NOT NULL DEFAULT '[]'::jsonb,
  notifications           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED')),
  post_mortem_ref         text DEFAULT NULL,
  lock_version            integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS incident_record_cursor_idx ON app.incident_record (tenant_id, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS incident_record_status_idx ON app.incident_record (tenant_id, status);
CREATE INDEX IF NOT EXISTS incident_record_severity_idx ON app.incident_record (tenant_id, severity);

CALL enable_tenant_rls('incident_record');
GRANT SELECT, INSERT, UPDATE ON app.incident_record TO dsa_app;

-- Concurrency and audit triggers
DROP TRIGGER IF EXISTS incident_record_touch ON app.incident_record;
CREATE TRIGGER incident_record_touch
  BEFORE UPDATE ON app.incident_record
  FOR EACH ROW EXECUTE FUNCTION app.touch_row();

DROP TRIGGER IF EXISTS incident_record_no_delete ON app.incident_record;
CREATE TRIGGER incident_record_no_delete
  BEFORE DELETE ON app.incident_record
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ============================================================================
-- Permissions: Seed security.incident and security.vuln (TASK-431)
-- ============================================================================
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('security.incident', 'Manage, assess, and report security incidents and data breaches', 'TASK-431'),
  ('security.vuln', 'View and manage security vulnerabilities and scan triage', 'TASK-431')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN app.permission p
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-COMPLIANCE', 'ROLE-TENANT-ADMIN', 'COMPLIANCE', 'ORG_OWNER', 'TENANT_ADMIN')
  AND p.code IN ('security.incident', 'security.vuln')
ON CONFLICT DO NOTHING;
