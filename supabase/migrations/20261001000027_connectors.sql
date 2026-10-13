-- 20261001000027_connectors.sql
-- Module 27: Connector Management (MOD-CON, TASK-417)
-- Covers: SUB-CON.01 (Onboarding & Bank Accounts), SUB-CON.02 (Agreements),
--         SUB-CON.03 (Attribution), SUB-CON.04 (Disputes), SUB-CON.05 (Lifecycle)
SET search_path = app, extensions, public;

-- 1. Register permission codes in platform registry
INSERT INTO permission (code, description, introduced_in) VALUES
  ('connector.manage', 'Manage connectors, bank accounts, agreements, and lifecycle', 'TASK-417'),
  ('connector.read', 'Read connector directory, bank accounts, agreements, and disputes', 'TASK-417'),
  ('connector.bank_change_approve', 'Approve connector bank account changes under SOD', 'TASK-417'),
  ('connector.attribution_change', 'Request and approve lead reattribution under SOD-09', 'TASK-417'),
  ('connector.dispute_resolve', 'Adjudicate and resolve attribution disputes', 'TASK-417')
ON CONFLICT (code) DO NOTHING;

-- Grant to default platform roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.code
FROM app.role r
CROSS JOIN (
  VALUES 
    ('connector.manage'),
    ('connector.read'),
    ('connector.attribution_change'),
    ('connector.dispute_resolve')
) AS p(code)
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-LOAN-OPS')
ON CONFLICT DO NOTHING;

-- Grant bank account approval to finance / org owner
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'connector.bank_change_approve'
FROM app.role r
WHERE r.code IN ('ROLE-ORG-OWNER', 'ROLE-FINANCE-APPROVER')
ON CONFLICT DO NOTHING;

-- 2. Modify app.lead constraint to permit connector_id
ALTER TABLE app.lead DROP CONSTRAINT IF EXISTS lead_connector_id_check;

-- 3. Modify app.app_user user_type to permit CONNECTOR
ALTER TABLE app.app_user DROP CONSTRAINT IF EXISTS app_user_user_type_check;
ALTER TABLE app.app_user ADD CONSTRAINT app_user_user_type_check 
  CHECK (user_type IN ('STAFF', 'CONNECTOR'));

-- 4. Create ENT-071: Connector Entity
CREATE TABLE IF NOT EXISTS app.connector (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES app.tenant(id),
  connector_type              text NOT NULL CHECK (connector_type IN ('INDIVIDUAL','PROPRIETORSHIP','PARTNERSHIP','PVT_LTD','PUBLIC_LTD','LLP')),
  legal_name                  text NOT NULL,
  contact_person              text NOT NULL,
  mobile_e164                 text NOT NULL,
  mobile_hash                 bytea NOT NULL,
  email                       text NOT NULL,
  email_hash                  bytea NOT NULL,
  encrypted_pan               bytea NOT NULL,
  pan_hash                    bytea NOT NULL,
  pan_masked                  text NOT NULL,
  gstin                       text,
  primary_branch_id           text NOT NULL,
  relationship_owner_user_id  text NOT NULL,
  status                      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_VERIFICATION','ACTIVE','SUSPENDED','TERMINATED')),
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pan_hash),
  FOREIGN KEY (tenant_id, primary_branch_id) REFERENCES app.branch (tenant_id, id),
  FOREIGN KEY (tenant_id, relationship_owner_user_id) REFERENCES app.app_user (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS connector_branch_idx ON app.connector (tenant_id, primary_branch_id, status);
CREATE INDEX IF NOT EXISTS connector_mobile_idx ON app.connector (tenant_id, mobile_hash);
CREATE INDEX IF NOT EXISTS connector_cursor_idx ON app.connector (tenant_id, created_at DESC, id DESC);

-- Enable RLS & Touch Row Trigger for connector
CALL enable_tenant_rls('connector');
CREATE TRIGGER connector_touch BEFORE UPDATE ON app.connector FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Add foreign key constraint to lead table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_connector_fk'
  ) THEN
    ALTER TABLE app.lead 
      ADD CONSTRAINT lead_connector_fk 
      FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id);
  END IF;
END $$;

-- Add connector_id link to app.app_user
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'app' AND table_name = 'app_user' AND column_name = 'connector_id'
  ) THEN
    ALTER TABLE app.app_user ADD COLUMN connector_id text;
    ALTER TABLE app.app_user 
      ADD CONSTRAINT app_user_connector_fk 
      FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id);
  END IF;
END $$;

-- 5. Create ENT-073: Connector Bank Account
CREATE TABLE IF NOT EXISTS app.connector_bank_account (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES app.tenant(id),
  connector_id                text NOT NULL,
  account_holder_name         text NOT NULL,
  encrypted_account_number    bytea NOT NULL,
  account_hash                bytea NOT NULL,
  account_masked              text NOT NULL,
  ifsc_code                   text NOT NULL,
  verification_id             text REFERENCES app.verification (id),
  status                      text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','ACTIVE','REJECTED','DISABLED')),
  cooling_until               timestamptz,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  approved_at                 timestamptz,
  approved_by                 text,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id),
  CONSTRAINT bank_account_sod_check CHECK (
    status <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_by <> created_by)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_bank_account_active_uq 
  ON app.connector_bank_account (tenant_id, connector_id) 
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS connector_bank_account_conn_idx 
  ON app.connector_bank_account (tenant_id, connector_id, created_at DESC);

CALL enable_tenant_rls('connector_bank_account');
CREATE TRIGGER connector_bank_account_touch BEFORE UPDATE ON app.connector_bank_account FOR EACH ROW EXECUTE FUNCTION touch_row();

