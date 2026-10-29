-- Verify migration 20261001000094 (MOD-ELG applicant figures, assessment provenance, feature flag). Read-only. Expect every row PASS.
-- Run after the migration is applied, through the same runner as the other batch migrations (see docs/PENDING_APPROVALS.md section 7).
SET search_path = app, extensions, public;
SELECT 'table applicant_financial_input exists with row-level security enabled and forced' AS "check",
       CASE WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'app' AND c.relname = 'applicant_financial_input'
                            AND c.relrowsecurity AND c.relforcerowsecurity) THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'applicant_financial_input has its tenant policy',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'applicant_financial_input')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'dsa_app can read and write applicant_financial_input, and cannot delete from it',
       CASE WHEN has_table_privilege('dsa_app', 'app.applicant_financial_input', 'SELECT')
             AND has_table_privilege('dsa_app', 'app.applicant_financial_input', 'INSERT')
             AND has_table_privilege('dsa_app', 'app.applicant_financial_input', 'UPDATE')
             AND NOT has_table_privilege('dsa_app', 'app.applicant_financial_input', 'DELETE')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'eligibility_assessment carries the seven provenance columns',
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema = 'app' AND table_name = 'eligibility_assessment'
                     AND column_name IN ('product_version_id', 'rule_set_version_id', 'rule_set_version_no', 'decision_status',
                                         'input_hash', 'matched_rule_uids', 'missing_data')) = 7
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'every assessment that names a rule set version also carries its input fingerprint',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.eligibility_assessment
                              WHERE rule_set_version_id IS NOT NULL AND input_hash IS NULL)
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the feature flag eligibility.manual_credit_entry is defined for TENANT scope and off by default',
       CASE WHEN EXISTS (SELECT 1 FROM app.feature_flag
                          WHERE key = 'eligibility.manual_credit_entry' AND scope = 'TENANT' AND value = false)
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'no tenant has switched manual credit entry on (expected at first apply; review any PASS-to-FAIL change)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.tenant_feature_flag
                              WHERE key = 'eligibility.manual_credit_entry' AND value = true)
            THEN 'PASS' ELSE 'FAIL' END;
