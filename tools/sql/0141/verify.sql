-- Verify migration 0141 (commission volume slabs, plan tax treatment, invoice number series). Read-only.
-- Expect every row to return PASS. Run before and after the hosted apply, as plan section 10 requires.
SET search_path = app, extensions, public;

SELECT 'table: commission_plan_slab exists' AS check_name,
       CASE WHEN to_regclass('app.commission_plan_slab') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL SELECT 'table: invoice_number_series exists',
       CASE WHEN to_regclass('app.invoice_number_series') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'column: commission_calculation.slab_id exists and is nullable',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'commission_calculation'
           AND column_name = 'slab_id' AND is_nullable = 'YES'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'column: commission_calculation.product_category exists and is nullable',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'commission_calculation'
           AND column_name = 'product_category' AND is_nullable = 'YES'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'index: month-to-date volume index present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'commission_calculation_volume_idx'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'columns: commission_plan has tax_treatment, gst_rate_bps, tds_rate_bps',
       CASE WHEN (
         SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'commission_plan'
           AND column_name IN ('tax_treatment','gst_rate_bps','tds_rate_bps')
       ) = 3 THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'column: invoice.period_month exists',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app' AND table_name = 'invoice' AND column_name = 'period_month'
       ) THEN 'PASS' ELSE 'FAIL' END

-- A slab must carry a rate in basis points or a flat amount, never both and never neither.
UNION ALL SELECT 'constraint: commission_plan_slab_one_rate present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'commission_plan_slab_one_rate'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'constraint: commission_plan tax treatment is one of the two known values',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'commission_plan_tax_treatment_check'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'index: one live monthly lender invoice per party',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'invoice_lender_period_uniq'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'index: slab lookup index present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'commission_plan_slab_lookup_idx'
       ) THEN 'PASS' ELSE 'FAIL' END

-- RLS is the backstop behind withTenantTx, so it must be on and forced on both new tables.
UNION ALL SELECT 'RLS: enabled and forced on commission_plan_slab',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_class WHERE oid = 'app.commission_plan_slab'::regclass
           AND relrowsecurity AND relforcerowsecurity
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'RLS: enabled and forced on invoice_number_series',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_class WHERE oid = 'app.invoice_number_series'::regclass
           AND relrowsecurity AND relforcerowsecurity
       ) THEN 'PASS' ELSE 'FAIL' END

-- dsa_app may read and write but never DELETE: removals are soft everywhere in this schema.
UNION ALL SELECT 'grants: dsa_app has SELECT, INSERT, UPDATE and no DELETE on the new tables',
       CASE WHEN (
         SELECT count(*) FROM information_schema.role_table_grants
         WHERE grantee = 'dsa_app' AND table_schema = 'app'
           AND table_name IN ('commission_plan_slab','invoice_number_series')
           AND privilege_type IN ('SELECT','INSERT','UPDATE')
       ) = 6 AND NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants
         WHERE grantee = 'dsa_app' AND table_schema = 'app'
           AND table_name IN ('commission_plan_slab','invoice_number_series')
           AND privilege_type = 'DELETE'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL SELECT 'grant: every tenant with ROLE-FINANCE-EXEC holds commission.calculate',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
         WHERE r.code = 'ROLE-FINANCE-EXEC'
           AND NOT EXISTS (
             SELECT 1 FROM app.role_permission rp
             WHERE rp.role_id = r.id AND rp.permission_code = 'commission.calculate'
           )
       ) THEN 'PASS' ELSE 'FAIL' END

-- SOD-02 and SOD-04: the maker role must never gain an approval code here.
UNION ALL SELECT 'SOD: ROLE-FINANCE-EXEC holds no approval code',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.role r
         JOIN app.role_permission rp ON rp.role_id = r.id
         WHERE r.code = 'ROLE-FINANCE-EXEC'
           AND rp.permission_code IN
             ('commission.plan.approve','payout.approve','payout.disburse','payout.record_payment')
       ) THEN 'PASS' ELSE 'FAIL' END

-- The calculation already on hosted predates slabs and must be left exactly as it was.
UNION ALL SELECT 'data: no existing commission_calculation row was given a slab_id',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.commission_calculation
         WHERE slab_id IS NOT NULL AND created_at < '2026-11-27'::date
       ) THEN 'PASS' ELSE 'FAIL' END;
