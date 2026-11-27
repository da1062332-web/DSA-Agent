-- Rollback migration 0141 (commission volume slabs, plan tax treatment, invoice number series).
-- WRITES. Run inside the one-transaction wrapper, after a snapshot.
--
-- DATA LOSS: dropping commission_plan_slab discards every payout grid entered since the apply, and dropping
-- commission_calculation.slab_id discards which band produced each rate. Calculations, payables and invoices themselves
-- are untouched: their amounts live in their own columns, so money already recorded survives this rollback. Reverting
-- leaves calculateCommission back on its hard-coded 1.5% default, so stop the worker before running this or verified
-- tranches will be priced at that rate.
BEGIN;
SET search_path = app, extensions, public;

-- 1. Invoice numbering. period_month goes last among the invoice changes so the index cannot outlive its column.
DROP INDEX IF EXISTS app.invoice_lender_period_uniq;
ALTER TABLE app.invoice DROP CONSTRAINT IF EXISTS invoice_period_month_check;
ALTER TABLE app.invoice DROP COLUMN IF EXISTS period_month;
DROP TABLE IF EXISTS app.invoice_number_series;

-- 2. Plan tax treatment.
ALTER TABLE app.commission_plan DROP CONSTRAINT IF EXISTS commission_plan_tax_treatment_check;
ALTER TABLE app.commission_plan DROP CONSTRAINT IF EXISTS commission_plan_gst_rate_bps_check;
ALTER TABLE app.commission_plan DROP CONSTRAINT IF EXISTS commission_plan_tds_rate_bps_check;
ALTER TABLE app.commission_plan DROP COLUMN IF EXISTS tax_treatment;
ALTER TABLE app.commission_plan DROP COLUMN IF EXISTS gst_rate_bps;
ALTER TABLE app.commission_plan DROP COLUMN IF EXISTS tds_rate_bps;

-- 3. Which band produced a calculation, then the grid itself.
DROP INDEX IF EXISTS app.commission_calculation_volume_idx;
ALTER TABLE app.commission_calculation DROP CONSTRAINT IF EXISTS commission_calculation_product_category_check;
ALTER TABLE app.commission_calculation DROP COLUMN IF EXISTS product_category;
ALTER TABLE app.commission_calculation DROP COLUMN IF EXISTS slab_id;
DROP TABLE IF EXISTS app.commission_plan_slab;

-- 4. The maker grant.
-- Only commission.calculate is withdrawn, and only where 0085 did not already grant it: that migration scoped its grant
-- to tenant 'qloax-dsa', so removing it there would undo 0085 rather than 0141. commission.plan.edit is left in place for
-- the same reason -- 0085 owns it for qloax-dsa -- and is withdrawn only from tenants 0085 never touched.
DELETE FROM app.role_permission rp
USING app.role r, app.tenant t
WHERE rp.role_id = r.id
  AND rp.tenant_id = r.tenant_id
  AND t.id = rp.tenant_id
  AND r.code = 'ROLE-FINANCE-EXEC'
  AND rp.permission_code IN ('commission.calculate', 'commission.plan.edit')
  AND t.slug <> 'qloax-dsa';

COMMIT;
