-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §6.
-- Owner (v1.2 Assignment Matrix §3): Dev 2. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0010_rules_core.sql  (owner: Dev 2, TASK-201) — Doc 06.1 §3 adapted (ADR-4D-03, ADR-4D-06, PA-07)
CREATE TABLE decision_definition (                               -- global registry; rows only via migrations
  key                   text PRIMARY KEY CHECK (key ~ '^DK-[a-z_]+\.[a-z_]+$'),
  registry_version      text NOT NULL,
  tier                  text NOT NULL CHECK (tier IN ('T1','T2','T3')),
  input_schema          jsonb NOT NULL,
  output_schema         jsonb NOT NULL,                          -- includes x-merge per property for COLLECT
  allowed_hit_policies  text[] NOT NULL CHECK (allowed_hit_policies <@ ARRAY['UNIQUE','FIRST','PRIORITY','COLLECT','RULE_ORDER']),
  binding_mode          text NOT NULL CHECK (binding_mode IN ('EVAL','EVENT','PIN')),
  fallback_policy       text NOT NULL CHECK (fallback_policy IN ('DEFAULT_OUTPUT','FAIL_CLOSED','MANUAL_REVIEW')),
  fallback_output       jsonb,
  unknown_policy        text NOT NULL CHECK (unknown_policy IN ('IGNORE','UNDETERMINED')),
  recording_level       text NOT NULL CHECK (recording_level IN ('ALWAYS','SAMPLED')),
  scope_chain           text[] NOT NULL,                         -- e.g. {BRANCH,TENANT_DEFAULT}
  overridable           boolean NOT NULL DEFAULT false,
  enabled               boolean NOT NULL DEFAULT false,
  CHECK (fallback_policy <> 'DEFAULT_OUTPUT' OR fallback_output IS NOT NULL)
);

CREATE TABLE rule_set (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  decision_key   text NOT NULL REFERENCES decision_definition(key),
  scope_type     text NOT NULL CHECK (scope_type IN ('TENANT_DEFAULT','BRANCH','LENDER','PRODUCT_VERSION')),
  scope_ref      text,
  name           text NOT NULL,
  owner_user_id  text,
  origin         text NOT NULL CHECK (origin IN ('PLATFORM_SEED','TENANT')),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  lock_version   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK ((scope_type = 'TENANT_DEFAULT') = (scope_ref IS NULL))
);
CREATE UNIQUE INDEX rule_set_scope_uq ON rule_set (tenant_id, decision_key, scope_type, coalesce(scope_ref, '-'));

CREATE TABLE rule_set_version (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  rule_set_id         text NOT NULL,
  version_no          integer NOT NULL CHECK (version_no >= 1),
  status              text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','ACTIVE','SUSPENDED','SUPERSEDED','RETIRED','REJECTED','ABANDONED')),
  hit_policy          text NOT NULL CHECK (hit_policy IN ('UNIQUE','FIRST','PRIORITY','COLLECT','RULE_ORDER')),
  aggregator          text CHECK (aggregator IN ('SUM','MIN','MAX','COUNT')),
  authoring_form      text NOT NULL DEFAULT 'RULES' CHECK (authoring_form IN ('RULES','DECISION_TABLE')),
  definition          jsonb NOT NULL,                            -- {"schemaVersion":1,"rules":[…]} validated by bre-core
  default_output      jsonb,
  content_hash        text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  effective_range     tstzrange,
  change_reason       text,
  lineage_version_id  text REFERENCES rule_set_version(id),
  editors             text[] NOT NULL DEFAULT '{}',              -- SOD-01 basis (author + every editor)
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  submitted_by        text, submitted_at timestamptz,
  published_by        text, published_at timestamptz,
  suspended_by        text, suspended_at timestamptz, suspend_reason text,
  last_validation_id  text,
  lock_version        integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  UNIQUE (rule_set_id, version_no),
  FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id),
  CHECK (status NOT IN ('SCHEDULED','ACTIVE','SUSPENDED','SUPERSEDED','RETIRED') OR effective_range IS NOT NULL),
  CHECK (status IN ('DRAFT','ABANDONED') OR change_reason IS NOT NULL),
  EXCLUDE USING gist (rule_set_id WITH =, effective_range WITH &&) WHERE (status IN ('SCHEDULED','ACTIVE','SUSPENDED'))
);
CREATE INDEX rule_set_version_resolve_idx ON rule_set_version (tenant_id, rule_set_id, status);

