-- Roll back migration 0063. The tables are dropped only when empty (events are an audit trail); the permissions go with their grants.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF to_regclass('app.security_event') IS NOT NULL THEN
    IF (SELECT count(*) FROM app.security_event) > 0 THEN
      RAISE EXCEPTION 'Rollback aborted: app.security_event holds rows. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.incident_record') IS NOT NULL THEN
    IF (SELECT count(*) FROM app.incident_record) > 0 THEN
      RAISE EXCEPTION 'Rollback aborted: app.incident_record holds rows. Manual review required.';
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS app.incident_record;
DROP TABLE IF EXISTS app.security_event;
DELETE FROM app.role_permission WHERE permission_code IN ('security.incident', 'security.vuln');
DELETE FROM app.permission WHERE code IN ('security.incident', 'security.vuln');
COMMIT;
