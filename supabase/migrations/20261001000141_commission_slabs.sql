-- Migration 0141 (owner: Devyani, task P2-01 of the multi-lender plan): commission volume slabs, plan tax treatment and
-- a GST-compliant invoice number series.
-- Why: FinanceService.calculateCommission used a hard-coded 1.5% (input.customRate ?? 0.015) with no slab lookup, so no
-- lender's real payout grid could be represented. Lenders pay on monthly volume bands per product category. Four tables or
-- columns are added and one grant is asserted; no existing column is altered and no row is rewritten.
--
--   commission_plan_slab    the payout grid: one row per product category and monthly volume band, with either a rate in
--                           basis points or a flat amount (exactly one of the two), effective-dated.
--   commission_calculation  gains slab_id and product_category, so every calculation records which band produced its
--                           rate and which product it was for. Monthly volume is measured per product category, because
--                           a lender's payout grid bands each product separately ("personal loan, first 50 lakhs");
--                           without the column the band could only be computed lender-wide across every product. Both
--                           are nullable: the one calculation already on hosted predates slabs and is left untouched.
--   commission_plan         gains tax_treatment, gst_rate_bps and tds_rate_bps. Tax treatment is data, not a constant,
--                           because whether GST goes on a commission invoice at all depends on the DSA's constitution:
--                           Notification 13/2017-Central Tax (Rate) Sl. No. 11 puts services supplied by an *individual*
--                           DSA (not a body corporate, partnership or LLP) to a bank or NBFC under reverse charge, so the
--                           lender pays and the DSA's invoice carries no GST. A company, partnership or LLP DSA charges
--                           18% under forward charge. The default here is FORWARD_CHARGE at 1800 bps; the project owner
--                           and compliance confirm the treatment per tenant (plan sections 11 and 12.6).
--   invoice_number_series   per-tenant, per-series, per-financial-year counter for invoice numbers. CGST Rule 46(b) wants
--                           "a consecutive serial number not exceeding sixteen characters ... unique for a financial
--                           year", so numbers look like CI/26-27/000123 and the counter is allocated inside the
--                           transaction that finalises the invoice. invoice.number itself gets no CHECK: invoices already
--                           recorded by hand carry free-form numbers and must stay readable.
--   invoice                 gains period_month, so regenerating a lender's monthly invoice updates one row instead of
--                           creating a second. A partial unique index enforces one live commission invoice per lender per
--                           month; corrections are credit or debit notes (P2-02), not a second monthly invoice.
--
-- TDS is never written here as a deduction. The lender deducts it; the invoice shows it as a memo only. The rate is 2%
-- with a 20,000 threshold per payee per tax year, now section 393(1) Table Sl. 1(ii) of the Income-tax Act 2025 (in force
-- 1 April 2026), which replaced section 194H of the 1961 Act. The spec names 194H; both refer to the same deduction.
--
-- Every new table carries tenant_id, row level security (app_tenant()) and lock_version for If-Match.
-- Not applied to hosted. Idempotent: re-running it leaves the same definitions.

SET search_path = app, extensions, public;

-- 1. The payout grid ---------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS commission_plan_slab (                -- ENT-076 extension (P2-01)
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  plan_id           text NOT NULL,
  product_category  text NOT NULL CHECK (product_category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER')),
  -- Monthly disbursed volume band, in the plan's currency. volume_from is inclusive, volume_to exclusive and NULL on the
  -- open-ended top band, so bands tile the number line without overlapping at a boundary.
  volume_from       numeric(18,2) NOT NULL DEFAULT 0 CHECK (volume_from >= 0),
  volume_to         numeric(18,2) CHECK (volume_to IS NULL OR volume_to > volume_from),
  -- Exactly one of the two: a percentage in basis points (100 bps = 1.00%) or a flat amount per qualifying event.
  rate_bps          integer CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 100000)),
  flat_amount       numeric(18,2) CHECK (flat_amount IS NULL OR flat_amount >= 0),
  CONSTRAINT commission_plan_slab_one_rate CHECK ((rate_bps IS NULL) <> (flat_amount IS NULL)),
  effective_from    date NOT NULL,
  effective_to      date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  lock_version      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES commission_plan (tenant_id, id)
);

-- The lookup is always plan + category + date, then the band is chosen in code by volume.
CREATE INDEX IF NOT EXISTS commission_plan_slab_lookup_idx
  ON commission_plan_slab (tenant_id, plan_id, product_category, effective_from);

-- 2. Which band produced a calculation ---------------------------------------------------------------------------------

