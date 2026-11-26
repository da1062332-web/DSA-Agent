-- Verify migration 0107 (correction to M-105: no user holds the same role through two open assignments). Read-only.
-- Each row is PASS, FAIL or INFO; expect no FAIL row. INFO rows are not failures.
SET search_path = app, extensions, public;

SELECT 'no user holds the same role through two open assignments' AS "check",
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM app.user_role_assignment a
          WHERE NOT isempty(a.effective_range) AND upper_inf(a.effective_range)
          GROUP BY a.tenant_id, a.user_id, a.role_id HAVING count(*) > 1
       ) THEN 'PASS' ELSE 'FAIL' END AS result,
       '' AS detail
UNION ALL SELECT 'open ROLE-POLICY-MGR assignments', 'INFO',
       (SELECT count(*)::text FROM app.user_role_assignment a JOIN app.role r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
         WHERE r.code = 'ROLE-POLICY-MGR' AND NOT isempty(a.effective_range) AND upper_inf(a.effective_range));
