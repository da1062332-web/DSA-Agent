-- Migration M-040: Workflow Automation Core Schema (MOD-WFA)
-- Owner: Dev 1 / Dev 6 (TASK-401 / MOD-WFA)
-- Range: 0040-0049 (Platform & Workflow Automation)
SET search_path = app, extensions, public;

-- 1. Automation Definition
CREATE TABLE automation_definition (
  id                  text PRIMARY KEY,                                      -- prefix: wfd_
  tenant_id           text NOT NULL REFERENCES tenant(id),
  code                text NOT NULL CHECK (code ~ '^[a-z0-9_-]{3,64}$'),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 200),
  description         text,
  trigger_type        text NOT NULL CHECK (trigger_type IN ('EVENT', 'SCHEDULE', 'TIMER', 'WATCH', 'MANUAL')),
  entity_type         text NOT NULL CHECK (entity_type IN ('LEAD', 'CUSTOMER', 'LOAN_APPLICATION', 'LENDER_CASE', 'TASK', 'VERIFICATION', 'SYSTEM')),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  is_system           boolean NOT NULL DEFAULT false,
  pinned_version_id   text,                                                  -- prefix: wfv_
  lock_version        integer NOT NULL DEFAULT 0,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- 2. Automation Version
CREATE TABLE automation_version (
  id                  text PRIMARY KEY,                                      -- prefix: wfv_
  tenant_id           text NOT NULL REFERENCES tenant(id),
  definition_id       text NOT NULL,
  version_no          integer NOT NULL CHECK (version_no >= 1),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'RETIRED')),
  trigger_config      jsonb NOT NULL CHECK (jsonb_typeof(trigger_config) = 'object'),
  steps               jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  content_hash        text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  author_id           text NOT NULL,
  submitted_by        text,
  submitted_at        timestamptz,
  approved_by         text,
  approved_at         timestamptz,
  rejection_reason    text,
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (definition_id, version_no),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES automation_definition(tenant_id, id)
);

-- Add circular FK back to definition for pinned_version_id
ALTER TABLE automation_definition
  ADD CONSTRAINT automation_definition_pinned_version_fk
  FOREIGN KEY (tenant_id, pinned_version_id) REFERENCES automation_version(tenant_id, id);

-- 3. Automation Execution
CREATE TABLE automation_execution (
  id                  text PRIMARY KEY,                                      -- prefix: wfe_
  tenant_id           text NOT NULL REFERENCES tenant(id),
  definition_id       text NOT NULL,
  version_id          text NOT NULL,
  trigger_type        text NOT NULL CHECK (trigger_type IN ('EVENT', 'SCHEDULE', 'TIMER', 'WATCH', 'MANUAL')),
  trigger_event_id    text,
  subject_type        text NOT NULL CHECK (subject_type IN ('LEAD', 'CUSTOMER', 'LOAN_APPLICATION', 'LENDER_CASE', 'TASK', 'VERIFICATION', 'SYSTEM')),
  subject_id          text NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'WAITING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED')),
  current_step_index  integer NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
  context             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  dry_run             boolean NOT NULL DEFAULT false,
  worker_id           text,
  lease_expires_at    timestamptz,
  error_code          text,
  error_message       text,
  idempotency_key     text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_:-]{8,256}$'),
  correlation_id      text NOT NULL,
  causation_id        text,
  chain_depth         smallint NOT NULL DEFAULT 0 CHECK (chain_depth BETWEEN 0 AND 3),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES automation_definition(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES automation_version(tenant_id, id)
);

CREATE UNIQUE INDEX automation_execution_idempotency_uq
  ON automation_execution (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. Automation Step Execution
CREATE TABLE automation_step_execution (
  id                    text PRIMARY KEY,                                    -- prefix: wfse_
  tenant_id             text NOT NULL REFERENCES tenant(id),
  execution_id          text NOT NULL,
  step_index            integer NOT NULL CHECK (step_index >= 0),
  step_id               text NOT NULL CHECK (char_length(step_id) BETWEEN 1 AND 100),
  step_type             text NOT NULL CHECK (step_type IN (
                          'EVALUATE_DECISION', 'BRANCH', 'CREATE_TASK', 'ASSIGN_OWNER',
                          'NOTIFY', 'END', 'SEND_TEMPLATE_MESSAGE', 'WAIT',
                          'UPDATE_FIELD', 'REQUEST_APPROVAL', 'CALL_WEBHOOK'
                        )),
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  input_snapshot        jsonb,
  output_snapshot       jsonb,
  error_code            text,
  error_message         text,
  error_classification  text CHECK (error_classification IS NULL OR error_classification IN ('RETRYABLE', 'PERMANENT', 'AMBIGUOUS')),
  attempts              integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  idempotency_key       text NOT NULL,
  skip_reason           text,
  skipped_by            text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, execution_id, step_index),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES automation_execution(tenant_id, id)
);