CREATE FUNCTION rsv_immutable_after_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN                                                             -- BR-DOM-012, FR-BRE-017/020
  IF OLD.status <> 'DRAFT' AND (
       NEW.definition     IS DISTINCT FROM OLD.definition     OR
       NEW.default_output IS DISTINCT FROM OLD.default_output OR
       NEW.hit_policy     IS DISTINCT FROM OLD.hit_policy     OR
       NEW.aggregator     IS DISTINCT FROM OLD.aggregator     OR
       NEW.content_hash   IS DISTINCT FROM OLD.content_hash   OR
       NEW.change_reason  IS DISTINCT FROM OLD.change_reason) THEN
    RAISE EXCEPTION 'rule_set_version % is immutable in status %', OLD.id, OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rule_set_version_immutable BEFORE UPDATE ON rule_set_version FOR EACH ROW EXECUTE FUNCTION rsv_immutable_after_draft();
CREATE TRIGGER rule_set_version_no_delete BEFORE DELETE ON rule_set_version FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_set_touch BEFORE UPDATE ON rule_set FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE rule_set_rule (                                     -- per-rule index, written at submit (frozen)
  tenant_id   text NOT NULL REFERENCES tenant(id),
  version_id  text NOT NULL,
  rule_uid    text NOT NULL CHECK (rule_uid ~ '^RUL-[A-Z0-9-]{2,30}$'),
  name        text NOT NULL,
  order_no    integer,
  priority    integer,
  enabled     boolean NOT NULL,
  PRIMARY KEY (version_id, rule_uid),
  FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id),
  CHECK ((order_no IS NULL) <> (priority IS NULL))
);
CREATE UNIQUE INDEX rule_set_rule_order_uq    ON rule_set_rule (version_id, order_no) WHERE order_no IS NOT NULL;
CREATE UNIQUE INDEX rule_set_rule_priority_uq ON rule_set_rule (version_id, priority) WHERE priority IS NOT NULL;

CREATE TABLE rule_test_case (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  rule_set_id      text NOT NULL,
  name             text NOT NULL,
  evaluation_time  timestamptz NOT NULL,
  scope            jsonb NOT NULL DEFAULT '{}'::jsonb,
  input            jsonb NOT NULL,                               -- synthetic data only
  expected_status  text NOT NULL DEFAULT 'OK' CHECK (expected_status IN ('OK','NO_MATCH','UNKNOWN')),
  expected_output  jsonb NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rule_set (tenant_id, id)
);
CREATE INDEX rule_test_case_set_idx ON rule_test_case (tenant_id, rule_set_id, active);
CREATE TRIGGER rule_test_case_touch BEFORE UPDATE ON rule_test_case FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE rule_validation_run (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  version_id     text NOT NULL,
  content_hash   text NOT NULL,
  result         text NOT NULL CHECK (result IN ('PASS','FAIL')),
  issues         jsonb NOT NULL DEFAULT '[]'::jsonb,
  tests_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_by         text NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id)
);
CREATE INDEX rule_validation_run_version_idx ON rule_validation_run (tenant_id, version_id, run_at DESC);

CREATE TABLE rule_approval (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenant(id),
  version_id               text NOT NULL,
  seat                     text NOT NULL CHECK (seat IN ('RULE_APPROVER','COMMISSION_APPROVER','COMPLIANCE','PLATFORM')),
  approver_id              text NOT NULL,
  action                   text NOT NULL CHECK (action IN ('APPROVE','REQUEST_CHANGES','REJECT')),
  comment                  text NOT NULL CHECK (char_length(comment) BETWEEN 3 AND 2000),
  content_hash             text NOT NULL,
  reviewed_simulation_ids  text[] NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id)
);
CREATE UNIQUE INDEX rule_approval_once_uq ON rule_approval (version_id, seat, approver_id) WHERE action = 'APPROVE';

