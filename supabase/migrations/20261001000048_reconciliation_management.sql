-- supabase/migrations/20261001000048_reconciliation_management.sql
-- Module: MOD-REC (TASK-418 Reconciliation Management)
-- Entities: lender_statement (ENT-086), lender_statement_line (ENT-087), 
--           reconciliation_match (ENT-088), reconciliation_exception (ENT-089),
--           adjustment updates (ENT-090), dispute (ENT-091)

SET search_path = app, extensions, public;

-- 1. Permissions Seed
INSERT INTO permission (code, description, introduced_in)
VALUES
  ('finance.reconcile', 'Reconcile lender statements, match lines, resolve exceptions, and manage disputes', 'TASK-418'),
  ('finance.dispute', 'Raise financial and payable disputes on lender statements and payouts', 'TASK-418'),
  ('adjustment.create', 'Propose financial adjustments and clawbacks', 'TASK-418'),
  ('adjustment.approve', 'Approve or reject financial adjustments under SOD-07', 'TASK-418')
ON CONFLICT (code) DO NOTHING;

-- 2. Role Seed: ROLE-FINANCE-EXEC
INSERT INTO role (id, tenant_id, code, name, is_template, version, created_at, created_by)
SELECT 
  'rol_finance_exec_' || t.id,
  t.id,
  'ROLE-FINANCE-EXEC',
  'Finance Executive',
  false,
  1,
  now(),
  'SYSTEM:migration'
FROM tenant t
WHERE NOT EXISTS (
  SELECT 1 FROM role r WHERE r.tenant_id = t.id AND r.code = 'ROLE-FINANCE-EXEC'
);

