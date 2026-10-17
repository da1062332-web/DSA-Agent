-- READ ONLY. Part of the hosted test-data cleanup (tools/sql/cleanup/README.md).
-- 00: row counts of every candidate table for EVERY tenant. Run it before and after; only the three test tenants may change.
select t.tenant_id, t.table_name, t.n from (
  select tenant_id, 'activity' as table_name, count(*)::int as n from app.activity group by tenant_id
union all
  select tenant_id, 'message_template' as table_name, count(*)::int as n from app.message_template group by tenant_id
union all
  select tenant_id, 'dedupe_registry' as table_name, count(*)::int as n from app.dedupe_registry group by tenant_id
union all
  select tenant_id, 'notification' as table_name, count(*)::int as n from app.notification group by tenant_id
union all
  select tenant_id, 'idempotency_key' as table_name, count(*)::int as n from app.idempotency_key group by tenant_id
union all
  select tenant_id, 'connector' as table_name, count(*)::int as n from app.connector group by tenant_id
union all
  select tenant_id, 'message' as table_name, count(*)::int as n from app.message group by tenant_id
union all
  select tenant_id, 'outbox_event' as table_name, count(*)::int as n from app.outbox_event group by tenant_id
union all
  select tenant_id, 'public_entry_index' as table_name, count(*)::int as n from app.public_entry_index group by tenant_id
union all
  select tenant_id, 'upload_link' as table_name, count(*)::int as n from app.upload_link group by tenant_id
union all
  select tenant_id, 'payout_request' as table_name, count(*)::int as n from app.payout_request group by tenant_id
union all
  select tenant_id, 'lender_statement' as table_name, count(*)::int as n from app.lender_statement group by tenant_id
union all
  select tenant_id, 'lender_statement_line' as table_name, count(*)::int as n from app.lender_statement_line group by tenant_id
union all
  select tenant_id, 'commission_calculation' as table_name, count(*)::int as n from app.commission_calculation group by tenant_id
union all
  select tenant_id, 'commission_payable' as table_name, count(*)::int as n from app.commission_payable group by tenant_id
union all
  select tenant_id, 'payout_line' as table_name, count(*)::int as n from app.payout_line group by tenant_id
union all
  select tenant_id, 'connector_bank_account' as table_name, count(*)::int as n from app.connector_bank_account group by tenant_id
union all
  select tenant_id, 'import_batch' as table_name, count(*)::int as n from app.import_batch group by tenant_id
union all
  select tenant_id, 'lead' as table_name, count(*)::int as n from app.lead group by tenant_id
union all
  select tenant_id, 'attribution_change_request' as table_name, count(*)::int as n from app.attribution_change_request group by tenant_id
union all
  select tenant_id, 'reconciliation_match' as table_name, count(*)::int as n from app.reconciliation_match group by tenant_id
union all
  select tenant_id, 'data_correction_request' as table_name, count(*)::int as n from app.data_correction_request group by tenant_id
union all
  select tenant_id, 'support_access_grant' as table_name, count(*)::int as n from app.support_access_grant group by tenant_id
union all
  select tenant_id, 'lender' as table_name, count(*)::int as n from app.lender group by tenant_id
) t order by t.tenant_id, t.table_name;
