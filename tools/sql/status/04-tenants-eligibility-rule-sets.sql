-- Read-only: which tenants exist, and which carry the approved eligibility rule set. Only SELECT. Changes nothing.
SELECT 'tenants' AS item,
       jsonb_build_object(
         'tenant_count', (SELECT count(*) FROM app.tenant),
         'slugs', (SELECT coalesce(jsonb_agg(t.slug ORDER BY t.slug), '[]'::jsonb) FROM app.tenant t)
       ) AS state
UNION ALL SELECT 'eligibility rule sets by tenant (DK-application.eligibility)',
       jsonb_build_object(
         'rule_sets', (SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_slug', t.slug, 'rule_set_id', rs.id)), '[]'::jsonb)
                       FROM app.rule_set rs JOIN app.tenant t ON t.id = rs.tenant_id
                       WHERE rs.decision_key = 'DK-application.eligibility')
       );
