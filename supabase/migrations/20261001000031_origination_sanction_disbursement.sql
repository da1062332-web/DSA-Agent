-- Gate 0 baseline: MOD-SND Sanctions & Disbursement Tranches (Domain DOM-E, Origination Squad)
-- Entities: ENT-055 (sanction), ENT-056 (disbursement_tranche)
SET search_path = app, extensions, public;

CREATE TABLE sanction (                                          -- ENT-055
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  lender_case_id      text NOT NULL,
  version             integer NOT NULL CHECK (version >= 1),
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  tenure_months       integer NOT NULL CHECK (tenure_months >= 1),
  rate_value          numeric(7,4) NOT NULL CHECK (rate_value > 0),
  rate_type           text NOT NULL CHECK (rate_type IN ('FIXED','FLOATING')),
  benchmark_text      text,
  fees_text           text,
  conditions          text[] NOT NULL DEFAULT '{}',
  sanction_date       date NOT NULL,
  valid_until         date NOT NULL CHECK (valid_until >= sanction_date),
  letter_document_id  text,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVISED','EXPIRED','CANCELLED')),
  source              text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','LENDER_API','EMAIL_PARSED')),
  cancel_reason       text,
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (lender_case_id, version),
  FOREIGN KEY (tenant_id, lender_case_id) REFERENCES lender_case (tenant_id, id)
);

CREATE INDEX sanction_case_idx ON sanction (tenant_id, lender_case_id, version DESC);

CREATE TABLE disbursement_tranche (                             -- ENT-056
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenant(id),
  sanction_id             text NOT NULL,
  tranche_no              integer NOT NULL CHECK (tranche_no >= 1),
  amount                  numeric(18,2) NOT NULL CHECK (amount > 0),
  currency                char(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  disbursed_on            date NOT NULL,
  utr_ciphertext          text,
  utr_masked              text,
  loan_account_ciphertext text,
  loan_account_masked     text,
  evidence_document_id    text,
  status                  text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VERIFIED','RETURNED','VOIDED')),
  recorded_by             text NOT NULL,
  verified_by             text,
  verified_at             timestamptz,
  verification_comment    text,
  exception_approval_id   text,
  voided_by               text,
  void_reason             text,
  replaced_by_tranche_id  text,
  lock_version            integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (sanction_id, tranche_no),
  FOREIGN KEY (tenant_id, sanction_id) REFERENCES sanction (tenant_id, id),
  CHECK (status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_by <> recorded_by)),   -- SOD-04
  CHECK (status <> 'VOIDED' OR (voided_by IS NOT NULL AND void_reason IS NOT NULL))
);

CREATE INDEX disbursement_tranche_sanction_idx ON disbursement_tranche (tenant_id, sanction_id, tranche_no ASC);

CREATE TRIGGER sanction_touch             BEFORE UPDATE ON sanction             FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER disbursement_tranche_touch BEFORE UPDATE ON disbursement_tranche FOR EACH ROW EXECUTE FUNCTION touch_row();

CALL enable_tenant_rls('sanction');
CALL enable_tenant_rls('disbursement_tranche');

GRANT SELECT, INSERT, UPDATE ON sanction, disbursement_tranche TO dsa_app;

INSERT INTO permission (code, description, introduced_in) VALUES
 ('sanction.record','Record or revise sanctions','MOD-SND'),
 ('disbursement.record','Record disbursement tranches','MOD-SND'),
 ('disbursement.verify','Verify or return disbursement tranches','MOD-SND'),
 ('disbursement.exception_approve','Approve evidence exceptions for tranches','MOD-SND')
ON CONFLICT (code) DO NOTHING;
