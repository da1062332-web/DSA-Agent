-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §5.
-- Owner (v1.2 Assignment Matrix §3): Dev 5. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0003_crm_leads_customers.sql  (owner: Dev 1, TASK-103)
CREATE TABLE customer (                                          -- ENT-025 (MVP subset; S3 fields absent: ADR-4D-04)
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  party_type      text NOT NULL CHECK (party_type IN ('INDIVIDUAL','ENTITY')),
  full_name       text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 200),
  home_branch_id  text NOT NULL,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MERGED')),
  lock_version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, home_branch_id) REFERENCES branch (tenant_id, id)
);

CREATE TABLE customer_contact_point (                            -- ENT-026
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  customer_id  text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('MOBILE','EMAIL')),
  value        text NOT NULL,
  value_hash   bytea NOT NULL,                                   -- HMAC-SHA256(tenant-scoped key, normalised value)
  is_primary   boolean NOT NULL DEFAULT false,
  verified_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, customer_id, kind, value_hash),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id)
);
CREATE INDEX customer_contact_point_hash_idx ON customer_contact_point (tenant_id, kind, value_hash);
CREATE UNIQUE INDEX customer_contact_point_primary_uq ON customer_contact_point (tenant_id, customer_id, kind) WHERE is_primary;

CREATE TABLE consent_record (                                    -- ENT-028 (Doc 10 §5)
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  subject_type       text NOT NULL CHECK (subject_type IN ('LEAD','CUSTOMER')),
  subject_id         text NOT NULL,
  purpose            text NOT NULL CHECK (purpose IN ('CONTACT','LOAN_PROCESSING','SHARE_WITH_LENDER','VERIFICATION_CHECK','MARKETING')),
  purpose_target     text,                                       -- lender id for SHARE_WITH_LENDER
  notice_version     text NOT NULL CHECK (notice_version ~ '^[A-Z0-9._-]{2,40}$'),
  channel            text NOT NULL CHECK (channel IN ('IN_PERSON','PHONE','WEB_FORM','EMAIL','OTP','DOCUMENT')),
  evidence_ref       text,
  captured_by        text NOT NULL,
  captured_at        timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN','EXPIRED')),
  withdrawn_at       timestamptz,
  withdrawn_by       text,
  withdrawal_reason  text,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose NOT IN ('SHARE_WITH_LENDER','VERIFICATION_CHECK') OR purpose_target IS NOT NULL),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX consent_record_active_idx ON consent_record (tenant_id, subject_type, subject_id, purpose, purpose_target) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX consent_record_one_active_uq ON consent_record (tenant_id, subject_type, subject_id, purpose, coalesce(purpose_target, '-')) WHERE status = 'ACTIVE';

CREATE FUNCTION consent_only_withdraw() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'WITHDRAWN'
     OR (to_jsonb(NEW) - ARRAY['status','withdrawn_at','withdrawn_by','withdrawal_reason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','withdrawn_at','withdrawn_by','withdrawal_reason']) THEN
    RAISE EXCEPTION 'consent_record % may only move ACTIVE -> WITHDRAWN', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_record_guard     BEFORE UPDATE ON consent_record FOR EACH ROW EXECUTE FUNCTION consent_only_withdraw();
