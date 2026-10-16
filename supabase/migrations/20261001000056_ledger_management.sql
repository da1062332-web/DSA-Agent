-- supabase/migrations/20261001000056_ledger_management.sql
-- Module: MOD-LED (TASK-418 Ledger Management)
-- Author: Dev 5 (Bhushan) / Finance Squad
-- Entities: ledger_account (ENT-079), ledger_journal (ENT-080), ledger_entry (ENT-081), ledger_period

SET search_path = app, extensions, public;

-- 1. Permissions Seed
INSERT INTO permission (code, description, introduced_in)
VALUES
  ('finance.period_close', 'Close ledger accounting periods under maker-checker controls', 'TASK-418')
ON CONFLICT (code) DO NOTHING;

-- 2. Role Permissions Grants
-- Grant finance.period_close to ROLE-COMMISSION-APPROVER and ROLE-ORG-OWNER
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'finance.period_close'
FROM role r
WHERE r.code IN ('ROLE-COMMISSION-APPROVER', 'ROLE-ORG-OWNER')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Grant finance.view to core finance roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'finance.view'
FROM role r
WHERE r.code IN ('ROLE-FINANCE-EXEC', 'ROLE-COMMISSION-APPROVER', 'ROLE-ORG-OWNER', 'ROLE-TENANT-ADMIN')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Grant export.run to finance and admin roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'export.run'
FROM role r
WHERE r.code IN ('ROLE-FINANCE-EXEC', 'ROLE-COMMISSION-APPROVER', 'ROLE-ORG-OWNER', 'ROLE-TENANT-ADMIN')
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- 3. ENT-079: ledger_account
CREATE TABLE IF NOT EXISTS ledger_account (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  code              text NOT NULL,
  name              text NOT NULL,
  type              text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'SUSPENSE', 'TAX_PAYABLE', 'TAX_RECEIVABLE')),
  counterparty_type text CHECK (counterparty_type IN ('CONNECTOR', 'LENDER', 'BANK', 'BORROWER', 'INTERNAL')),
  counterparty_id   text,
  currency          text NOT NULL DEFAULT 'INR',
  is_active         boolean NOT NULL DEFAULT true,
  lock_version      integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  CONSTRAINT chk_tax_accounts_inactive CHECK (type NOT IN ('TAX_PAYABLE', 'TAX_RECEIVABLE') OR is_active = false)
);

CREATE INDEX IF NOT EXISTS idx_ledger_account_type ON ledger_account (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_ledger_account_counterparty ON ledger_account (tenant_id, counterparty_type, counterparty_id);

-- 4. ENT-080: ledger_journal
CREATE TABLE IF NOT EXISTS ledger_journal (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  journal_number         text NOT NULL,
  reference_type         text NOT NULL CHECK (reference_type IN ('PAYOUT_RECORDING', 'ADJUSTMENT', 'COMMISSION_ACCRUAL', 'PERIOD_CLOSE', 'MANUAL')),
  reference_id           text NOT NULL,
  idempotency_key        text,
  period                 text NOT NULL,
  status                 text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED', 'CLOSED')),
  reversal_of_journal_id text REFERENCES ledger_journal(id),
  posted_at              timestamptz NOT NULL DEFAULT now(),
  posted_by              text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, journal_number),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_journal_period ON ledger_journal (tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_ledger_journal_ref ON ledger_journal (tenant_id, reference_type, reference_id);

-- 5. ENT-081: ledger_entry
CREATE TABLE IF NOT EXISTS ledger_entry (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  journal_id   text NOT NULL,
  account_id   text NOT NULL,
  entry_type   text NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  currency     text NOT NULL DEFAULT 'INR',
  narration    text,
  line_number  integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_ledger_entry_journal FOREIGN KEY (tenant_id, journal_id) REFERENCES ledger_journal(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ledger_entry_account FOREIGN KEY (tenant_id, account_id) REFERENCES ledger_account(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ledger_entry_journal ON ledger_entry (tenant_id, journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_account ON ledger_entry (tenant_id, account_id, created_at);

-- 6. Period tracking
CREATE TABLE IF NOT EXISTS ledger_period (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  period       text NOT NULL,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at    timestamptz,
  closed_by    text,
  closing_note text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period)
);

-- 7. Deferred Constraint Trigger: Double-Entry Balancing
CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit NUMERIC(18,2);
  v_credit NUMERIC(18,2);
  v_balance NUMERIC(18,2);
BEGIN
  SELECT 
    COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END), 0)
  INTO v_debit, v_credit
  FROM app.ledger_entry
  WHERE journal_id = NEW.journal_id AND tenant_id = NEW.tenant_id;

  v_balance := v_debit - v_credit;
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: Journal % entries must balance. Total Debit: %, Total Credit: %, Variance: %', 
      NEW.journal_id, v_debit, v_credit, v_balance USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_entry_balanced ON ledger_entry;
CREATE CONSTRAINT TRIGGER trg_ledger_entry_balanced
  AFTER INSERT OR UPDATE ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_balance();

-- 8. Immutability Triggers
CREATE TRIGGER ledger_entry_no_update
  BEFORE UPDATE ON ledger_entry
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER ledger_entry_no_delete
  BEFORE DELETE ON ledger_entry
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER ledger_journal_no_delete
  BEFORE DELETE ON ledger_journal
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION ledger_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.journal_number IS DISTINCT FROM OLD.journal_number OR
     NEW.reference_type IS DISTINCT FROM OLD.reference_type OR
     NEW.reference_id IS DISTINCT FROM OLD.reference_id OR
     NEW.period IS DISTINCT FROM OLD.period OR
     NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
     NEW.posted_by IS DISTINCT FROM OLD.posted_by THEN
    RAISE EXCEPTION 'ledger_journal % is immutable; key posting fields cannot be altered', OLD.journal_number USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_journal_immutability
  BEFORE UPDATE ON ledger_journal
  FOR EACH ROW
  EXECUTE FUNCTION ledger_journal_guard();

-- 9. Seed Default Accounts for Existing Tenants
INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_bank_' || t.id, t.id, '1010-SETTLEMENT-BANK', 'Settlement Bank Account', 'ASSET', true, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_pay_' || t.id, t.id, '2100-COMMISSION-PAYABLE', 'Commission Payable', 'LIABILITY', true, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_inc_' || t.id, t.id, '4100-COMMISSION-INCOME', 'Commission Income', 'INCOME', true, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_exp_' || t.id, t.id, '5100-COMMISSION-EXPENSE', 'Commission Expense', 'EXPENSE', true, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_susp_' || t.id, t.id, '9999-SUSPENSE', 'Suspense Clearing Account', 'SUSPENSE', true, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_tax_pay_' || t.id, t.id, '2200-TAX-PAYABLE', 'Tax Payable (GST/TDS)', 'TAX_PAYABLE', false, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO ledger_account (id, tenant_id, code, name, type, is_active, created_at, updated_at)
SELECT 
  'acc_tax_rec_' || t.id, t.id, '1200-TAX-RECEIVABLE', 'Tax Receivable (TDS Credit)', 'TAX_RECEIVABLE', false, now(), now()
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 10. Enable Tenant RLS
CALL enable_tenant_rls('ledger_account');
CALL enable_tenant_rls('ledger_journal');
CALL enable_tenant_rls('ledger_entry');
CALL enable_tenant_rls('ledger_period');

-- 11. Grant dsa_app Privileges
GRANT SELECT, INSERT, UPDATE ON ledger_account, ledger_period TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON ledger_journal TO dsa_app;
GRANT SELECT, INSERT ON ledger_entry TO dsa_app;
