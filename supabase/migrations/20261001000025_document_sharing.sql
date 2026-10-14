-- 20261001000025_document_sharing.sql
-- Module 25: Document Sharing (MOD-DSH)
-- Covers: SUB-DSH.01 (upload_link ENT-062), SUB-DSH.02 (external_share ENT-063), uploaded_document (ENT-064)
SET search_path = app, extensions, public;

-- 1. Seed document sharing permissions
INSERT INTO permission (code, description, introduced_in) VALUES
  ('document.upload', 'Generate and revoke customer document upload links', 'POST-MVP'),
  ('share.create', 'Create and revoke third-party case share packages', 'POST-MVP')
ON CONFLICT (code) DO NOTHING;

-- Grant to default platform roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'document.upload'
FROM app.role r WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'share.create'
FROM app.role r WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;

-- 2. Extend public_entry_index (ENT-115) to support UPLOAD_LINK and STATUS_PORTAL kind
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'app' AND table_name = 'public_entry_index' AND column_name = 'kind'
  ) THEN
    ALTER TABLE public_entry_index 
      ADD COLUMN kind text NOT NULL DEFAULT 'WEBHOOK' CHECK (kind IN ('WEBHOOK', 'UPLOAD_LINK', 'STATUS_PORTAL')),
      ADD COLUMN target_id text;
  END IF;
END $$;

-- 3. ENT-062: upload_link
CREATE TABLE IF NOT EXISTS upload_link (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  application_id        text NOT NULL,
  token_hash            text NOT NULL UNIQUE,
  items                 text[] NOT NULL CHECK (cardinality(items) > 0),
  recipient_contact_id  text,
  recipient_contact_hint text,
  expires_at            timestamptz NOT NULL,
  otp_required          boolean NOT NULL DEFAULT true,
  otp_hash              text,
  otp_expires_at        timestamptz,
  failed_attempts       smallint NOT NULL DEFAULT 0,
  max_uses              smallint NOT NULL DEFAULT 5 CHECK (max_uses >= 1),
  uses                  smallint NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at            timestamptz,
  revoked_by            text,
  locked_at             timestamptz,
  lock_version          integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (uses <= max_uses)
);

CREATE INDEX IF NOT EXISTS upload_link_app_idx ON upload_link (tenant_id, application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_link_token_hash_idx ON upload_link (token_hash);

CREATE TRIGGER upload_link_touch BEFORE UPDATE ON upload_link FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('upload_link');
GRANT SELECT, INSERT, UPDATE ON upload_link TO dsa_app;

-- 4. ENT-063: external_share
CREATE TABLE IF NOT EXISTS external_share (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  application_id        text NOT NULL,
  recipient_type        text NOT NULL CHECK (recipient_type IN ('LENDER', 'CO_LENDER', 'PARTNER', 'AUDITOR')),
  recipient_id          text NOT NULL,
  recipient_contact     jsonb NOT NULL CHECK (jsonb_typeof(recipient_contact) = 'object'),
  purpose               text NOT NULL CHECK (purpose IN ('LENDER_SUBMISSION', 'PORTFOLIO_REVIEW', 'AUDIT_INSPECTION')),
  consent_ids           text[] NOT NULL CHECK (cardinality(consent_ids) > 0),
  manifest              jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoked_by            text,
  access_count          integer NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  data_sharing_record_id text,
  lock_version          integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS external_share_app_idx ON external_share (tenant_id, application_id, created_at DESC);
CREATE TRIGGER external_share_touch BEFORE UPDATE ON external_share FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('external_share');
GRANT SELECT, INSERT, UPDATE ON external_share TO dsa_app;

-- 5. ENT-064: uploaded_document
CREATE TABLE IF NOT EXISTS uploaded_document (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  application_id      text NOT NULL,
  checklist_item_id   text,
  upload_link_id      text REFERENCES upload_link(id),
  file_name           text NOT NULL,
  file_size_bytes     bigint NOT NULL CHECK (file_size_bytes > 0),
  mime_type           text NOT NULL,
  storage_path        text NOT NULL,
  sha256_hash         text NOT NULL,
  scan_status         text NOT NULL DEFAULT 'CLEAN' CHECK (scan_status IN ('PENDING', 'CLEAN', 'QUARANTINED', 'INFECTED')),
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS uploaded_doc_app_idx ON uploaded_document (tenant_id, application_id);
CREATE TRIGGER uploaded_doc_touch BEFORE UPDATE ON uploaded_document FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('uploaded_document');
GRANT SELECT, INSERT, UPDATE ON uploaded_document TO dsa_app;

-- 6. Extend data_sharing_record check constraints
ALTER TABLE data_sharing_record 
  DROP CONSTRAINT IF EXISTS data_sharing_record_recipient_type_check,
  DROP CONSTRAINT IF EXISTS data_sharing_record_purpose_check;

ALTER TABLE data_sharing_record
  ADD CONSTRAINT data_sharing_record_recipient_type_check 
    CHECK (recipient_type IN ('LENDER', 'CO_LENDER', 'PARTNER', 'AUDITOR')),
  ADD CONSTRAINT data_sharing_record_purpose_check 
    CHECK (purpose IN ('LENDER_SUBMISSION', 'PORTFOLIO_REVIEW', 'AUDIT_INSPECTION'));

-- 7. SECURITY DEFINER function for resolving public upload links anonymously
CREATE OR REPLACE FUNCTION app.resolve_public_upload_link(p_token_hash text)
RETURNS TABLE (
  tenant_id text,
  upload_link_id text,
  application_id text,
  items text[],
  expires_at timestamptz,
  otp_required boolean,
  otp_hash text,
  otp_expires_at timestamptz,
  failed_attempts smallint,
  max_uses smallint,
  uses smallint,
  revoked_at timestamptz,
  locked_at timestamptz,
  recipient_contact_hint text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT 
    tenant_id,
    id as upload_link_id,
    application_id,
    items,
    expires_at,
    otp_required,
    otp_hash,
    otp_expires_at,
    failed_attempts,
    max_uses,
    uses,
    revoked_at,
    locked_at,
    recipient_contact_hint
  FROM app.upload_link
  WHERE token_hash = p_token_hash
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app.resolve_public_upload_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_public_upload_link(text) TO dsa_app;
