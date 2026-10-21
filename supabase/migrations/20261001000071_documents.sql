-- Migration: 20261001000071_documents.sql
-- Owner: Dev 3 (MOD-DOC, Module 20; TASK-401) — built in the 2026-10-19 audit follow-up
-- The document module behind the checklist (SUB-DOC.01, .03 to .07): types, upload intents, documents with immutable versions,
-- reviews, the access log, and legal holds (ENT-098, used by MOD-PRV and the retention job). Object bytes live in storage;
-- these rows hold keys and hashes only.

SET search_path = app, extensions, public;

CREATE TABLE document_type (                                     -- ENT-057
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  code             text NOT NULL CHECK (code ~ '^[A-Z_]{2,40}$'),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  category         text NOT NULL CHECK (category IN ('IDENTITY', 'ADDRESS', 'INCOME', 'BUSINESS', 'PROPERTY', 'BANKING', 'OTHER')),
  allowed_mime     text[] NOT NULL DEFAULT '{application/pdf,image/jpeg,image/png}' CHECK (cardinality(allowed_mime) > 0),
  max_size_bytes   bigint NOT NULL DEFAULT 10485760 CHECK (max_size_bytes BETWEEN 1024 AND 52428800),
  validity_months  smallint CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120),
  sensitivity      text NOT NULL DEFAULT 'S2' CHECK (sensitivity IN ('S1', 'S2', 'S3')),
  retention_class  text NOT NULL DEFAULT 'R-LOAN' CHECK (retention_class IN ('R-CFG', 'R-OPS', 'R-LOAN', 'R-FIN', 'R-AUD', 'R-SHORT')),
  instructions     text CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  active           boolean NOT NULL DEFAULT true,
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE document (                                          -- ENT-058
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  owner_type          text NOT NULL CHECK (owner_type IN ('APPLICATION', 'PARTY', 'CONNECTOR', 'LENDER_CASE')),
  owner_id            text NOT NULL,
  application_id      text,
  checklist_item_id   text,
  document_type_code  text NOT NULL CHECK (document_type_code ~ '^[A-Z_]{2,40}$'),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'PURGED')),
  current_version_id  text,
  lock_version        integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  FOREIGN KEY (tenant_id, checklist_item_id) REFERENCES checklist_item (tenant_id, id)
);
CREATE INDEX document_application_idx ON document (tenant_id, application_id, document_type_code);
CREATE UNIQUE INDEX document_checklist_item_uq ON document (tenant_id, checklist_item_id) WHERE checklist_item_id IS NOT NULL;

CREATE TABLE document_version (                                  -- ENT-059 (S3: keys and hashes only)
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  document_id     text NOT NULL,
  version_no      integer NOT NULL CHECK (version_no >= 1),
  object_key      text NOT NULL,
  file_name       text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  sha256          char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  detected_mime   text NOT NULL,
  scan_status     text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING', 'CLEAN', 'QUARANTINED')),
  review_status   text NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED')),
  valid_until     date,
  uploaded_by     text NOT NULL,
  uploaded_via    text NOT NULL CHECK (uploaded_via IN ('STAFF', 'CUSTOMER_LINK', 'CONNECTOR', 'PARTNER_API')),
  purged_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (document_id, version_no),
  FOREIGN KEY (tenant_id, document_id) REFERENCES document (tenant_id, id)
);
ALTER TABLE document ADD CONSTRAINT document_current_version_fk
  FOREIGN KEY (tenant_id, current_version_id) REFERENCES document_version (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

-- A version's content never changes: only its scan and review state, validity and purge marker move.
CREATE OR REPLACE FUNCTION document_version_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['scan_status', 'review_status', 'valid_until', 'purged_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['scan_status', 'review_status', 'valid_until', 'purged_at']) THEN
    RAISE EXCEPTION 'document_version % is immutable', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_version_content_guard BEFORE UPDATE ON document_version
  FOR EACH ROW EXECUTE FUNCTION document_version_content_guard();

CREATE TABLE document_review (                                   -- ENT-060 (append-only)
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  version_id    text NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('ACCEPT', 'REJECT')),
  reason_code   text CHECK (reason_code IS NULL OR reason_code IN ('ILLEGIBLE', 'EXPIRED_DOCUMENT', 'MISMATCH', 'INCOMPLETE', 'WRONG_DOCUMENT', 'OTHER')),
  comment       text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  valid_until   date,
  reviewer_id   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES document_version (tenant_id, id),
  CHECK (decision <> 'REJECT' OR reason_code IS NOT NULL)
);

CREATE TABLE document_access_log (                               -- ENT-061 (append-only; not partitioned: ADR-4D-03)
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  version_id    text NOT NULL,
  action        text NOT NULL CHECK (action IN ('VIEW', 'DOWNLOAD', 'ARCHIVE')),
  principal_id  text NOT NULL,
  purpose       text CHECK (purpose IS NULL OR char_length(purpose) <= 200),
  ip            inet,
  at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES document_version (tenant_id, id)
);
CREATE INDEX document_access_log_version_idx ON document_access_log (tenant_id, version_id, at DESC);

CREATE TABLE upload_intent (                                     -- SUB-DOC.03 direct upload (one per file)
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  checklist_item_id   text NOT NULL,
  application_id      text NOT NULL,
  document_type_code  text NOT NULL,
  file_name           text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  size_bytes          bigint NOT NULL CHECK (size_bytes > 0),
  mime_type           text NOT NULL,
  sha256              char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  token_hash          char(64) NOT NULL UNIQUE,
  object_key          text,
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UPLOADED', 'COMPLETED', 'EXPIRED')),
  expires_at          timestamptz NOT NULL,
  document_id         text,
  version_id          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, checklist_item_id) REFERENCES checklist_item (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id)
);