CREATE TRIGGER consent_record_no_delete BEFORE DELETE ON consent_record FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE lead (                                              -- ENT-020 (Doc 10 §5 + PA-02)
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES tenant(id),
  branch_id                   text NOT NULL,
  full_name                   text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 200),
  mobile_e164                 text NOT NULL CHECK (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  mobile_hash                 bytea NOT NULL,
  email                       citext CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_hash                  bytea,
  product_category            text NOT NULL CHECK (product_category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER')),
  indicative_amount           numeric(18,2) CHECK (indicative_amount IS NULL OR indicative_amount >= 0),
  amount_currency             char(3) NOT NULL DEFAULT 'INR' CHECK (amount_currency ~ '^[A-Z]{3}$'),
  pincode                     char(6) CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  source                      text NOT NULL CHECK (source IN ('WALK_IN','PHONE','WEBSITE','REFERRAL','CAMPAIGN','API','OTHER')),   -- PA-09
  sub_source                  text,
  campaign                    text,
  utm                         jsonb CHECK (utm IS NULL OR jsonb_typeof(utm) = 'object'),
  connector_id                text CHECK (connector_id IS NULL),  -- FK + attribution added by TASK-417
  referred_at                 timestamptz,
  state                       text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW','CONTACT_ATTEMPTED','IN_PROGRESS','QUALIFIED','CONVERTED','DISQUALIFIED','NOT_CONTACTABLE','MERGED','ARCHIVED')),
  disqualification_reason     text CHECK (disqualification_reason IS NULL OR disqualification_reason IN ('NOT_INTERESTED','NOT_ELIGIBLE','DUPLICATE','UNREACHABLE','OTHER')),
  qual_applicant_type         text CHECK (qual_applicant_type IS NULL OR qual_applicant_type IN ('SALARIED','SELF_EMPLOYED_PROFESSIONAL','SELF_EMPLOYED_BUSINESS','NON_INDIVIDUAL')),
  qual_requested_amount       numeric(18,2) CHECK (qual_requested_amount IS NULL OR qual_requested_amount > 0),
  qual_tenure_months          integer CHECK (qual_tenure_months IS NULL OR qual_tenure_months BETWEEN 1 AND 480),
  qual_purpose_code           text,
  owner_user_id               text,
  owner_queue_id              text,
  priority                    text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  customer_id                 text,
  application_id              text,                             -- validated via ApplicationPort; no FK (ADR-4D-08)
  duplicate_flag              text NOT NULL DEFAULT 'NONE' CHECK (duplicate_flag IN ('NONE','POSSIBLE','EXACT','ATTRIBUTION_CONFLICT')),
  duplicate_candidate_ids     text[] NOT NULL DEFAULT '{}',
  last_duplicate_decision_id  text,
  last_routing_decision_id    text,
  contact_attempts            smallint NOT NULL DEFAULT 0 CHECK (contact_attempts >= 0),
  tags                        text[] NOT NULL DEFAULT '{}',
  next_follow_up_at           timestamptz,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)      REFERENCES branch (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_user_id)  REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_queue_id) REFERENCES work_queue (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)    REFERENCES customer (tenant_id, id),
  CONSTRAINT owner_present    CHECK (state IN ('CONVERTED','MERGED','ARCHIVED') OR owner_user_id IS NOT NULL OR owner_queue_id IS NOT NULL),  -- BR-DOM-003
  CONSTRAINT single_owner     CHECK (owner_user_id IS NULL OR owner_queue_id IS NULL),
  CONSTRAINT disq_reason      CHECK (state <> 'DISQUALIFIED' OR disqualification_reason IS NOT NULL),
  CONSTRAINT qualified_fields CHECK (state NOT IN ('QUALIFIED','CONVERTED') OR (qual_applicant_type IS NOT NULL AND qual_requested_amount IS NOT NULL)),
  CONSTRAINT converted_links  CHECK (state <> 'CONVERTED' OR (customer_id IS NOT NULL AND application_id IS NOT NULL))
);
CREATE INDEX lead_mobile_idx         ON lead (tenant_id, mobile_hash);
CREATE INDEX lead_email_idx          ON lead (tenant_id, email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX lead_owner_state_idx    ON lead (tenant_id, owner_user_id, state) WHERE state NOT IN ('CONVERTED','MERGED','ARCHIVED');
CREATE INDEX lead_queue_state_idx    ON lead (tenant_id, owner_queue_id, state) WHERE owner_queue_id IS NOT NULL;
CREATE INDEX lead_branch_created_idx ON lead (tenant_id, branch_id, created_at DESC, id DESC);
CREATE INDEX lead_created_idx        ON lead (tenant_id, created_at DESC, id DESC);

CREATE FUNCTION lead_attribution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN                                                               -- FR-LEAD-013
  IF (NEW.tenant_id, NEW.branch_id, NEW.source, NEW.sub_source, NEW.campaign, NEW.utm, NEW.connector_id, NEW.referred_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.branch_id, OLD.source, OLD.sub_source, OLD.campaign, OLD.utm, OLD.connector_id, OLD.referred_at) THEN
    RAISE EXCEPTION 'lead % attribution fields are immutable', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_attribution_guard BEFORE UPDATE ON lead FOR EACH ROW EXECUTE FUNCTION lead_attribution_immutable();
CREATE TRIGGER lead_touch             BEFORE UPDATE ON lead FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER customer_touch         BEFORE UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE lead_status_history (                               -- ENT-021
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  lead_id             text NOT NULL,
  from_state          text,
  to_state            text NOT NULL,
  transition_code     text NOT NULL CHECK (transition_code ~ '^(CREATE|T-LEAD-0[1-9])$'),
  reason_code         text,
  actor               text NOT NULL,
  activity_id         text,
  decision_record_id  text,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES lead (tenant_id, id)
);
CREATE INDEX lead_status_history_lead_idx ON lead_status_history (tenant_id, lead_id, occurred_at);

CREATE TABLE lead_assignment (                                   -- ENT-022
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  lead_id             text NOT NULL,
  from_user_id        text,
  from_queue_id       text,
  to_user_id          text,
  to_queue_id         text,
  reason_code         text NOT NULL CHECK (reason_code IN ('AUTO_ROUTING','ROUTING_FALLBACK','MANUAL','REBALANCE','OWNER_INACTIVE')),
  actor               text NOT NULL,
  decision_record_id  text,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((to_user_id IS NULL) <> (to_queue_id IS NULL)),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES lead (tenant_id, id)
);
CREATE INDEX lead_assignment_lead_idx ON lead_assignment (tenant_id, lead_id, assigned_at);

CREATE TABLE activity (                                          -- ENT-032 (not partitioned: ADR-4D-03)
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  subject_type     text NOT NULL CHECK (subject_type IN ('LEAD','CUSTOMER','LOAN_APPLICATION')),
  subject_id       text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('CALL','MEETING','VISIT','NOTE')),
  outcome_code     text CHECK (outcome_code IS NULL OR outcome_code IN ('CONNECTED','NO_ANSWER','BUSY','SWITCHED_OFF','WRONG_NUMBER','CALLBACK_REQUESTED','NOT_INTERESTED','OTHER')),
  occurred_at      timestamptz NOT NULL,
  duration_s       integer CHECK (duration_s IS NULL OR duration_s >= 0),
  note             text CHECK (note IS NULL OR char_length(note) <= 4000),
  actor_id         text NOT NULL,
  actor_branch_id  text NOT NULL,                                -- FR-ACT-005 attribution snapshot
  actor_team_id    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'CALL' OR outcome_code IS NOT NULL)
);
CREATE INDEX activity_subject_idx ON activity (tenant_id, subject_type, subject_id, occurred_at DESC);

