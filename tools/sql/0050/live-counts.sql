-- tools/sql/0050/live-counts.sql  — READ-ONLY. The live counts and a content hash of role_permission, for check-backup.mjs.
select (select count(*) from app.role_permission) as role_permission,
       (select count(*) from app.role) as role, (select count(*) from app.tenant) as tenant,
       (select count(*) from app.support_access_grant) as support_access_grant,
       (select count(*) from app.data_correction_request) as data_correction_request,
       (select count(*) from app.feature_flag) as feature_flag, (select count(*) from app.master_data_item) as master_data_item,
       (select md5(string_agg(tenant_id||'|'||role_id||'|'||permission_code, ',' order by tenant_id, role_id, permission_code)) from app.role_permission) as rp_md5;