CREATE TABLE legal_hold (                                        -- ENT-098
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  subject_type  text NOT NULL CHECK (subject_type IN ('CUSTOMER', 'LOAN_APPLICATION', 'LEAD', 'DOCUMENT')),
  subject_id    text NOT NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  reference     text CHECK (reference IS NULL OR char_length(reference) <= 200),
  placed_by     text NOT NULL,
  placed_at     timestamptz NOT NULL DEFAULT now(),
  released_by   text,
  released_at   timestamptz,
  release_reason text,
  lock_version  integer NOT NULL DEFAULT 0,
  CHECK ((released_at IS NULL) = (released_by IS NULL))
);
CREATE INDEX legal_hold_subject_idx ON legal_hold (tenant_id, subject_type, subject_id) WHERE released_at IS NULL;

CREATE TABLE document_archive (                                  -- API-DOC-009 (encrypted bulk archive, built by the job worker)
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  application_id  text NOT NULL,
  status          text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'READY', 'FAILED')),
  object_key      text,
  document_count  integer NOT NULL DEFAULT 0,
  failure_reason  text,
  requested_by    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  CHECK (status <> 'READY' OR object_key IS NOT NULL),
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL)
);

CREATE TRIGGER document_type_touch BEFORE UPDATE ON document_type FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER document_touch      BEFORE UPDATE ON document      FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER document_review_append_only     BEFORE UPDATE OR DELETE ON document_review     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER document_access_log_append_only BEFORE UPDATE OR DELETE ON document_access_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('document_type');   CALL enable_tenant_rls('document');        CALL enable_tenant_rls('document_version');
CALL enable_tenant_rls('document_review'); CALL enable_tenant_rls('document_access_log');
CALL enable_tenant_rls('upload_intent');   CALL enable_tenant_rls('legal_hold');   CALL enable_tenant_rls('document_archive');

GRANT SELECT, INSERT, UPDATE ON document_type, document, document_version, upload_intent, legal_hold, document_archive TO dsa_app;
GRANT SELECT, INSERT ON document_review, document_access_log TO dsa_app;

-- An upload intent is reached by its link token from the unauthenticated upload route, before any tenant is known. Like the
-- other public links (M-025), the token hash resolves the tenant and nothing else.
CREATE OR REPLACE FUNCTION app.resolve_upload_intent(p_token_hash text)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$ SELECT u.tenant_id, u.id FROM app.upload_intent u WHERE u.token_hash = p_token_hash $$;
REVOKE ALL ON FUNCTION app.resolve_upload_intent(text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION app.resolve_upload_intent(text) FROM %I', r);
    END IF;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION app.resolve_upload_intent(text) TO dsa_app;
