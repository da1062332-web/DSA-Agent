-- ============================================================================
-- Migration M-033: 20261001000033_import_export_framework.sql
-- Module: MOD-IMP (Import & Export Framework) — Domain DOM-O
-- Task: TASK-413
-- Introduces:
--   1. ENT-110 import_batch table with tenant isolation & RLS
--   2. app.job_queue table for PostgreSQL-backed asynchronous worker processing
--   3. Foreign key import_batch_id on lead (ENT-020) and customer (ENT-025)
--   4. import.run permission and role grants
-- ============================================================================

-- 1. SUB-IMP.01: ENT-110 import_batch Table
SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS import_batch (
  id                  text PRIMARY KEY CHECK (id ~ '^imp_[A-Za-z0-9_-]+$'),
  tenant_id           text NOT NULL REFERENCES tenant(id),
  requester_id        text NOT NULL REFERENCES app_user(id),
  target_entity       text NOT NULL CHECK (target_entity IN ('LEAD', 'CUSTOMER')),
  source_file_key     text NOT NULL,
  file_format         text NOT NULL CHECK (file_format IN ('CSV', 'XLSX')),
  file_size_bytes     bigint NOT NULL CHECK (file_size_bytes >= 0),
  checksum_sha256     text NOT NULL,
  idempotency_key     text,
  column_mapping      jsonb NOT NULL DEFAULT '{}'::jsonb,
  import_options      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL CHECK (status IN ('UPLOADED', 'PARSED', 'MAPPED', 'VALIDATING', 'READY', 'COMMITTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK')),
  total_rows          integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows          integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows        integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  imported_rows       integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  report_file_key     text,
  error_summary       jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_data        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  committed_at        timestamptz,
  rolled_back_at      timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  lock_version        integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);

CREATE INDEX IF NOT EXISTS import_batch_tenant_idx ON import_batch (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_batch_requester_idx ON import_batch (tenant_id, requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_batch_status_idx ON import_batch (tenant_id, status);
CREATE INDEX IF NOT EXISTS import_batch_expires_idx ON import_batch (expires_at) WHERE status <> 'ROLLED_BACK';

ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'import_batch' AND policyname = 'import_batch_tenant_isolation'
  ) THEN
    CREATE POLICY import_batch_tenant_isolation ON import_batch
      FOR ALL TO dsa_app
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

-- 2. Asynchronous Job Processing Queue (PostgreSQL-backed, safe SKIP LOCKED)
CREATE TABLE IF NOT EXISTS job_queue (
  id                  text PRIMARY KEY CHECK (id ~ '^job_[A-Za-z0-9_-]+$'),
  tenant_id           text NOT NULL REFERENCES tenant(id),
  job_type            text NOT NULL CHECK (char_length(job_type) BETWEEN 2 AND 50),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  last_error          text,
  run_at              timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_queue_poll_idx ON job_queue (status, run_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS job_queue_tenant_idx ON job_queue (tenant_id, created_at DESC);

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'job_queue' AND policyname = 'job_queue_tenant_isolation'
  ) THEN
    CREATE POLICY job_queue_tenant_isolation ON job_queue
      FOR ALL TO dsa_app
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

-- 3. Batch Attribution on Target Entities for 24-hr Rollback
ALTER TABLE lead ADD COLUMN IF NOT EXISTS import_batch_id text REFERENCES import_batch(id);
CREATE INDEX IF NOT EXISTS lead_import_batch_idx ON lead (tenant_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

ALTER TABLE customer ADD COLUMN IF NOT EXISTS import_batch_id text REFERENCES import_batch(id);
CREATE INDEX IF NOT EXISTS customer_import_batch_idx ON customer (tenant_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

-- 4. Permissions & Role Grants
INSERT INTO permission (code, description, introduced_in)
VALUES
  ('import.run', 'Initiate bulk file imports, configure column mappings, and commit batches', 'MOD-IMP')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'import.run'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR')
ON CONFLICT DO NOTHING;

-- 5. Least-Privilege Grants to dsa_app (Zero DELETE privileges)
GRANT SELECT, INSERT, UPDATE ON import_batch TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON job_queue TO dsa_app;
