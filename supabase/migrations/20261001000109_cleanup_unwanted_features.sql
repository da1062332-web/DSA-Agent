-- Migration: 20261001000109_cleanup_unwanted_features.sql
-- Module: Access Control and platform cleanup (owner: Vaibhav, lane 0105-0109). Task P0-02 (removal of unwanted features, 27 Nov 2026).
-- Removes database objects that exist only for features the DSA CRM no longer ships. Earlier migrations are not edited: this file
-- records the removal on top of them.
--
-- Sections (one per removed feature, each in its own commit):
--   1. Security incidents and events: security_event, incident_record; permissions security.read, security.incident, security.vuln.
--
-- Safety: a table is dropped only when it holds no rows. If a table has rows, the migration stops and nothing is dropped.
-- Idempotent: DELETE and DROP ... IF EXISTS can run again without effect.
-- Verify: tools/sql/batch/109.verify.sql. Rollback: not provided; a removed feature is rebuilt from git history, not from this file.

SET search_path = app, extensions, public;

-- 1. Security incidents and events -------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.security_event') IS NOT NULL AND EXISTS (SELECT 1 FROM app.security_event) THEN
    RAISE EXCEPTION 'M-109: app.security_event holds rows; stop and review before dropping it';
  END IF;
  IF to_regclass('app.incident_record') IS NOT NULL AND EXISTS (SELECT 1 FROM app.incident_record) THEN
    RAISE EXCEPTION 'M-109: app.incident_record holds rows; stop and review before dropping it';
  END IF;
END
$$;

DELETE FROM app.role_permission WHERE permission_code IN ('security.read', 'security.incident', 'security.vuln');
DELETE FROM app.permission WHERE code IN ('security.read', 'security.incident', 'security.vuln');

DROP TABLE IF EXISTS app.incident_record;
DROP TABLE IF EXISTS app.security_event;
