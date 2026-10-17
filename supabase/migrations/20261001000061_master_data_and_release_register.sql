-- Migration: 20261001000061_master_data_and_release_register.sql
-- Owner: Dev 1 (Modules 1 and 40: platform administration)
-- The platform console kept its master data lists and its release register inside the service (lost on every restart), and the register
-- showed verification gates as passed that nobody had checked. Both now live in the database.
--  1. master_data_item (created by 0046, writable by the platform realm only since 0050) gets the baseline lists the console used to
--     invent in memory: states, occupations, reason codes and a small pincode sample. Idempotent, and an operator's edits are kept.
--  2. platform_release: the release register. Platform realm only, for reading and writing. Verification gates start as NOT verified
--     (false) and an operator sets them, so a green gate means someone set it.

SET search_path = app, extensions, public;

INSERT INTO app.master_data_item (dataset, code, label, is_active, metadata, created_by) VALUES
  ('pincodes', '400008', 'Mumbai Central', true, '{"state":"Maharashtra","tier":1}'::jsonb, 'SYSTEM:migration'),
  ('pincodes', '411001', 'Pune Camp', true, '{"state":"Maharashtra","tier":2}'::jsonb, 'SYSTEM:migration'),
  ('pincodes', '560001', 'Bangalore GPO', true, '{"state":"Karnataka","tier":1}'::jsonb, 'SYSTEM:migration'),
  ('pincodes', '110001', 'New Delhi Connaught Place', true, '{"state":"Delhi","tier":1}'::jsonb, 'SYSTEM:migration'),
  ('states', 'MH', 'Maharashtra', true, '{"gstCode":"27","region":"WEST"}'::jsonb, 'SYSTEM:migration'),
  ('states', 'KA', 'Karnataka', true, '{"gstCode":"29","region":"SOUTH"}'::jsonb, 'SYSTEM:migration'),
  ('states', 'DL', 'Delhi', true, '{"gstCode":"07","region":"NORTH"}'::jsonb, 'SYSTEM:migration'),
  ('states', 'TN', 'Tamil Nadu', true, '{"gstCode":"33","region":"SOUTH"}'::jsonb, 'SYSTEM:migration'),
  ('occupations', 'SALARIED_PVT', 'Salaried Private Sector', true, '{"category":"SALARIED","riskWeight":1.0}'::jsonb, 'SYSTEM:migration'),
  ('occupations', 'SALARIED_GOVT', 'Salaried Government / PSU', true, '{"category":"SALARIED","riskWeight":0.8}'::jsonb, 'SYSTEM:migration'),
  ('occupations', 'SELF_EMP_PROF', 'Self Employed Professional', true, '{"category":"SEP","riskWeight":1.2}'::jsonb, 'SYSTEM:migration'),
  ('occupations', 'SELF_EMP_BIZ', 'Self Employed Business Owner', true, '{"category":"SENP","riskWeight":1.4}'::jsonb, 'SYSTEM:migration'),
  ('reason_codes', 'INSUFFICIENT_INCOME', 'Monthly income below policy threshold', true, '{"category":"FINANCIAL"}'::jsonb, 'SYSTEM:migration'),
  ('reason_codes', 'LOW_CREDIT_SCORE', 'CIBIL score below lender requirement', true, '{"category":"CREDIT"}'::jsonb, 'SYSTEM:migration'),
  ('reason_codes', 'INCOMPLETE_DOCUMENTS', 'Mandatory KYC or income proof missing', true, '{"category":"DOCUMENT"}'::jsonb, 'SYSTEM:migration'),
  ('reason_codes', 'CUSTOMER_OPT_OUT', 'Customer declined loan terms or withdrawn', true, '{"category":"BUSINESS"}'::jsonb, 'SYSTEM:migration')
ON CONFLICT (dataset, code) DO NOTHING;

CREATE TABLE IF NOT EXISTS app.platform_release (
  version            text PRIMARY KEY CHECK (version ~ '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$'),
  status             text NOT NULL CHECK (status IN ('CANDIDATE', 'STAGING', 'PUBLISHED', 'ARCHIVED')),
  target_date        date NOT NULL,
  git_tag            text,
  release_notes_ref  text NOT NULL,
  rule_pack_version  text NOT NULL,
  migration_version  text NOT NULL,
  gates              jsonb NOT NULL DEFAULT '{"rel001":false,"rel002":false,"rel003":false,"rel004":false}'::jsonb
                     CHECK (jsonb_typeof(gates) = 'object'),
  notes_summary      text NOT NULL DEFAULT '',
  lock_version       integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL
);

ALTER TABLE app.platform_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_release FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_read ON app.platform_release;
DROP POLICY IF EXISTS release_insert ON app.platform_release;
DROP POLICY IF EXISTS release_update ON app.platform_release;
CREATE POLICY release_read   ON app.platform_release FOR SELECT USING (app.is_platform_realm());
CREATE POLICY release_insert ON app.platform_release FOR INSERT WITH CHECK (app.is_platform_realm());
CREATE POLICY release_update ON app.platform_release FOR UPDATE USING (app.is_platform_realm()) WITH CHECK (app.is_platform_realm());
GRANT SELECT, INSERT, UPDATE ON app.platform_release TO dsa_app;

-- The candidate the console used to show. Gates are false until an operator verifies and sets them.
INSERT INTO app.platform_release (version, status, target_date, git_tag, release_notes_ref, rule_pack_version, migration_version, notes_summary, updated_by)
VALUES ('v0.1.0-rc.1', 'CANDIDATE', '2026-10-14', NULL, 'RELEASE_NOTES_v0.1.0-rc.1.md',
        'M-010 (20261001000010_rules_core.sql)', 'M-061 (20261001000061_master_data_and_release_register.sql)',
        'Workflow A walking-skeleton MVP internal pilot candidate on synthetic data only.', 'SYSTEM:migration')
ON CONFLICT (version) DO NOTHING;