ALTER TABLE commission_calculation ADD COLUMN IF NOT EXISTS slab_id text;
ALTER TABLE commission_calculation ADD COLUMN IF NOT EXISTS product_category text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_calculation_product_category_check') THEN
    ALTER TABLE commission_calculation ADD CONSTRAINT commission_calculation_product_category_check
      CHECK (product_category IS NULL OR
             product_category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER'));
  END IF;
END $$;

-- Month-to-date volume per lender and product category is read on every automatic calculation, so it gets its own index.
CREATE INDEX IF NOT EXISTS commission_calculation_volume_idx
  ON commission_calculation (tenant_id, lender_id, product_category, event_date);

-- 3. Tax treatment on the plan -----------------------------------------------------------------------------------------

ALTER TABLE commission_plan ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'FORWARD_CHARGE';
ALTER TABLE commission_plan ADD COLUMN IF NOT EXISTS gst_rate_bps integer NOT NULL DEFAULT 1800;
ALTER TABLE commission_plan ADD COLUMN IF NOT EXISTS tds_rate_bps integer NOT NULL DEFAULT 200;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_plan_tax_treatment_check'
  ) THEN
    ALTER TABLE commission_plan ADD CONSTRAINT commission_plan_tax_treatment_check
      CHECK (tax_treatment IN ('FORWARD_CHARGE','RCM_RECIPIENT_PAYS'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_plan_gst_rate_bps_check'
  ) THEN
    ALTER TABLE commission_plan ADD CONSTRAINT commission_plan_gst_rate_bps_check
      CHECK (gst_rate_bps >= 0 AND gst_rate_bps <= 10000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_plan_tds_rate_bps_check'
  ) THEN
    ALTER TABLE commission_plan ADD CONSTRAINT commission_plan_tds_rate_bps_check
      CHECK (tds_rate_bps >= 0 AND tds_rate_bps <= 10000);
  END IF;
END $$;

-- 4. Invoice numbering -------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoice_number_series (               -- P2-01, CGST Rule 46(b)
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  -- 'CI' commission invoice, 'CN' credit note, 'DN' debit note. Kept short: the whole number must fit 16 characters.
  series_prefix text NOT NULL CHECK (series_prefix ~ '^[A-Z]{2,4}$'),
  -- Indian financial year label, e.g. '26-27' for 1 Apr 2026 to 31 Mar 2027.
  fy_label      text NOT NULL CHECK (fy_label ~ '^[0-9]{2}-[0-9]{2}$'),
  next_value    integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  lock_version  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, series_prefix, fy_label)
);

ALTER TABLE invoice ADD COLUMN IF NOT EXISTS period_month text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_period_month_check'
  ) THEN
    ALTER TABLE invoice ADD CONSTRAINT invoice_period_month_check
      CHECK (period_month IS NULL OR period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;

-- One live monthly commission invoice per lender. A VOID invoice frees the month for a reissue.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lender_period_uniq
  ON invoice (tenant_id, party_id, period_month)
  WHERE direction = 'TO_LENDER' AND period_month IS NOT NULL AND status <> 'VOID';

-- 5. Row level security, grants and touch triggers ---------------------------------------------------------------------

-- enable_tenant_rls (migration 0000) runs a bare CREATE POLICY with no IF NOT EXISTS, so calling it twice fails with
-- "policy tenant_isolation already exists" and, this being one transaction, rolls the whole migration back. M-110 hit the
-- same edge and is recorded as not re-runnable; guarding the call here keeps 0141 safe to retry, which matters if a hosted
-- apply has to be run again after an interrupted wrapper transaction.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_plan_slab', 'invoice_number_series'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'app' AND tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format('CALL enable_tenant_rls(%L)', format('app.%I', t));
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON commission_plan_slab, invoice_number_series TO dsa_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commission_plan_slab_touch') THEN
    CREATE TRIGGER commission_plan_slab_touch BEFORE UPDATE ON commission_plan_slab
      FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoice_number_series_touch') THEN
    CREATE TRIGGER invoice_number_series_touch BEFORE UPDATE ON invoice_number_series
      FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
END $$;

-- 6. Maker permission ---------------------------------------------------------------------------------------------------
-- Finance executive is the maker: it prepares calculations and invoices. Migration 0085 granted commission.calculate to
-- ROLE-FINANCE-EXEC but only for tenant 'qloax-dsa'; this asserts it for every tenant that has the role, so a tenant
-- provisioned later is not left without a maker. No approval code is granted here: approve, disburse and record_payment
-- stay with the DSA owner, and SOD-02 and SOD-04 still refuse whoever prepared a record (plan section 4, P0-01).
INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, p.permission_code
FROM app.role r
JOIN (
  VALUES
    ('ROLE-FINANCE-EXEC', 'commission.calculate'),
    ('ROLE-FINANCE-EXEC', 'commission.plan.edit')
) AS p(role_code, permission_code)
  ON r.code = p.role_code
ON CONFLICT (role_id, permission_code) DO NOTHING;