-- 6. Create ENT-072: Connector Agreement
CREATE TABLE IF NOT EXISTS app.connector_agreement (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES app.tenant(id),
  connector_id                text NOT NULL,
  version                     integer NOT NULL DEFAULT 1,
  valid_from                  timestamptz NOT NULL,
  valid_to                    timestamptz NOT NULL,
  permitted_products          text[] NOT NULL,
  share_rule_scope            text NOT NULL,
  evidence_ref                text NOT NULL,
  status                      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id),
  CHECK (valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS connector_agreement_conn_idx 
  ON app.connector_agreement (tenant_id, connector_id, valid_from DESC);

CALL enable_tenant_rls('connector_agreement');
CREATE TRIGGER connector_agreement_touch BEFORE UPDATE ON app.connector_agreement FOR EACH ROW EXECUTE FUNCTION touch_row();

-- 7. Create ENT-075: Attribution Change Request
CREATE TABLE IF NOT EXISTS app.attribution_change_request (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES app.tenant(id),
  lead_id                     text NOT NULL,
  previous_connector_id       text,
  proposed_connector_id       text NOT NULL,
  reason                      text NOT NULL,
  evidence_ref                text NOT NULL,
  recalculation_proposal      text,
  status                      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requester_id                text NOT NULL,
  approver_id                 text,
  approved_at                 timestamptz,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES app.lead (tenant_id, id),
  FOREIGN KEY (tenant_id, proposed_connector_id) REFERENCES app.connector (tenant_id, id),
  FOREIGN KEY (tenant_id, requester_id) REFERENCES app.app_user (tenant_id, id),
  CONSTRAINT attribution_sod_check CHECK (
    status <> 'APPROVED' OR (approver_id IS NOT NULL AND approver_id <> requester_id)
  )
);

CREATE INDEX IF NOT EXISTS attribution_req_lead_idx 
  ON app.attribution_change_request (tenant_id, lead_id, status);

CALL enable_tenant_rls('attribution_change_request');
CREATE TRIGGER attribution_change_request_touch BEFORE UPDATE ON app.attribution_change_request FOR EACH ROW EXECUTE FUNCTION touch_row();

-- 8. Create ENT-074: Attribution Dispute
CREATE TABLE IF NOT EXISTS app.attribution_dispute (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES app.tenant(id),
  lead_id                     text NOT NULL,
  claimant_connector_ids      text[] NOT NULL,
  resolved_connector_id       text,
  resolution                  text CHECK (resolution IS NULL OR resolution IN ('ATTRIBUTED_TO_FIRST','ATTRIBUTED_TO_CLAIMANT','SPLIT_COMMISSION','DISMISSED_ORGANIC')),
  status                      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED')),
  resolver_user_id            text,
  resolution_notes            text,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES app.lead (tenant_id, id),
  FOREIGN KEY (tenant_id, resolved_connector_id) REFERENCES app.connector (tenant_id, id),
  FOREIGN KEY (tenant_id, resolver_user_id) REFERENCES app.app_user (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS attribution_dispute_lead_idx 
  ON app.attribution_dispute (tenant_id, lead_id, status);

CALL enable_tenant_rls('attribution_dispute');
CREATE TRIGGER attribution_dispute_touch BEFORE UPDATE ON app.attribution_dispute FOR EACH ROW EXECUTE FUNCTION touch_row();

-- 9. Update lead_attribution_immutable to allow controlled override
CREATE OR REPLACE FUNCTION app.lead_attribution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Controlled override for authorized reattribution
  IF current_setting('app.allow_attribution_override', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF (NEW.tenant_id, NEW.branch_id, NEW.source, NEW.sub_source, NEW.campaign, NEW.utm, NEW.connector_id, NEW.referred_at)
     IS DISTINCT FROM (OLD.tenant_id, OLD.branch_id, OLD.source, OLD.sub_source, OLD.campaign, OLD.utm, OLD.connector_id, OLD.referred_at) THEN
    RAISE EXCEPTION 'lead % attribution fields are immutable', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 10. Security Definer procedure to apply attribution changes atomically
CREATE OR REPLACE FUNCTION app.apply_attribution_change(
  p_tenant_id text,
  p_change_request_id text,
  p_approver_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT * INTO v_req FROM app.attribution_change_request
  WHERE tenant_id = p_tenant_id AND id = p_change_request_id AND status = 'PENDING'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request % not found or not pending', p_change_request_id;
  END IF;

  IF v_req.requester_id = p_approver_id THEN
    RAISE EXCEPTION 'SOD-09: Requester cannot approve their own attribution change';
  END IF;

  -- Allow override within this transaction block
  PERFORM set_config('app.allow_attribution_override', 'on', true);

  -- Update lead attribution
  UPDATE app.lead
  SET connector_id = v_req.proposed_connector_id,
      updated_at = now(),
      updated_by = p_approver_id,
      lock_version = lock_version + 1
  WHERE tenant_id = p_tenant_id AND id = v_req.lead_id;

  -- Mark change request approved
  UPDATE app.attribution_change_request
  SET status = 'APPROVED',
      approver_id = p_approver_id,
      approved_at = now(),
      updated_at = now(),
      updated_by = p_approver_id,
      lock_version = lock_version + 1
  WHERE tenant_id = p_tenant_id AND id = p_change_request_id;

  PERFORM set_config('app.allow_attribution_override', 'off', true);
END $$;

-- 11. Role grants for application database user
GRANT SELECT, INSERT, UPDATE ON app.connector TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.connector_bank_account TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.connector_agreement TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.attribution_change_request TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON app.attribution_dispute TO dsa_app;
GRANT EXECUTE ON FUNCTION app.apply_attribution_change(text, text, text) TO dsa_app;