-- 5. Scheduled Trigger (for SCHEDULE, TIMER, and delayed steps)
CREATE TABLE scheduled_trigger (
  id                  text PRIMARY KEY,                                      -- prefix: wft_
  tenant_id           text NOT NULL REFERENCES tenant(id),
  definition_id       text NOT NULL,
  version_id          text NOT NULL,
  cron_expression     text,
  next_run_at         timestamptz NOT NULL,
  last_run_at         timestamptz,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'EXHAUSTED')),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES automation_definition(tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES automation_version(tenant_id, id)
);

-- 6. Dead Letter Handling
CREATE TABLE wfa_dead_letter (
  id                  text PRIMARY KEY,                                      -- prefix: wfdl_
  tenant_id           text NOT NULL REFERENCES tenant(id),
  execution_id        text NOT NULL,
  step_execution_id   text NOT NULL,
  reason              text NOT NULL,
  error_details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_status   text NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  resolved_by         text,
  resolved_at         timestamptz,
  resolution_action   text CHECK (resolution_action IS NULL OR resolution_action IN ('RETRY', 'SKIP', 'CANCEL')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES automation_execution(tenant_id, id),
  FOREIGN KEY (tenant_id, step_execution_id) REFERENCES automation_step_execution(tenant_id, id)
);

-- Indexes for performance & worker dispatch
CREATE INDEX automation_exec_worker_lease_idx
  ON automation_execution (tenant_id, status, lease_expires_at)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRYING');

CREATE INDEX automation_exec_subject_idx
  ON automation_execution (tenant_id, subject_type, subject_id, created_at DESC);

CREATE INDEX automation_exec_history_idx
  ON automation_execution (tenant_id, definition_id, created_at DESC);

CREATE INDEX scheduled_trigger_next_run_idx
  ON scheduled_trigger (status, next_run_at)
  WHERE status = 'ACTIVE';

CREATE INDEX wfa_dead_letter_status_idx
  ON wfa_dead_letter (tenant_id, resolution_status, created_at DESC);

-- Triggers
CREATE TRIGGER automation_definition_touch
  BEFORE UPDATE ON automation_definition
  FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TRIGGER automation_execution_touch
  BEFORE UPDATE ON automation_execution
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Tenant RLS Security
CALL enable_tenant_rls('automation_definition');
CALL enable_tenant_rls('automation_version');
CALL enable_tenant_rls('automation_execution');
CALL enable_tenant_rls('automation_step_execution');
CALL enable_tenant_rls('scheduled_trigger');
CALL enable_tenant_rls('wfa_dead_letter');

-- Permissions Grants to App User
GRANT SELECT, INSERT, UPDATE ON
  automation_definition,
  automation_version,
  automation_execution,
  automation_step_execution,
  scheduled_trigger,
  wfa_dead_letter
TO dsa_app;

-- Seed WFA Permissions
INSERT INTO permission (code, description, introduced_in) VALUES
  ('automation.read', 'View workflow automations, versions, and execution histories', 'MOD-WFA'),
  ('automation.author', 'Create and modify automation definitions and draft versions', 'MOD-WFA'),
  ('automation.approve', 'Approve, reject, and enable automation versions (Maker-Checker enforced)', 'MOD-WFA'),
  ('automation.execute', 'Trigger manual execution and dry-run simulations of automations', 'MOD-WFA'),
  ('automation.operator', 'Perform operator intervention on executions (retry, skip, cancel, resolve dead letter)', 'MOD-WFA')
ON CONFLICT (code) DO NOTHING;

-- Grant permissions to default roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM role r
CROSS JOIN (
  SELECT unnest(ARRAY[
    'automation.read',
    'automation.author',
    'automation.approve',
    'automation.execute',
    'automation.operator'
  ]) AS code
) p
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM role r
CROSS JOIN (
  SELECT unnest(ARRAY[
    'automation.read',
    'automation.execute'
  ]) AS code
) p
WHERE r.code IN ('ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;

