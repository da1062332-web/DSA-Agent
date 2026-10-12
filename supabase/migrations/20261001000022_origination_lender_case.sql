-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §7.
-- Owner (v1.2 Assignment Matrix §3): Dev 4. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0022_origination_lender_case.sql  (owner: Dev 3, TASK-301)
CREATE TABLE lender_case (                                       -- ENT-051
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  application_id       text NOT NULL,
  lender_id            text NOT NULL,
  product_version_id   text NOT NULL,
  empanelment_id       text NOT NULL,
  attempt_no           integer NOT NULL CHECK (attempt_no >= 1),
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PACKAGE_READY','SUBMITTED','UNDER_PROCESSING','QUERY_RAISED','QUERY_RESPONDED','SANCTIONED','REJECTED','WITHDRAWN','SANCTION_EXPIRED','SANCTION_CANCELLED','PARTIALLY_DISBURSED','DISBURSED','CLOSED')),
  lender_reference     text,
  submission_channel   text CHECK (submission_channel IS NULL OR submission_channel IN ('PORTAL','EMAIL','API','PHYSICAL')),
  submitted_at         timestamptz,
  package_id           text,
  status_source        text CHECK (status_source IS NULL OR status_source IN ('MANUAL','LENDER_API','LENDER_FILE','EMAIL_PARSED')),
  last_status_at       timestamptz,
  decline_reason_code  text CHECK (decline_reason_code IS NULL OR decline_reason_code IN ('POLICY','INCOME','CREDIT_HISTORY','DOCUMENTATION','LOCATION','CUSTOMER_DECLINED','OTHER')),
  staleness_flag       boolean NOT NULL DEFAULT false,
  tags                 text[] NOT NULL DEFAULT '{}',
  lock_version         integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (application_id, attempt_no),
  FOREIGN KEY (tenant_id, application_id)     REFERENCES loan_application (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id)          REFERENCES lender (tenant_id, id),
  FOREIGN KEY (tenant_id, product_version_id) REFERENCES loan_product_version (tenant_id, id),
  FOREIGN KEY (tenant_id, empanelment_id)     REFERENCES empanelment (tenant_id, id),
  CHECK (status IN ('DRAFT','PACKAGE_READY','WITHDRAWN') OR (submitted_at IS NOT NULL AND submission_channel IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR decline_reason_code IS NOT NULL)
);
CREATE UNIQUE INDEX lender_case_one_active_uq ON lender_case (application_id, lender_id)
  WHERE status IN ('DRAFT','PACKAGE_READY','SUBMITTED','UNDER_PROCESSING','QUERY_RAISED','QUERY_RESPONDED');   -- Doc 10 §5
CREATE INDEX lender_case_app_idx ON lender_case (tenant_id, application_id, attempt_no);

CREATE TABLE lender_case_status_history (                        -- ENT-052
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  lender_case_id  text NOT NULL,
  from_status     text,
  to_status       text NOT NULL,
  status_source   text NOT NULL CHECK (status_source IN ('MANUAL','LENDER_API','LENDER_FILE','EMAIL_PARSED','SYSTEM')),   -- BR-DOM-023
  reason_text     text CHECK (reason_text IS NULL OR char_length(reason_text) <= 1000),
  actor           text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lender_case_id) REFERENCES lender_case (tenant_id, id)
);
CREATE INDEX lender_case_status_history_case_idx ON lender_case_status_history (tenant_id, lender_case_id, occurred_at);

CREATE TABLE submission_package (                                -- ENT-054
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  lender_case_id   text NOT NULL,
  kind             text NOT NULL DEFAULT 'SUBMISSION' CHECK (kind IN ('SUBMISSION','QUERY_RESPONSE')),
  manifest         jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_sha256  char(64) NOT NULL,
  consent_ids      text[] NOT NULL CHECK (cardinality(consent_ids) > 0),
  built_by         text NOT NULL,
  built_at         timestamptz NOT NULL DEFAULT now(),
  frozen_at        timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_case_id) REFERENCES lender_case (tenant_id, id)
);
CREATE FUNCTION package_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL
     OR (to_jsonb(NEW) - 'frozen_at') IS DISTINCT FROM (to_jsonb(OLD) - 'frozen_at') THEN
    RAISE EXCEPTION 'submission_package % is immutable (only frozen_at may be set once)', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_package_guard  BEFORE UPDATE ON submission_package FOR EACH ROW EXECUTE FUNCTION package_freeze_guard();
CREATE TRIGGER lender_case_touch         BEFORE UPDATE ON lender_case        FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER lender_case_status_history_append_only BEFORE UPDATE OR DELETE ON lender_case_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('lender_case'); CALL enable_tenant_rls('lender_case_status_history'); CALL enable_tenant_rls('submission_package');
GRANT SELECT, INSERT, UPDATE ON lender_case, submission_package TO dsa_app;
GRANT SELECT, INSERT ON lender_case_status_history TO dsa_app;
