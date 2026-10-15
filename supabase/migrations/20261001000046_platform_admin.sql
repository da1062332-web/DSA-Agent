-- Migration: 20261001000046_platform_admin.sql
-- Module: MOD-ADM (Module 40 / TASK-427 Platform Administration)
-- Persistent database tables, permissions, and initial catalog seeds for:
-- 1. Feature Flags
-- 2. Master Data
-- 3. Support Access Grants
-- 4. Data Correction Requests

SET search_path = app, extensions, public;

-- 1. Register canonical permissions in app.permission
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('platform.console', 'Access multi-tenant platform console and overview', 'TASK-427'),
  ('platform.flags', 'Read and update global and tenant feature flags', 'TASK-427'),
  ('platform.master_data', 'Manage master data datasets, codes, and schemas', 'TASK-427'),
  ('platform.jobs', 'Monitor and control background queues and dead-letter queues', 'TASK-427'),
  ('platform.support_access', 'Request and manage cross-tenant support access sessions', 'TASK-427'),
  ('platform.release', 'Manage platform release trains and schema verification', 'TASK-427'),
  ('data_correction.request', 'Submit four-eyes data correction requests', 'TASK-427'),
  ('data_correction.approve', 'Approve and execute four-eyes data correction requests', 'TASK-427')
ON CONFLICT (code) DO NOTHING;

-- Grant permissions to administrative platform roles
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES
    ('platform.console'),
    ('platform.flags'),
    ('platform.master_data'),
    ('platform.jobs'),
    ('platform.support_access'),
    ('platform.release'),
    ('data_correction.request'),
    ('data_correction.approve')
) AS p(code)
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-TENANT-ADMIN')
ON CONFLICT DO NOTHING;

-- Grant data_correction.request to branch manager and loan ops roles
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'data_correction.request'
FROM app.role r
WHERE r.code IN ('ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;

-- 2. Persistent table: feature_flag
CREATE TABLE IF NOT EXISTS app.feature_flag (
  key           text NOT NULL,
  scope         text NOT NULL DEFAULT 'GLOBAL',
  value         boolean NOT NULL DEFAULT false,
  owner         text NOT NULL,
  remove_by     date,
  description   text,
  lock_version  integer NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  PRIMARY KEY (key, scope)
);

-- Seed baseline feature flags
INSERT INTO app.feature_flag (key, scope, value, owner, remove_by, description, lock_version, updated_by) VALUES
  ('bre.v2_engine', 'GLOBAL', true, 'Platform Team', '2026-12-31', 'Enable next-generation compiled-IR Business Rule Engine', 1, 'SYSTEM:migration'),
  ('lender.instant_submission', 'GLOBAL', true, 'Lender Integrations Squad', NULL, 'Direct API dispatch for empanelled lenders', 1, 'SYSTEM:migration'),
  ('mfa.enforce_all', 'GLOBAL', true, 'Security Squad', NULL, 'Require TOTP step-up on sensitive operations', 1, 'SYSTEM:migration'),
  ('payout.bank_batching', 'GLOBAL', true, 'Finance Squad', NULL, 'Enable bank batch generation and NACH/NEFT CSV export', 1, 'SYSTEM:migration')
ON CONFLICT (key, scope) DO NOTHING;

-- 3. Persistent table: master_data_item
CREATE TABLE IF NOT EXISTS app.master_data_item (
  dataset       text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_version  integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  PRIMARY KEY (dataset, code)
);

-- Seed baseline master data items
INSERT INTO app.master_data_item (dataset, code, label, is_active, created_by) VALUES
  ('loan_categories', 'HL', 'Home Loan', true, 'SYSTEM:migration'),
  ('loan_categories', 'LAP', 'Loan Against Property', true, 'SYSTEM:migration'),
  ('loan_categories', 'BL', 'Business Loan', true, 'SYSTEM:migration'),
  ('loan_categories', 'PL', 'Personal Loan', true, 'SYSTEM:migration'),
  ('kyc_document_types', 'PAN', 'Permanent Account Number Card', true, 'SYSTEM:migration'),
  ('kyc_document_types', 'AADHAAR', 'Aadhaar Masked Offline e-KYC', true, 'SYSTEM:migration'),
  ('kyc_document_types', 'PASSPORT', 'Indian Passport', true, 'SYSTEM:migration'),
  ('kyc_document_types', 'VOTER_ID', 'Election Commission Voter Card', true, 'SYSTEM:migration'),
  ('kyc_document_types', 'DRIVING_LICENCE', 'Indian Driving Licence', true, 'SYSTEM:migration')
ON CONFLICT (dataset, code) DO NOTHING;

-- 4. Persistent table: support_access_grant
CREATE TABLE IF NOT EXISTS app.support_access_grant (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES app.tenant(id),
  support_user_id text NOT NULL,
  reason          text NOT NULL,
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  approved_by     text,
  approved_at     timestamptz,
  revoked_by      text,
  revoked_at      timestamptz,
  lock_version    integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

CREATE INDEX IF NOT EXISTS support_access_grant_tenant_idx ON app.support_access_grant (tenant_id, status);
CALL enable_tenant_rls('support_access_grant');

-- 5. Persistent table: data_correction_request
CREATE TABLE IF NOT EXISTS app.data_correction_request (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES app.tenant(id),
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  field_name      text NOT NULL,
  old_value       text,
  new_value       text NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED')),
  submitted_by    text NOT NULL,
  approved_by     text,
  approved_at     timestamptz,
  lock_version    integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

CREATE INDEX IF NOT EXISTS data_correction_request_tenant_idx ON app.data_correction_request (tenant_id, status);
CALL enable_tenant_rls('data_correction_request');

-- Role grants (strictly SELECT, INSERT, UPDATE; NO DELETE as per NFR-SEC-003)
GRANT SELECT, INSERT, UPDATE ON app.feature_flag TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.master_data_item TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.support_access_grant TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.data_correction_request TO dsa_app;
