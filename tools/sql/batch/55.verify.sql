-- Verify migration 0055 (approved eligibility rules). Read-only. Expect every row PASS.
SELECT 'decision definition DK-application.eligibility exists' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM app.decision_definition WHERE key = 'DK-application.eligibility') THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'every tenant has an active eligibility rule set with an active version',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.tenant t WHERE NOT EXISTS (
              SELECT 1 FROM app.rule_set rs JOIN app.rule_set_version v ON v.rule_set_id = rs.id AND v.tenant_id = rs.tenant_id
               WHERE rs.tenant_id = t.id AND rs.decision_key = 'DK-application.eligibility' AND rs.status = 'ACTIVE' AND v.status = 'ACTIVE')) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'the seeded versions have indexed rules, each holding exactly one of order or priority',
       CASE WHEN EXISTS (SELECT 1 FROM app.rule_set_rule WHERE version_id LIKE 'rsv_elg_%')
             AND NOT EXISTS (SELECT 1 FROM app.rule_set_rule WHERE version_id LIKE 'rsv_elg_%' AND (order_no IS NULL) = (priority IS NULL)) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'eligibility.override is held by the four approver roles in every tenant (the pending decision, D1)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code IN ('ROLE-ORG-OWNER','ROLE-BRANCH-MGR','ROLE-LOAN-OPS','ROLE-TENANT-ADMIN')
                              AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = 'eligibility.override')) THEN 'PASS' ELSE 'FAIL' END;
