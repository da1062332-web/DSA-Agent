-- READ ONLY. Part of the hosted test-data cleanup (tools/sql/cleanup/README.md).
-- 01: every row the cleanup could delete, as one JSON object { table: [rows] }, for the three test tenants only.
-- Store the output outside the repository (it is test data, but treat it as data). Restoring a table is an INSERT from this JSON.
select json_build_object(
  'taken_at', now(),
  'tenants', (select json_agg(json_build_object('id', id, 'slug', slug)) from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b'])),
  'activity', (select coalesce(json_agg(x), '[]'::json) from app.activity x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'message_template', (select coalesce(json_agg(x), '[]'::json) from app.message_template x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'dedupe_registry', (select coalesce(json_agg(x), '[]'::json) from app.dedupe_registry x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'notification', (select coalesce(json_agg(x), '[]'::json) from app.notification x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'idempotency_key', (select coalesce(json_agg(x), '[]'::json) from app.idempotency_key x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'connector', (select coalesce(json_agg(x), '[]'::json) from app.connector x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'message', (select coalesce(json_agg(x), '[]'::json) from app.message x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'outbox_event', (select coalesce(json_agg(x), '[]'::json) from app.outbox_event x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'public_entry_index', (select coalesce(json_agg(x), '[]'::json) from app.public_entry_index x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'upload_link', (select coalesce(json_agg(x), '[]'::json) from app.upload_link x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'payout_request', (select coalesce(json_agg(x), '[]'::json) from app.payout_request x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'lender_statement', (select coalesce(json_agg(x), '[]'::json) from app.lender_statement x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'lender_statement_line', (select coalesce(json_agg(x), '[]'::json) from app.lender_statement_line x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'commission_calculation', (select coalesce(json_agg(x), '[]'::json) from app.commission_calculation x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'commission_payable', (select coalesce(json_agg(x), '[]'::json) from app.commission_payable x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'payout_line', (select coalesce(json_agg(x), '[]'::json) from app.payout_line x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'connector_bank_account', (select coalesce(json_agg(x), '[]'::json) from app.connector_bank_account x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'import_batch', (select coalesce(json_agg(x), '[]'::json) from app.import_batch x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'lead', (select coalesce(json_agg(x), '[]'::json) from app.lead x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'attribution_change_request', (select coalesce(json_agg(x), '[]'::json) from app.attribution_change_request x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'reconciliation_match', (select coalesce(json_agg(x), '[]'::json) from app.reconciliation_match x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'data_correction_request', (select coalesce(json_agg(x), '[]'::json) from app.data_correction_request x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'support_access_grant', (select coalesce(json_agg(x), '[]'::json) from app.support_access_grant x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b']))),
  'lender', (select coalesce(json_agg(x), '[]'::json) from app.lender x where x.tenant_id in (select id from app.tenant where slug = any(ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b'])))
) as backup;
