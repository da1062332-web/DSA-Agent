-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §7.
-- Owner (v1.2 Assignment Matrix §3): Dev 3. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0021_origination_application.sql  (owner: Dev 3, TASK-301)
CREATE TABLE loan_application (                                  -- ENT-045
  id                             text PRIMARY KEY,
  tenant_id                      text NOT NULL REFERENCES tenant(id),
  branch_id                      text NOT NULL,
  customer_id                    text NOT NULL,
  lead_id                        text,
  product_category               text NOT NULL CHECK (product_category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER')),
  product_version_id             text,
  requested_amount               numeric(18,2) NOT NULL CHECK (requested_amount > 0),
  currency                       char(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  tenure_months                  integer CHECK (tenure_months IS NULL OR tenure_months BETWEEN 1 AND 480),
  purpose_code                   text CHECK (purpose_code IS NULL OR purpose_code IN ('PERSONAL_NEEDS','MEDICAL','EDUCATION','HOME_PURCHASE','HOME_IMPROVEMENT','VEHICLE','WORKING_CAPITAL','BUSINESS_EXPANSION','DEBT_CONSOLIDATION','OTHER')),
  applicant_type                 text NOT NULL CHECK (applicant_type IN ('SALARIED','SELF_EMPLOYED_PROFESSIONAL','SELF_EMPLOYED_BUSINESS','NON_INDIVIDUAL')),
  status                         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','DOCUMENTS_PENDING','UNDER_REVIEW','READY_FOR_SUBMISSION','SUBMITTED','SANCTIONED','PARTIALLY_DISBURSED','DISBURSED','CLOSED','REJECTED','WITHDRAWN','CANCELLED')),
  sub_status                     text CHECK (sub_status IS NULL OR sub_status IN ('QUERY_PENDING')),
  cancel_reason                  text CHECK (cancel_reason IS NULL OR cancel_reason IN ('DUPLICATE','CREATED_IN_ERROR','INELIGIBLE','OTHER')),
  rework_reason                  text,
  sales_owner_id                 text NOT NULL,
  ops_owner_id                   text,
  ops_queue_id                   text,
  last_checklist_decision_ids    text[] NOT NULL DEFAULT '{}',
  last_completeness_decision_id  text,
  last_completeness_result       text CHECK (last_completeness_result IS NULL OR last_completeness_result IN ('COMPLETE','INCOMPLETE')),
  tags                           text[] NOT NULL DEFAULT '{}',
  lock_version                   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)          REFERENCES branch (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)        REFERENCES customer (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)            REFERENCES lead (tenant_id, id),
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES loan_product_version (tenant_id, id),
  FOREIGN KEY (tenant_id, sales_owner_id)     REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, ops_owner_id)       REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, ops_queue_id)       REFERENCES work_queue (tenant_id, id),
  CHECK (status IN ('DRAFT','CANCELLED') OR product_version_id IS NOT NULL),      -- T-APP-01 guard
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE UNIQUE INDEX loan_application_lead_uq ON loan_application (tenant_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX loan_application_status_idx    ON loan_application (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX loan_application_sales_idx     ON loan_application (tenant_id, sales_owner_id, status);
CREATE INDEX loan_application_branch_idx    ON loan_application (tenant_id, branch_id, created_at DESC, id DESC);

CREATE TABLE application_party (                                 -- ENT-046
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  application_id  text NOT NULL,
  customer_id     text NOT NULL,
  role            text NOT NULL CHECK (role IN ('PRIMARY','CO_APPLICANT','GUARANTOR')),
  party_type      text NOT NULL CHECK (party_type IN ('INDIVIDUAL','ENTITY')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (application_id, customer_id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id)
);
CREATE UNIQUE INDEX application_party_one_primary_uq ON application_party (application_id) WHERE role = 'PRIMARY';

CREATE TABLE application_status_history (                        -- ENT-047
  id                        text PRIMARY KEY,
  tenant_id                 text NOT NULL REFERENCES tenant(id),
  application_id            text NOT NULL,
  from_status               text,
  to_status                 text NOT NULL,
  from_sub_status           text,
  to_sub_status             text,
  transition_code           text NOT NULL CHECK (transition_code ~ '^(CREATE|T-APP-(0[1-9]|1[01])|ROLLUP-[1-6])$'),
  reason_code               text,
  actor                     text NOT NULL,
  caused_by_lender_case_id  text,
  decision_record_id        text,
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id)
);
CREATE INDEX application_status_history_app_idx ON application_status_history (tenant_id, application_id, occurred_at);

CREATE TABLE checklist_item (                                    -- ENT-048 (+ PA-03 attestation columns)
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  application_id      text NOT NULL,
  party_id            text NOT NULL,
  document_type_code  text NOT NULL CHECK (document_type_code ~ '^[A-Z_]{2,40}$'),
  ordinal             smallint NOT NULL DEFAULT 1 CHECK (ordinal >= 1),
  mandatory           boolean NOT NULL,
  required_count      smallint NOT NULL DEFAULT 1 CHECK (required_count >= 1),
  period_months       smallint CHECK (period_months IS NULL OR period_months >= 0),
  status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','ACCEPTED','REJECTED','WAIVED','NOT_APPLICABLE','EXPIRED')),
  source_decision_id  text NOT NULL,
  attestation_note    text CHECK (attestation_note IS NULL OR char_length(attestation_note) <= 500),
  reviewed_by         text,
  reviewed_at         timestamptz,
  reject_reason       text CHECK (reject_reason IS NULL OR reject_reason IN ('ILLEGIBLE','EXPIRED_DOCUMENT','MISMATCH','INCOMPLETE','WRONG_DOCUMENT','OTHER')),
  document_id         text,                                      -- populated by TASK-401
  lock_version        integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (application_id, party_id, document_type_code, ordinal),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES application_party (tenant_id, id),
  CHECK (status <> 'REJECTED' OR reject_reason IS NOT NULL),
  CHECK (status NOT IN ('ACCEPTED','REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX checklist_item_app_idx ON checklist_item (tenant_id, application_id, status);

CREATE TRIGGER loan_application_touch BEFORE UPDATE ON loan_application FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER checklist_item_touch   BEFORE UPDATE ON checklist_item   FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER application_party_append_only          BEFORE UPDATE OR DELETE ON application_party          FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER application_status_history_append_only BEFORE UPDATE OR DELETE ON application_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('loan_application');            CALL enable_tenant_rls('application_party');
CALL enable_tenant_rls('application_status_history');  CALL enable_tenant_rls('checklist_item');
GRANT SELECT, INSERT, UPDATE ON loan_application, checklist_item TO dsa_app;
GRANT SELECT, INSERT ON application_party, application_status_history TO dsa_app;

-- Foreign key constraints from verification_request (M-019) to loan_application and application_party
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'verification_request') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_request_application_id_fkey') THEN
      ALTER TABLE verification_request ADD CONSTRAINT verification_request_application_id_fkey FOREIGN KEY (application_id) REFERENCES loan_application(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_request_party_id_fkey') THEN
      ALTER TABLE verification_request ADD CONSTRAINT verification_request_party_id_fkey FOREIGN KEY (party_id) REFERENCES application_party(id);
    END IF;
  END IF;
END $$;

