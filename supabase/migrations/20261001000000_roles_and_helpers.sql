-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §2.
-- Owner (v1.2 Assignment Matrix §3): Dev 1. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).

-- 0000_roles_and_helpers.sql  (owner: Dev 1, TASK-103)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, extensions, public;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;     -- exclusion constraints (team_membership, work_queue_member, rule_set_version)

-- Supabase built-in roles get nothing on schema app (ADR-SB-01); guarded so the file also runs on plain Postgres
DO $$ BEGIN
  REVOKE ALL ON SCHEMA app FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN
    CREATE ROLE dsa_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA app, extensions TO dsa_app;
-- Infra (REL-001, not in git): CREATE ROLE dsa_api LOGIN PASSWORD '…' NOBYPASSRLS IN ROLE dsa_app; ALTER ROLE dsa_api SET search_path = app, extensions;

CREATE OR REPLACE FUNCTION app_tenant() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  NEW.updated_at   := now();
  NEW.lock_version := OLD.lock_version + 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  RAISE EXCEPTION 'table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE PROCEDURE enable_tenant_rls(tbl regclass) LANGUAGE plpgsql AS
$$ BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', tbl);
END $$;
