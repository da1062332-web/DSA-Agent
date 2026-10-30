-- Prerequisites for migration 20261001000094 (MOD-ELG applicant figures, provenance, feature flag). READ-ONLY.
-- Run this BEFORE applying 0094, against the environment it will be applied to. Expect no FAIL row.
-- Rows that say "not present yet" should PASS: they show the migration has not been applied. If one of them FAILs, 0094 is already
-- (partly) applied: do not apply it again; read 94.verify.sql instead. The INFO row is informational and never a gate.
SET search_path = app, extensions, public;
SELECT 'table loan_application exists (0021)' AS "check",
       CASE WHEN to_regclass('app.loan_application') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'table checklist_item exists (0021)',
       CASE WHEN to_regclass('app.checklist_item') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table application_party exists (0021)',
       CASE WHEN to_regclass('app.application_party') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table rule_set_version exists (0010)',
       CASE WHEN to_regclass('app.rule_set_version') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table decision_definition exists (0010)',
       CASE WHEN to_regclass('app.decision_definition') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table eligibility_assessment exists (0048)',
       CASE WHEN to_regclass('app.eligibility_assessment') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table feature_flag exists (0046)',
       CASE WHEN to_regclass('app.feature_flag') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table tenant_feature_flag exists (0068)',
       CASE WHEN to_regclass('app.tenant_feature_flag') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'procedure enable_tenant_rls exists (0000)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'enable_tenant_rls' AND p.prokind = 'p') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'function touch_row exists (0000)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'touch_row' AND p.prokind = 'f') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'function app_tenant exists (0000)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'app' AND p.proname = 'app_tenant') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'role dsa_app exists (0000)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the decision definition DK-application.eligibility is registered (0054)',
       CASE WHEN EXISTS (SELECT 1 FROM app.decision_definition WHERE key = 'DK-application.eligibility') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the permission eligibility.override is defined (0048)',
       CASE WHEN EXISTS (SELECT 1 FROM app.permission WHERE code = 'eligibility.override') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'table applicant_financial_input is not present yet (0094 not applied)',
       CASE WHEN to_regclass('app.applicant_financial_input') IS NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'index eligibility_assessment_latest_idx is not present yet',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'eligibility_assessment_latest_idx') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'index eligibility_assessment_product_idx is not present yet',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'eligibility_assessment_product_idx') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'column eligibility_assessment.input_hash is not present yet',
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'app' AND table_name = 'eligibility_assessment' AND column_name = 'input_hash') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'feature flag eligibility.manual_credit_entry is not present yet',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.feature_flag WHERE key = 'eligibility.manual_credit_entry') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'loan_application has UNIQUE (tenant_id, id) (0021; the composite key 0094 refers to)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.loan_application')
                          AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, id)') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'checklist_item has UNIQUE (tenant_id, id) (0021; the composite key 0094 refers to)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.checklist_item')
                          AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, id)') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'feature_flag has PRIMARY KEY (key, scope) (0046; 0094 inserts ON CONFLICT (key, scope))',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.feature_flag')
                          AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (key, scope)') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'feature_flag has the seven columns 0094 writes (0046)',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'feature_flag'
                   AND column_name IN ('key', 'scope', 'value', 'owner', 'remove_by', 'description', 'updated_by')) = 7
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'eligibility_assessment has the columns the run and the new index use (0048)',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'eligibility_assessment'
                   AND column_name IN ('id', 'tenant_id', 'application_id', 'assessed_at')) = 4
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'rule_set and rule_set_version have the columns the INFO row below reads (0010)',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app'
                   AND ((table_name = 'rule_set' AND column_name IN ('id', 'tenant_id', 'decision_key', 'status'))
                     OR (table_name = 'rule_set_version' AND column_name IN ('id', 'tenant_id', 'rule_set_id', 'status')))) = 8
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'INFO: tenants without an active approved eligibility rule set (0055; informational, not a gate)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.tenant t WHERE NOT EXISTS (
              SELECT 1 FROM app.rule_set rs JOIN app.rule_set_version v ON v.rule_set_id = rs.id AND v.tenant_id = rs.tenant_id
               WHERE rs.tenant_id = t.id AND rs.decision_key = 'DK-application.eligibility' AND rs.status = 'ACTIVE' AND v.status = 'ACTIVE'))
            THEN 'PASS' ELSE 'INFO' END;
