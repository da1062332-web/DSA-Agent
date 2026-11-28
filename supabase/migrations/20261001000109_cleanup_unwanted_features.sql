-- Migration: 20261001000109_cleanup_unwanted_features.sql
-- Module: Access Control and platform cleanup (owner: Vaibhav, lane 0105-0109). Task P0-02 (removal of unwanted features, 27 Nov 2026).
-- Removes database objects that exist only for features the DSA CRM no longer ships. Earlier migrations are not edited: this file
-- records the removal on top of them.
--
-- Sections (one per removed feature, each in its own commit):
--   1. Security incidents and events: security_event, incident_record; permissions security.read, security.incident, security.vuln.
--   2. Access reviews: access_review_item, access_review; permission access_review.manage.
--   3. API client registry: api_client. Permissions api.read and api.manage stay: the partner API keys, partner lead reads
--      and webhook subscriptions still use them.
--   4. Legal holds and document archives: legal_hold, document_archive. Permissions privacy.manage and document.download stay:
--      privacy requests and document downloads still use them.
--   6. Delegations, capacity and availability: delegation table. Attendance, the users availability and capacity columns and the
--      permission attendance.manage stay (the user directory and attendance still use them).
--   5. Data corrections: data_correction_request, function approved_data_corrections(integer); permissions data_correction.request,
--      data_correction.approve.
--
-- Safety: a table is dropped only when it holds no rows. If a table has rows, the migration stops and nothing is dropped.
-- Idempotent: DELETE and DROP ... IF EXISTS can run again without effect.
-- Each table has a public view from migration 0087; the view is dropped before the table.
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

DROP VIEW IF EXISTS public.incident_record;
DROP TABLE IF EXISTS app.incident_record;
DROP VIEW IF EXISTS public.security_event;
DROP TABLE IF EXISTS app.security_event;

-- 2. Access reviews -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.access_review') IS NOT NULL AND EXISTS (SELECT 1 FROM app.access_review) THEN
    RAISE EXCEPTION 'M-109: app.access_review holds rows; stop and review before dropping it';
  END IF;
  IF to_regclass('app.access_review_item') IS NOT NULL AND EXISTS (SELECT 1 FROM app.access_review_item) THEN
    RAISE EXCEPTION 'M-109: app.access_review_item holds rows; stop and review before dropping it';
  END IF;
END
$$;

DELETE FROM app.role_permission WHERE permission_code IN ('access_review.manage');
DELETE FROM app.permission WHERE code IN ('access_review.manage');

DROP VIEW IF EXISTS public.access_review_item;
DROP TABLE IF EXISTS app.access_review_item;
DROP VIEW IF EXISTS public.access_review;
DROP TABLE IF EXISTS app.access_review;

-- 3. API client registry --------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.api_client') IS NOT NULL AND EXISTS (SELECT 1 FROM app.api_client) THEN
    RAISE EXCEPTION 'M-109: app.api_client holds rows; stop and review before dropping it';
  END IF;
END
$$;

DROP VIEW IF EXISTS public.api_client;
DROP TABLE IF EXISTS app.api_client;

-- 4. Legal holds and document archives -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.legal_hold') IS NOT NULL AND EXISTS (SELECT 1 FROM app.legal_hold) THEN
    RAISE EXCEPTION 'M-109: app.legal_hold holds rows; stop and review before dropping it';
  END IF;
  IF to_regclass('app.document_archive') IS NOT NULL AND EXISTS (SELECT 1 FROM app.document_archive) THEN
    RAISE EXCEPTION 'M-109: app.document_archive holds rows; stop and review before dropping it';
  END IF;
END
$$;

DROP VIEW IF EXISTS public.document_archive;
DROP TABLE IF EXISTS app.document_archive;
DROP VIEW IF EXISTS public.legal_hold;
DROP TABLE IF EXISTS app.legal_hold;

-- 5. Data corrections -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.data_correction_request') IS NOT NULL AND EXISTS (SELECT 1 FROM app.data_correction_request) THEN
    RAISE EXCEPTION 'M-109: app.data_correction_request holds rows; stop and review before dropping it';
  END IF;
END
$$;

DELETE FROM app.role_permission WHERE permission_code IN ('data_correction.request', 'data_correction.approve');
DELETE FROM app.permission WHERE code IN ('data_correction.request', 'data_correction.approve');

DROP FUNCTION IF EXISTS app.approved_data_corrections(integer);
DROP VIEW IF EXISTS public.data_correction_request;
DROP TABLE IF EXISTS app.data_correction_request;

-- 6. Delegations (leave cover) ------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('app.delegation') IS NOT NULL AND EXISTS (SELECT 1 FROM app.delegation) THEN
    RAISE EXCEPTION 'M-109: app.delegation holds rows; stop and review before dropping it';
  END IF;
END
$$;

DROP VIEW IF EXISTS public.delegation;
DROP TABLE IF EXISTS app.delegation;