-- 3. Role Permissions Grants
-- Grant finance.reconcile, finance.dispute, finance.view, adjustment.create to ROLE-FINANCE-EXEC
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.perm
FROM role r
CROSS JOIN (
  VALUES 
    ('finance.reconcile'),
    ('finance.dispute'),
    ('finance.view'),
    ('adjustment.create')
) AS p(perm)
WHERE r.code = 'ROLE-FINANCE-EXEC'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Grant adjustment.approve to ROLE-COMMISSION-APPROVER and ROLE-ORG-OWNER
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'adjustment.approve'
FROM role r
WHERE r.code IN ('ROLE-COMMISSION-APPROVER', 'ROLE-ORG-OWNER')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Grant reconciliation & dispute permissions to ROLE-ORG-OWNER
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.perm
FROM role r
CROSS JOIN (
  VALUES 
    ('finance.reconcile'),
    ('finance.dispute')
) AS p(perm)
WHERE r.code = 'ROLE-ORG-OWNER'
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 4. ENT-086: lender_statement
CREATE TABLE IF NOT EXISTS lender_statement (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  lender_id       text NOT NULL REFERENCES lender(id),
  period          text NOT NULL,
  source_file_key text NOT NULL,
  import_batch_id text NOT NULL,
  file_sha256     text NOT NULL,
  totals          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'IMPORTED' CHECK (status IN ('IMPORTED', 'MATCHED', 'PARTIALLY_MATCHED', 'RECONCILED', 'FAILED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  UNIQUE (tenant_id, lender_id, period, file_sha256),
  UNIQUE (tenant_id, id)
);

-- 5. ENT-087: lender_statement_line
CREATE TABLE IF NOT EXISTS lender_statement_line (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  statement_id         text NOT NULL REFERENCES lender_statement(id),
  loan_account_hash    text NOT NULL,
  customer_name_masked text NOT NULL,
  disbursed_amount     numeric(18,2) NOT NULL,
  commission_amount    numeric(18,2) NOT NULL,
  tax_deducted         numeric(18,2) NOT NULL DEFAULT 0,
  paid_on              date NOT NULL,
  raw_row_ref          text,
  status               text NOT NULL DEFAULT 'UNMATCHED' CHECK (status IN ('UNMATCHED', 'MATCHED', 'EXCEPTION', 'DISPUTED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_stmt_line_loan_hash ON lender_statement_line (tenant_id, loan_account_hash);
CREATE INDEX IF NOT EXISTS idx_stmt_line_stmt_id ON lender_statement_line (tenant_id, statement_id);

-- 6. ENT-088: reconciliation_match
CREATE TABLE IF NOT EXISTS reconciliation_match (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  statement_line_id  text NOT NULL REFERENCES lender_statement_line(id),
  calculation_id     text NOT NULL REFERENCES commission_calculation(id),
  match_type         text NOT NULL CHECK (match_type IN ('EXACT', 'PARTIAL', 'VARIANCE', 'UNMATCHED', 'DUPLICATE')),
  matched_amount     numeric(18,2) NOT NULL,
  decision_record_id text REFERENCES decision_record(id),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_match_per_line 
  ON reconciliation_match (tenant_id, statement_line_id) 
  WHERE status = 'ACTIVE';

-- 7. ENT-089: reconciliation_exception
CREATE TABLE IF NOT EXISTS reconciliation_exception (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  statement_line_id text REFERENCES lender_statement_line(id),
  calculation_id    text REFERENCES commission_calculation(id),
  variance_amount   numeric(18,2) NOT NULL,
  classification    text NOT NULL CHECK (classification IN ('SHORT_REMITTANCE', 'OVER_REMITTANCE', 'MISSING_REMITTANCE', 'UNMATCHED_STATEMENT_LINE', 'DUPLICATE_REMITTANCE', 'TIMING_DIFFERENCE')),
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'WRITTEN_OFF')),
  owner_user_id     text REFERENCES app_user(id),
  evidence_ref      text,
  resolution_note   text,
  resolved_at       timestamptz,
  resolved_by       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_rec_exception_status ON reconciliation_exception (tenant_id, status);

-- 8. ENT-090: adjustment extension
ALTER TABLE adjustment DROP CONSTRAINT IF EXISTS adjustment_adjustment_type_check;
ALTER TABLE adjustment ADD CONSTRAINT adjustment_adjustment_type_check 
  CHECK (adjustment_type IN ('WRITE_OFF', 'CLAWBACK', 'CORRECTION', 'TAX', 'MANUAL'));

ALTER TABLE adjustment ADD COLUMN IF NOT EXISTS type text;
UPDATE adjustment SET type = adjustment_type WHERE type IS NULL;
ALTER TABLE adjustment ALTER COLUMN type SET DEFAULT 'CORRECTION';

ALTER TABLE adjustment ADD COLUMN IF NOT EXISTS journal_id text;
ALTER TABLE adjustment ADD COLUMN IF NOT EXISTS exception_id text REFERENCES reconciliation_exception(id);
ALTER TABLE adjustment ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 1;

-- 9. ENT-091: dispute
CREATE TABLE IF NOT EXISTS dispute (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  party_type            text NOT NULL CHECK (party_type IN ('LENDER', 'CONNECTOR')),
  party_id              text NOT NULL,
  subject_type          text NOT NULL CHECK (subject_type IN ('STATEMENT_LINE', 'PAYOUT', 'CALCULATION')),
  subject_id            text NOT NULL,
  reason                text NOT NULL,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'WITHDRAWN')),
  resolution            text,
  outcome_adjustment_id text REFERENCES adjustment(id),
  lock_version          integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_subject ON dispute (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_dispute_status ON dispute (tenant_id, status);

-- 10. Enable Tenant RLS
CALL enable_tenant_rls('lender_statement');
CALL enable_tenant_rls('lender_statement_line');
CALL enable_tenant_rls('reconciliation_match');
CALL enable_tenant_rls('reconciliation_exception');
CALL enable_tenant_rls('dispute');

-- 11. Grant dsa_app privileges
GRANT SELECT, INSERT, UPDATE ON 
  lender_statement, 
  lender_statement_line, 
  reconciliation_match, 
  reconciliation_exception, 
  dispute 
TO dsa_app;
