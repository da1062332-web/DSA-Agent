-- READ ONLY. Per table and tenant: how many rows exist, when they were created, and how many in the last 14 hours.
with tabs as (
  select c.table_name from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'app' and c.column_name = 'tenant_id'
    and exists (select 1 from information_schema.columns x where x.table_schema='app' and x.table_name=c.table_name and x.column_name='created_at')
), q as (
  select table_name,
    (xpath('/row/j/text()', query_to_xml(format(
      'select coalesce(json_agg(t), ''[]''::json)::text as j from (select tenant_id, count(*) n, min(created_at) first_at, max(created_at) last_at, count(*) filter (where created_at > now() - interval ''14 hours'') n14 from app.%I where tenant_id like %L group by 1) t', table_name, 'ten_01J%'), false, true, '')))[1]::text::json as j
  from tabs
)
select q.table_name, e->>'tenant_id' as tenant_id, (e->>'n')::int as total_rows, (e->>'n14')::int as last_14h, e->>'first_at' as first_at, e->>'last_at' as last_at
from q, json_array_elements(q.j) e order by 4 desc, 3 desc, 1 limit 500
