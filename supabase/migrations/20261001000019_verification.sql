-- Migration: 20261001000019_verification.sql (owner: Dev 2, Module 19: Verification)
SET search_path = app, extensions, public;

CREATE TABLE verification_request (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  application_id      text NOT NULL REFERENCES loan_application(id),
  party_id            text REFERENCES application_party(id),
  customer_id         text REFERENCES customer(id),
  verification_type   text NOT NULL CHECK (verification_type IN (
                        'DOCUMENT_REVIEW',
                        'IDENTITY_KYC',
                        'RESIDENCE_FI',
                        'OFFICE_FI',
                        'EMPLOYMENT',
                        'BANK_STATEMENT'
                      )),
  status              text NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
                        'INITIATED',
                        'ASSIGNED',
                        'IN_PROGRESS',
                        'VERIFIED',
                        'REJECTED',
                        'WAIVED',
                        'CANCELLED'
                      )),
  outcome             text CHECK (outcome IS NULL OR outcome IN (
                        'POSITIVE',
                        'NEGATIVE',
                        'REFER_TO_CREDIT',
                        'WAIVED'
                      )),
  assigned_to_user_id text REFERENCES app_user(id),
  assigned_to_queue_id text REFERENCES work_queue(id),
  branch_id           text NOT NULL REFERENCES branch(id),
  priority            text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  scheduled_at        timestamptz,
  completed_at        timestamptz,
  verified_by         text REFERENCES app_user(id),
  findings_summary    text CHECK (findings_summary IS NULL OR char_length(findings_summary) <= 2000),
  rejection_reason    text CHECK (rejection_reason IS NULL OR rejection_reason IN (
                        'ADDRESS_NOT_FOUND',
                        'APPLICANT_UNKNOWN',
                        'DOCUMENT_FORGED',
                        'SALARY_MISMATCH',
                        'BUSINESS_CLOSED',
                        'UNCOOPERATIVE',
                        'INCOMPLETE_DETAILS',
                        'OTHER'
                      )),
  checklist_item_ids  text[] NOT NULL DEFAULT '{}',
  lock_version        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'VERIFIED' OR (completed_at IS NOT NULL AND verified_by IS NOT NULL AND outcome IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE INDEX verification_app_idx ON verification_request (tenant_id, application_id, status);
CREATE INDEX verification_assignee_idx ON verification_request (tenant_id, assigned_to_user_id, status);
CREATE INDEX verification_branch_idx ON verification_request (tenant_id, branch_id, status);

CREATE TRIGGER verification_request_touch BEFORE UPDATE ON verification_request FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('verification_request');
GRANT SELECT, INSERT, UPDATE ON verification_request TO dsa_app;

-- Seed permission codes for Module 19
INSERT INTO permission (code, description, introduced_in) VALUES
  ('verification.read', 'Read verification requests and reports', 'MVP-4D'),
  ('verification.create', 'Initiate verification requests', 'MVP-4D'),
  ('verification.update', 'Assign verifiers and update verification progress', 'MVP-4D'),
  ('verification.complete', 'Complete and attest verification decisions', 'MVP-4D')
ON CONFLICT (code) DO NOTHING;