CREATE TABLE rule_publication (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  version_id      text NOT NULL,
  action          text NOT NULL CHECK (action IN ('SEED','PUBLISH','SCHEDULE','SUSPEND','SUPERSEDE')),
  actor_id        text NOT NULL,
  reason          text NOT NULL,
  effective_from  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id)
);

CREATE TABLE rule_simulation (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  kind          text NOT NULL CHECK (kind IN ('MANUAL','TEST_SUITE')),
  version_id    text NOT NULL,
  content_hash  text NOT NULL,
  params        jsonb NOT NULL,
  status        text NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  summary       jsonb NOT NULL,                                  -- outputs, status, matched rules, trace
  requested_by  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, version_id) REFERENCES rule_set_version (tenant_id, id)
);

CREATE TABLE decision_record (                                   -- not partitioned in MVP (ADR-4D-03)
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  decision_key         text NOT NULL REFERENCES decision_definition(key),
  rule_set_version_id  text,
  subject_type         text NOT NULL,
  subject_id           text NOT NULL,
  evaluation_time      timestamptz NOT NULL,
  idempotency_key      text NOT NULL,
  input_hash           text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_snapshot       jsonb NOT NULL,                           -- derived S0–S2 facts only; no S3 in fact schemas
  outputs              jsonb,
  matched_rule_uids    text[] NOT NULL DEFAULT '{}',
  missing_fields       text[] NOT NULL DEFAULT '{}',
  status               text NOT NULL CHECK (status IN ('OK','NO_MATCH','UNKNOWN','ERROR','TIMEOUT','NO_VERSION')),
  fallback_applied     boolean NOT NULL,
  fallback_policy      text CHECK (fallback_policy IS NULL OR fallback_policy IN ('DEFAULT_OUTPUT','FAIL_CLOSED','MANUAL_REVIEW')),
  error_code           text,
  trace                jsonb,
  duration_us          integer NOT NULL CHECK (duration_us >= 0),
  correlation_id       text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (rule_set_version_id IS NOT NULL OR status IN ('NO_VERSION','ERROR')),
  FOREIGN KEY (tenant_id, rule_set_version_id) REFERENCES rule_set_version (tenant_id, id)
);
CREATE INDEX decision_record_subject_idx ON decision_record (tenant_id, subject_type, subject_id, created_at DESC);
CREATE INDEX decision_record_key_idx     ON decision_record (tenant_id, decision_key, created_at DESC);
CREATE INDEX decision_record_version_idx ON decision_record (tenant_id, rule_set_version_id, created_at DESC);
-- Idempotency: dedupe_registry(namespace 'DECISION', key = decision_key || ':' || idempotency_key) inserted in the same transaction.

CREATE TRIGGER rule_set_rule_append_only       BEFORE UPDATE OR DELETE ON rule_set_rule       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_validation_run_append_only BEFORE UPDATE OR DELETE ON rule_validation_run FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_approval_append_only       BEFORE UPDATE OR DELETE ON rule_approval       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_publication_append_only    BEFORE UPDATE OR DELETE ON rule_publication    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER rule_simulation_append_only     BEFORE UPDATE OR DELETE ON rule_simulation     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER decision_record_append_only     BEFORE UPDATE OR DELETE ON decision_record     FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CALL enable_tenant_rls('rule_set');            CALL enable_tenant_rls('rule_set_version');
CALL enable_tenant_rls('rule_set_rule');       CALL enable_tenant_rls('rule_test_case');
CALL enable_tenant_rls('rule_validation_run'); CALL enable_tenant_rls('rule_approval');
CALL enable_tenant_rls('rule_publication');    CALL enable_tenant_rls('rule_simulation');
CALL enable_tenant_rls('decision_record');

GRANT SELECT ON decision_definition TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON rule_set, rule_set_version, rule_test_case TO dsa_app;
GRANT SELECT, INSERT ON rule_set_rule, rule_validation_run, rule_approval, rule_publication, rule_simulation, decision_record TO dsa_app;
