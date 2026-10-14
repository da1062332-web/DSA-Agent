-- Migration: 20261001000040_lender_contacts_and_commission_payouts.sql
-- Module 28 (Lender Management), Module 29 (Products), Module 30 (Commission and Payouts)
SET search_path = app, extensions, public;

-- Additional columns on existing catalogue tables
ALTER TABLE empanelment ADD COLUMN IF NOT EXISTS permitted_geos jsonb;
ALTER TABLE empanelment ADD COLUMN IF NOT EXISTS agreement_document_id text;

ALTER TABLE loan_product_version ADD COLUMN IF NOT EXISTS document_profile_id text;
ALTER TABLE loan_product_version ADD COLUMN IF NOT EXISTS fee_text text;
ALTER TABLE loan_product_version ADD COLUMN IF NOT EXISTS geo_rules jsonb;
ALTER TABLE loan_product_version ADD COLUMN IF NOT EXISTS workflow_profile jsonb;

CREATE TABLE IF NOT EXISTS lender_contact (                      -- ENT-042
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  lender_id         text NOT NULL,
  name              text NOT NULL,
  role              text NOT NULL,
  email             text,
  phone             text,
  channel           text NOT NULL DEFAULT 'EMAIL',
  escalation_level  integer NOT NULL DEFAULT 1,
  lock_version      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS commission_plan (                     -- ENT-076
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  lender_id            text NOT NULL,
  qualifying_event     text NOT NULL DEFAULT 'DISBURSEMENT' CHECK (qualifying_event IN ('SANCTION','DISBURSEMENT','FIRST_EMI')),
  basis                text NOT NULL DEFAULT 'DISBURSED_AMOUNT' CHECK (basis IN ('SANCTION_AMOUNT','DISBURSED_AMOUNT','NET_LOAN')),
  rounding_mode        text NOT NULL DEFAULT 'ROUND_HALF_UP',
  clawback_window_days integer NOT NULL DEFAULT 90,
  rule_set_id          text,
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','RETIRED')),
  lock_version         integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_lender_plan ON commission_plan (tenant_id, lender_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS commission_calculation (              -- ENT-077
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  lender_id            text NOT NULL,
  tranche_id           text NOT NULL,
  application_id       text,
  lender_case_id       text,
  event_date           date NOT NULL,
  basis_amount         numeric(18,2) NOT NULL,
  rate                 numeric(12,8) NOT NULL,
  rate_type            text NOT NULL DEFAULT 'PERCENTAGE' CHECK (rate_type IN ('PERCENTAGE','FLAT')),
  cap                  numeric(18,2),
  gross_amount         numeric(18,2) NOT NULL,
  currency             char(3) NOT NULL DEFAULT 'INR',
  calc_kind            text NOT NULL DEFAULT 'EARNED' CHECK (calc_kind IN ('PROJECTED','EARNED')),
  rule_set_version_id  text,
  decision_record_id   text,
  inputs_hash          text,
  status               text NOT NULL DEFAULT 'EARNED' CHECK (status IN ('PROJECTED','EARNED','ACCRUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','DISPUTED','REVERSED','SUPERSEDED')),
  supersedes_id        text,
  lock_version         integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_earned_tranche ON commission_calculation (tenant_id, tranche_id) WHERE calc_kind = 'EARNED';

CREATE TABLE IF NOT EXISTS commission_payable (                  -- ENT-078
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  calculation_id       text NOT NULL,
  connector_id         text NOT NULL,
  share_rate           numeric(12,8) NOT NULL,
  amount               numeric(18,2) NOT NULL,
  currency             char(3) NOT NULL DEFAULT 'INR',
  state                text NOT NULL DEFAULT 'ELIGIBLE' CHECK (state IN ('ACCRUED','ON_HOLD','ELIGIBLE','IN_PAYOUT','APPROVED','PAID','REVERSED')),
  hold_reasons         jsonb,
  eligibility_decision_id text,
  lock_version         integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, calculation_id) REFERENCES commission_calculation (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payout_request (                      -- ENT-082
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  connector_id           text NOT NULL,
  origin                 text NOT NULL DEFAULT 'FINANCE' CHECK (origin IN ('CONNECTOR','FINANCE')),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED','PAYMENT_RECORDED','PAYMENT_FAILED','RECONCILED')),
  total                  numeric(18,2) NOT NULL DEFAULT 0.00,
  currency               char(3) NOT NULL DEFAULT 'INR',
  payment_ref_ciphertext text,
  payment_ref_masked     text,
  paid_on                timestamptz,
  failure_reason         text,
  retry_of_payout_id     text,
  submitted_by           text,
  submitted_at           timestamptz,
  lock_version           integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payout_line (                         -- ENT-083
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  payout_id     text NOT NULL,
  payable_id    text NOT NULL,
  amount        numeric(18,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  status        text NOT NULL DEFAULT 'INCLUDED' CHECK (status IN ('INCLUDED','REMOVED','PAYMENT_RECORDED','PAYMENT_FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payout_id) REFERENCES payout_request (tenant_id, id),
  FOREIGN KEY (tenant_id, payable_id) REFERENCES commission_payable (tenant_id, id)
);
-- BR-DOM-025: A payable can belong to at most one live payout line
CREATE UNIQUE INDEX IF NOT EXISTS payout_line_once ON payout_line (tenant_id, payable_id) WHERE status NOT IN ('REMOVED', 'PAYMENT_FAILED');

CREATE TABLE IF NOT EXISTS payout_approval (                     -- ENT-084
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  payout_id     text NOT NULL,
  approver_id   text NOT NULL,
  seat          text NOT NULL DEFAULT 'COMMISSION_APPROVER',
  decision      text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  comment       text,
  approved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payout_id) REFERENCES payout_request (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payout_batch (                        -- ENT-085
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  payout_ids       text[] NOT NULL,
  file_object_key  text,
  file_sha256      text,
  status           text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','DOWNLOADED','PROCESSED')),
  generated_by     text NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS adjustment (                          -- ENT-090
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('CLAWBACK','CORRECTION','MANUAL')),
  calculation_id  text REFERENCES commission_calculation(id),
  payable_id      text REFERENCES commission_payable(id),
  amount          numeric(18,2) NOT NULL,
  reason          text NOT NULL,
  evidence_ref    text,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  approved_at timestamptz,
  approved_by text,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS recalculation_proposal (              -- ENT-093
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenant(id),
  reason                   text NOT NULL,
  affected_calculation_ids text[] NOT NULL CHECK (cardinality(affected_calculation_ids) > 0),
  preview                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                   text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by              text,
  approved_at              timestamptz,
  lock_version             integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id)
);

ALTER TABLE lender_contact ADD COLUMN IF NOT EXISTS lock_version integer NOT NULL DEFAULT 0;
ALTER TABLE lender_contact ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE lender_contact ADD COLUMN IF NOT EXISTS updated_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lender_contact_touch') THEN
    CREATE TRIGGER lender_contact_touch BEFORE UPDATE ON lender_contact FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commission_plan_touch') THEN
    CREATE TRIGGER commission_plan_touch BEFORE UPDATE ON commission_plan FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commission_calculation_touch') THEN
    CREATE TRIGGER commission_calculation_touch BEFORE UPDATE ON commission_calculation FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commission_payable_touch') THEN
    CREATE TRIGGER commission_payable_touch BEFORE UPDATE ON commission_payable FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payout_request_touch') THEN
    CREATE TRIGGER payout_request_touch BEFORE UPDATE ON payout_request FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'recalculation_proposal_touch') THEN
    CREATE TRIGGER recalculation_proposal_touch BEFORE UPDATE ON recalculation_proposal FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'lender_contact',
    'commission_plan',
    'commission_calculation',
    'commission_payable',
    'payout_request',
    'payout_line',
    'payout_approval',
    'payout_batch',
    'adjustment',
    'recalculation_proposal'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polrelid = tbl::regclass AND polname = 'tenant_isolation'
    ) THEN
      EXECUTE format('CALL enable_tenant_rls(%L)', tbl);
    END IF;
  END LOOP;
END $$;

-- Ensure reproducible RLS on upload_link if present (prevent schema drift on existing DB)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relname = 'upload_link') THEN
    ALTER TABLE app.upload_link ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.upload_link FORCE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'tenant_isolation' AND polrelid = 'app.upload_link'::regclass) THEN
      CALL enable_tenant_rls('app.upload_link');
    END IF;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON lender_contact, commission_plan, commission_calculation, commission_payable, payout_request, payout_line, payout_approval, payout_batch, adjustment, recalculation_proposal TO dsa_app;
