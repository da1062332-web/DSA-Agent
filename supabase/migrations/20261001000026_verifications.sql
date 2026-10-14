-- 20261001000026_verifications.sql
-- Module 22: Verification (MOD-VER, TASK-434)
-- Covers: SUB-VER.01 (verification ENT-064), SUB-VER.02 (manual verification), SUB-VER.03 (provider checks)
SET search_path = app, extensions, public;

-- 1. Register permission codes in platform registry
INSERT INTO permission (code, description, introduced_in) VALUES
  ('verification.perform', 'Perform manual document verification or initiate provider checks', 'TASK-434'),
  ('verification.read', 'Read verification records, audit reports, and check results', 'TASK-434')
ON CONFLICT (code) DO NOTHING;

-- 2. Define verification table (ENT-064)
CREATE TABLE IF NOT EXISTS verification (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  subject_type         text NOT NULL CHECK (subject_type IN ('CUSTOMER','LOAN_APPLICATION','LEAD')),
  subject_id           text NOT NULL,
  check_type           text NOT NULL CHECK (check_type IN ('PAN','GST','CIN','ITR','BANK_STATEMENT','BUREAU','IDENTITY_DOCUMENT','EMPLOYMENT','ADDRESS')),
  method               text NOT NULL CHECK (method IN ('MANUAL','PROVIDER_AUTOMATED')),
  purpose              text NOT NULL CHECK (purpose IN ('KYC','FINANCIAL_UNDERWRITING','EMPLOYMENT_CHECK','COLLATERAL_LEGAL','FRAUD_PREVENTION')),
  consent_record_id    text NOT NULL,
  result               text NOT NULL CHECK (result IN ('VERIFIED','REJECTED','FLAGGED','INCONCLUSIVE')),
  minimal_result       jsonb NOT NULL CHECK (jsonb_typeof(minimal_result) = 'object'),
  evidence_ref         text NOT NULL,
  validity_expires_at  timestamptz,
  performed_by         text NOT NULL,
  performed_at         timestamptz NOT NULL DEFAULT now(),
  notes                text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  lock_version         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (consent_record_id) REFERENCES consent_record (id),
  FOREIGN KEY (tenant_id, performed_by) REFERENCES app_user (tenant_id, id)
);

-- 3. Indexes for cursor pagination and subject lookups
CREATE INDEX IF NOT EXISTS verification_subject_idx 
  ON verification (tenant_id, subject_type, subject_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS verification_consent_idx 
  ON verification (tenant_id, consent_record_id);

CREATE INDEX IF NOT EXISTS verification_cursor_idx 
  ON verification (tenant_id, performed_at DESC, id DESC);

-- 4. Enable Row Level Security (RLS)
CALL enable_tenant_rls('verification');

-- 5. Immutability trigger: Verification records are immutable audit logs
CREATE TRIGGER verification_no_mutation 
  BEFORE UPDATE OR DELETE ON verification
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 6. Role grant for application database user
GRANT SELECT, INSERT ON verification TO dsa_app;
