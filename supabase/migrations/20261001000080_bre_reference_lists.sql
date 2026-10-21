-- Migration: 20261001000080_bre_reference_lists.sql
-- Owner: Dev 2 (MOD-BRE SUB-BRE.09; API-BRE-028, API-BRE-029)
-- Approved, versioned value lists that rules can use. A version is immutable once published and kept permanently.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS reference_list (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenant(id),
  code        text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  value_type  text NOT NULL CHECK (value_type IN ('STRING','NUMBER','PINCODE','CODE')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CALL enable_tenant_rls('reference_list');
GRANT SELECT, INSERT ON reference_list TO dsa_app;

CREATE TABLE IF NOT EXISTS reference_list_version (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  list_id       text NOT NULL,
  version_no    integer NOT NULL CHECK (version_no >= 1),
  "values"      jsonb NOT NULL CHECK (jsonb_typeof("values") = 'array' AND jsonb_array_length("values") <= 1000),
  value_count   integer NOT NULL CHECK (value_count BETWEEN 0 AND 1000),
  content_hash  text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_by  text NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (list_id, version_no),
  FOREIGN KEY (tenant_id, list_id) REFERENCES reference_list (tenant_id, id)
);
CALL enable_tenant_rls('reference_list_version');
CREATE TRIGGER reference_list_version_append_only BEFORE UPDATE OR DELETE ON reference_list_version
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
GRANT SELECT, INSERT ON reference_list_version TO dsa_app;
