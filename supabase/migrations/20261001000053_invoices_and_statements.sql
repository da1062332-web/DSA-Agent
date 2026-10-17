-- 20261001000047_invoices_and_statements.sql
-- Module 33: Invoices (MOD-INV, DOM-K)
-- Tables: invoice (ENT-092), ledger_entry (ENT-081)

SET search_path = app, extensions, public;

-- 1. ENT-092: Invoices (Invoices raised to lenders or received from connectors)
CREATE TABLE IF NOT EXISTS invoice (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  direction       text NOT NULL CHECK (direction IN ('TO_LENDER', 'FROM_CONNECTOR')),
  number          text NOT NULL,
  date            date NOT NULL,
  due_date        date,
  amount          numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL DEFAULT 'INR',
  tax_fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
  calculation_ids text[] NOT NULL DEFAULT '{}',
  party_id        text NOT NULL,
  party_name      text,
  notes           text,
  lock_version    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direction, number)
);

CREATE INDEX IF NOT EXISTS invoice_tenant_direction_status_idx ON invoice (tenant_id, direction, status);
CREATE INDEX IF NOT EXISTS invoice_tenant_party_date_idx ON invoice (tenant_id, party_id, date);

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'invoice' AND policyname = 'invoice_tenant_isolation'
  ) THEN
    CREATE POLICY invoice_tenant_isolation ON invoice
      FOR ALL
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON invoice TO dsa_app;

-- 2. ENT-081: Connector Statement Entries for Connector Account Statements
CREATE TABLE IF NOT EXISTS connector_statement_entry (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  connector_id  text NOT NULL,
  entry_type    text NOT NULL CHECK (entry_type IN ('COMMISSION_EARNED', 'PAYOUT_DISBURSED', 'ADJUSTMENT', 'TAX_DEDUCTION', 'OPENING_BALANCE')),
  amount        numeric(18,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  reference_id  text,
  description   text,
  entry_date    date NOT NULL DEFAULT CURRENT_DATE,
  balance_after numeric(18,2) NOT NULL DEFAULT 0.00,
  lock_version  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS connector_statement_entry_tenant_conn_date_idx ON connector_statement_entry (tenant_id, connector_id, entry_date);

ALTER TABLE connector_statement_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_statement_entry FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'connector_statement_entry' AND policyname = 'connector_statement_entry_tenant_isolation'
  ) THEN
    CREATE POLICY connector_statement_entry_tenant_isolation ON connector_statement_entry
      FOR ALL
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON connector_statement_entry TO dsa_app;

-- 3. Seed Permissions & Role Grants
INSERT INTO permission (code, description, introduced_in)
VALUES ('invoice.manage', 'Record, issue, pay, and void invoices', 'MOD-INV')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'invoice.manage'
FROM role r
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-FINANCE-EXEC', 'ROLE-SUPER-ADMIN')
ON CONFLICT DO NOTHING;