CREATE TABLE data_sharing_record (                               -- ENT-100 (FR-PRV-007)
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  subject_type    text NOT NULL CHECK (subject_type IN ('LOAN_APPLICATION')),
  subject_id      text NOT NULL,
  recipient_type  text NOT NULL CHECK (recipient_type IN ('LENDER')),
  recipient_id    text NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('LENDER_SUBMISSION')),
  consent_ids     text[] NOT NULL CHECK (cardinality(consent_ids) > 0),
  items           jsonb NOT NULL CHECK (jsonb_typeof(items) = 'object'),   -- field names + checklist ids; never values
  channel         text NOT NULL CHECK (channel IN ('PORTAL','EMAIL','API','PHYSICAL')),
  source_ref      text NOT NULL,                                 -- pkg_…
  actor_id        text NOT NULL,
  shared_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX data_sharing_record_subject_idx ON data_sharing_record (tenant_id, subject_type, subject_id, shared_at DESC);

CREATE TRIGGER lead_status_history_append_only BEFORE UPDATE OR DELETE ON lead_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER lead_assignment_append_only     BEFORE UPDATE OR DELETE ON lead_assignment     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER activity_append_only            BEFORE UPDATE OR DELETE ON activity            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER data_sharing_record_append_only BEFORE UPDATE OR DELETE ON data_sharing_record FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('customer');            CALL enable_tenant_rls('customer_contact_point');
CALL enable_tenant_rls('consent_record');      CALL enable_tenant_rls('lead');
CALL enable_tenant_rls('lead_status_history'); CALL enable_tenant_rls('lead_assignment');
CALL enable_tenant_rls('activity');            CALL enable_tenant_rls('data_sharing_record');

GRANT SELECT, INSERT, UPDATE ON customer, lead, consent_record TO dsa_app;
GRANT SELECT, INSERT ON customer_contact_point, lead_status_history, lead_assignment, activity, data_sharing_record TO dsa_app;
