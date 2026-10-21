-- Roll back migration 0083. Refused once an offboarding was requested or a tenant has entitlements or a status change recorded. Tenants provisioned through the API stay (they are ordinary tenants).
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.tenant_offboarding') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.tenant_offboarding) THEN
      RAISE EXCEPTION 'Rollback aborted: app.tenant_offboarding holds rows. Manual review required.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'tenant' AND column_name = 'entitlements') THEN
    IF EXISTS (SELECT 1 FROM app.tenant WHERE entitlements <> '{}'::jsonb OR entitlements_version <> 0 OR status_reason IS NOT NULL OR status_changed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: tenants have entitlements or status changes recorded. Manual review required.';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS app.platform_set_entitlements(text, jsonb, integer, text);
DROP FUNCTION IF EXISTS app.platform_request_offboarding(text, text, text);
DROP FUNCTION IF EXISTS app.platform_set_tenant_status(text, text, text, text);
DROP FUNCTION IF EXISTS app.platform_provision_tenant(text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS app.platform_require_realm();
DROP TABLE IF EXISTS app.tenant_offboarding;
DELETE FROM app.role_permission WHERE permission_code IN (SELECT code FROM app.permission WHERE introduced_in = 'M-083');
DELETE FROM app.permission WHERE introduced_in = 'M-083';
ALTER TABLE app.tenant DROP COLUMN IF EXISTS entitlements, DROP COLUMN IF EXISTS entitlements_version,
  DROP COLUMN IF EXISTS status_reason, DROP COLUMN IF EXISTS status_changed_at;
COMMIT;
