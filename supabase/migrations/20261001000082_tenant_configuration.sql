-- Migration: 20261001000082_tenant_configuration.sql
-- Owner: Dev 1 (MOD-CFG; API-CFG-001..009)
--   ENT-012 setting: one value per (scope, key); locked stops lower levels overriding it. Values are validated per key by the API.
--   ENT-013 labels: held as one label_set row per locale (entries: canonical key, label, sub-stage of), so the whole set is
--           replaced under one If-Match version (API-CFG-003). Deviation from per-row ENT-013, noted in the module docs.
--   ENT-015 business_calendar: weekly hours, holidays and quiet hours in a time zone.
--   ENT-014 picklist_value: tenant reason codes, sources and campaign lists.
--   config_bundle_draft: an imported configuration bundle, kept as a draft (API-CFG-009 "imported as drafts").

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS setting (                             -- ENT-012
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  scope_type    text NOT NULL CHECK (scope_type IN ('TENANT','ORGANISATION','BRANCH','USER')),
  scope_id      text NOT NULL,
  key           text NOT NULL CHECK (key ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$'),
  value         jsonb NOT NULL,
  locked        boolean NOT NULL DEFAULT false,
  lock_version  integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scope_type, scope_id, key)
);
CREATE TRIGGER setting_touch BEFORE UPDATE ON setting FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('setting');
GRANT SELECT, INSERT, UPDATE ON setting TO dsa_app;

CREATE TABLE IF NOT EXISTS label_set (                           -- ENT-013
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  locale        text NOT NULL CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  entries       jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) <= 500),
  lock_version  integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, locale)
);
CREATE TRIGGER label_set_touch BEFORE UPDATE ON label_set FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('label_set');
GRANT SELECT, INSERT, UPDATE ON label_set TO dsa_app;

CREATE TABLE IF NOT EXISTS business_calendar (                   -- ENT-015
  id            text PRIMARY KEY CHECK (id ~ '^cal_[A-Za-z0-9_-]{6,40}$'),
  tenant_id     text NOT NULL REFERENCES tenant(id),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 80),
  timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  weekly_hours  jsonb NOT NULL,
  holidays      date[] NOT NULL DEFAULT '{}',
  quiet_hours   jsonb,
  lock_version  integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER business_calendar_touch BEFORE UPDATE ON business_calendar FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('business_calendar');
GRANT SELECT, INSERT, UPDATE ON business_calendar TO dsa_app;

CREATE TABLE IF NOT EXISTS picklist_value (                      -- ENT-014
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenant(id),
  category    text NOT NULL CHECK (category ~ '^[A-Z][A-Z_]{2,40}$'),
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  active      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, category, code)
);
CALL enable_tenant_rls('picklist_value');
GRANT SELECT, INSERT ON picklist_value TO dsa_app;
GRANT UPDATE (label, active) ON picklist_value TO dsa_app;

CREATE TABLE IF NOT EXISTS config_bundle_draft (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenant(id),
  bundle      jsonb NOT NULL,
  counts      jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPLIED','DISCARDED')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id)
);
CALL enable_tenant_rls('config_bundle_draft');
GRANT SELECT, INSERT ON config_bundle_draft TO dsa_app;
