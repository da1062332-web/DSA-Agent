-- 20261001000032_reporting_enterprise_suite.sql (owner: Dev 5, TASK-414, MOD-RPT Enterprise Suite)
-- Submodules SUB-RPT.01 (Metric Registry ENT-094), SUB-RPT.04 (Report Runs), SUB-RPT.05 (Exports ENT-111 & Schedules)
SET search_path = app, extensions, public;

-- 1. Enhance ENT-094 metric_definition with formula JSONB, versioning, grain, and dates
ALTER TABLE metric_definition
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS formula jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS date_basis text NOT NULL DEFAULT 'CREATED_AT' CHECK (date_basis IN ('CREATED_AT', 'UPDATED_AT', 'EVENT_AT', 'DISBURSED_AT')),
  ADD COLUMN IF NOT EXISTS grain text NOT NULL DEFAULT 'DAILY' CHECK (grain IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY')),
  ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS metric_definition_code_version_idx
  ON metric_definition (tenant_id, code, version);

-- Update canonical metric definitions with canonical formula JSONB
UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.lead',
  'field', 'id',
  'date_field', 'created_at'
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'LEAD_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.lead',
  'condition', 'status IN (''QUALIFIED'', ''CONVERTED'')',
  'date_field', 'created_at'
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'LEAD_QUALIFIED_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.lead',
  'condition', 'converted_to_application_id IS NOT NULL',
  'date_field', 'created_at'
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'LEAD_CONVERTED_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.sanction_version',
  'condition', 'status = ''APPROVED''',
  'date_field', 'created_at'
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'SANCTION_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'SUM',
  'source_table', 'app.sanction_version',
  'field', 'sanctioned_amount',
  'condition', 'status = ''APPROVED''',
  'date_field', 'created_at'
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'SANCTION_AMOUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.disbursement_tranche',
  'condition', 'status = ''VERIFIED''',
  'date_field', 'created_at'
), date_basis = 'DISBURSED_AT', grain = 'DAILY'
WHERE code = 'DISBURSEMENT_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'SUM',
  'source_table', 'app.disbursement_tranche',
  'field', 'net_disbursement_amount',
  'condition', 'status = ''VERIFIED''',
  'date_field', 'created_at'
), date_basis = 'DISBURSED_AT', grain = 'DAILY'
WHERE code = 'DISBURSEMENT_AMOUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'COUNT',
  'source_table', 'app.activity',
  'date_field', 'created_at'
), date_basis = 'EVENT_AT', grain = 'DAILY'
WHERE code = 'ACTIVITY_COUNT';

UPDATE metric_definition
SET formula = jsonb_build_object(
  'type', 'RATIO',
  'numerator', 'LEAD_CONVERTED_COUNT',
  'denominator', 'LEAD_COUNT',
  'multiplier', 100.0
), date_basis = 'CREATED_AT', grain = 'DAILY'
WHERE code = 'LEAD_CONVERSION_RATE';

-- 2. SUB-RPT.04: Report Runs Table
CREATE TABLE IF NOT EXISTS report_run (
  id              text PRIMARY KEY CHECK (id ~ '^rpr_[A-Za-z0-9_-]+$'),
  tenant_id       text NOT NULL REFERENCES tenant(id),
  report_code     text NOT NULL CHECK (char_length(report_code) BETWEEN 3 AND 50),
  status          text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count       integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  result_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      text NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  download_url    text,
  error_message   text
);

CREATE INDEX IF NOT EXISTS report_run_tenant_idx ON report_run (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_run_status_idx ON report_run (tenant_id, status);

ALTER TABLE report_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_run FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'report_run' AND policyname = 'report_run_tenant_isolation'
  ) THEN
    CREATE POLICY report_run_tenant_isolation ON report_run
      FOR ALL TO dsa_app
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

-- 3. SUB-RPT.05: ENT-111 export_job Table
CREATE TABLE IF NOT EXISTS export_job (
  id              text PRIMARY KEY CHECK (id ~ '^exp_[A-Za-z0-9_-]+$'),
  tenant_id       text NOT NULL REFERENCES tenant(id),
  requester_id    text NOT NULL REFERENCES app_user(id),
  scope_type      text NOT NULL CHECK (scope_type IN ('TENANT', 'BRANCH', 'USER')),
  scope_id        text,
  export_type     text NOT NULL CHECK (char_length(export_type) BETWEEN 2 AND 50),
  file_format     text NOT NULL CHECK (file_format IN ('CSV', 'XLSX', 'JSON')),
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count       integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  file_key        text,
  status          text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  download_url    text,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  downloaded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_job_tenant_idx ON export_job (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS export_job_requester_idx ON export_job (tenant_id, requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS export_job_expires_idx ON export_job (expires_at) WHERE status = 'COMPLETED';

ALTER TABLE export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_job FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'export_job' AND policyname = 'export_job_tenant_isolation'
  ) THEN
    CREATE POLICY export_job_tenant_isolation ON export_job
      FOR ALL TO dsa_app
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

-- 4. SUB-RPT.05: report_schedule Table
CREATE TABLE IF NOT EXISTS report_schedule (
  id                text PRIMARY KEY CHECK (id ~ '^sch_[A-Za-z0-9_-]+$'),
  tenant_id         text NOT NULL REFERENCES tenant(id),
  report_code       text NOT NULL CHECK (char_length(report_code) BETWEEN 3 AND 50),
  frequency         text NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  filters           jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_emails  text[] NOT NULL DEFAULT '{}',
  recipient_scope   text NOT NULL DEFAULT 'TENANT' CHECK (recipient_scope IN ('TENANT', 'BRANCH')),
  created_by        text NOT NULL REFERENCES app_user(id),
  is_active         boolean NOT NULL DEFAULT true,
  last_run_at       timestamptz,
  next_run_at       timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_schedule_tenant_idx ON report_schedule (tenant_id, is_active);

ALTER TABLE report_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedule FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'report_schedule' AND policyname = 'report_schedule_tenant_isolation'
  ) THEN
    CREATE POLICY report_schedule_tenant_isolation ON report_schedule
      FOR ALL TO dsa_app
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

-- 5. Grants for dsa_app runtime role (Zero DELETE privileges)
GRANT SELECT, INSERT, UPDATE ON report_run TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON export_job TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON report_schedule TO dsa_app;

-- 6. Permissions and Role Grants
INSERT INTO permission (code, description, introduced_in)
VALUES
  ('report.schedule', 'Create and manage recurring report distribution schedules', 'MOD-RPT'),
  ('export.run', 'Initiate record-level data exports with elevated audit logging', 'MOD-RPT')
ON CONFLICT (code) DO NOTHING;

-- Grants for export.run
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'export.run'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-FINANCE-EXEC')
ON CONFLICT DO NOTHING;

-- Grants for report.schedule
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'report.schedule'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR')
ON CONFLICT DO NOTHING;
