-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §3.
-- Owner (v1.2 Assignment Matrix §3): Dev 1. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0001_platform_core.sql  (owner: Dev 1, TASK-103)
CREATE TABLE tenant (
  id           text PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  legal_name   text NOT NULL,
  tenant_type  text NOT NULL CHECK (tenant_type IN ('DSA_ORG','NBFC_DISTRIBUTION')),
  data_region  text NOT NULL DEFAULT 'IN',
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata',
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','OFFBOARDING')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL
);
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant USING (id = app_tenant()) WITH CHECK (id = app_tenant());

CREATE TABLE organisation (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  legal_name    text NOT NULL,
  constitution  text NOT NULL CHECK (constitution IN ('PROPRIETORSHIP','PARTNERSHIP','LLP','PVT_LTD','PUBLIC_LTD','TRUST','OTHER')),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  lock_version  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id)
);   -- business PAN/GSTIN/CIN deferred (S3; TASK-421)

CREATE TABLE branch (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  organisation_id  text NOT NULL,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name             text NOT NULL,
  pincode          char(6) CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES organisation (tenant_id, id)
);

CREATE TABLE app_user (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  idp_subject        text NOT NULL UNIQUE,
  email              citext NOT NULL,
  mobile_e164        text CHECK (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name       text NOT NULL,
  user_type          text NOT NULL DEFAULT 'STAFF' CHECK (user_type IN ('STAFF')),   -- CONNECTOR added by TASK-417 (AG-19)
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED')),
  availability       text NOT NULL DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE','BUSY','OFF_DUTY','ON_LEAVE')),
  primary_branch_id  text NOT NULL,
  lock_version       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email),
  FOREIGN KEY (tenant_id, primary_branch_id) REFERENCES branch (tenant_id, id)
);

CREATE TABLE team (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  name             text NOT NULL,
  branch_id        text,                      -- NULL = cross-branch functional team
  manager_user_id  text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branch (tenant_id, id),
  FOREIGN KEY (tenant_id, manager_user_id) REFERENCES app_user (tenant_id, id)
);

CREATE TABLE team_membership (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  team_id          text NOT NULL,
  user_id          text NOT NULL,
  effective_range  tstzrange NOT NULL DEFAULT tstzrange(now(), NULL, '[)'),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  FOREIGN KEY (tenant_id, team_id) REFERENCES team (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
  EXCLUDE USING gist (tenant_id WITH =, team_id WITH =, user_id WITH =, effective_range WITH &&)
);

CREATE TABLE permission (                    -- global catalogue (FR-ACL-001); no tenant_id, no RLS
  code           text PRIMARY KEY CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description    text NOT NULL,
  introduced_in  text NOT NULL
);

CREATE TABLE role (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  code         text NOT NULL CHECK (code ~ '^ROLE-[A-Z-]+$'),
  name         text NOT NULL,
  is_template  boolean NOT NULL DEFAULT true,
  version      integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE role_permission (
  tenant_id        text NOT NULL REFERENCES tenant(id),
  role_id          text NOT NULL,
  permission_code  text NOT NULL REFERENCES permission(code),
  PRIMARY KEY (role_id, permission_code),
  FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, id)
);

CREATE TABLE user_role_assignment (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  user_id           text NOT NULL,
  role_id           text NOT NULL,
  scope_type        text NOT NULL CHECK (scope_type IN ('OWN','TEAM','BRANCH','TENANT')),
  scope_branch_ids  text[] NOT NULL DEFAULT '{}',
  effective_range   tstzrange NOT NULL DEFAULT tstzrange(now(), NULL, '[)'),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  CHECK ((scope_type = 'BRANCH') = (cardinality(scope_branch_ids) > 0)),
  CHECK (created_by <> user_id),                                   -- SOD-05
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, id)
);
CREATE INDEX user_role_assignment_user_idx ON user_role_assignment (tenant_id, user_id);

CREATE TABLE work_queue (                                         -- ENT-113 (AG-01)
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,40}$'),
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('INTAKE','UNASSIGNED','TEAM','FUNCTIONAL','EXCEPTION')),
  branch_id      text,
  team_id        text,
  record_types   text[] NOT NULL CHECK (cardinality(record_types) > 0 AND record_types <@ ARRAY['LEAD','APPLICATION','TASK']),
  routing_state  jsonb NOT NULL DEFAULT '{}'::jsonb,              -- {"rrLastUserId":"usr_…"}; only UserDirectoryPort.pickRoundRobin writes it
  active         boolean NOT NULL DEFAULT true,
  lock_version   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (kind NOT IN ('INTAKE','UNASSIGNED') OR branch_id IS NOT NULL),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branch (tenant_id, id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES team (tenant_id, id)
);
CREATE UNIQUE INDEX work_queue_one_intake_uq     ON work_queue (tenant_id, branch_id) WHERE kind = 'INTAKE';
CREATE UNIQUE INDEX work_queue_one_unassigned_uq ON work_queue (tenant_id, branch_id) WHERE kind = 'UNASSIGNED';

CREATE TABLE work_queue_member (                                  -- ENT-114
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  queue_id         text NOT NULL,
  user_id          text NOT NULL,
  can_pick         boolean NOT NULL DEFAULT true,
  can_assign       boolean NOT NULL DEFAULT false,
  effective_range  tstzrange NOT NULL DEFAULT tstzrange(now(), NULL, '[)'),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  FOREIGN KEY (tenant_id, queue_id) REFERENCES work_queue (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id),
  EXCLUDE USING gist (tenant_id WITH =, queue_id WITH =, user_id WITH =, effective_range WITH &&)
);

CREATE TRIGGER organisation_touch BEFORE UPDATE ON organisation FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER branch_touch       BEFORE UPDATE ON branch       FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER app_user_touch     BEFORE UPDATE ON app_user     FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER team_touch         BEFORE UPDATE ON team         FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER work_queue_touch   BEFORE UPDATE ON work_queue   FOR EACH ROW EXECUTE FUNCTION touch_row();

CALL enable_tenant_rls('organisation');      CALL enable_tenant_rls('branch');
CALL enable_tenant_rls('app_user');          CALL enable_tenant_rls('team');
CALL enable_tenant_rls('team_membership');   CALL enable_tenant_rls('role');
CALL enable_tenant_rls('role_permission');   CALL enable_tenant_rls('user_role_assignment');
CALL enable_tenant_rls('work_queue');        CALL enable_tenant_rls('work_queue_member');

GRANT SELECT ON permission TO dsa_app;
GRANT SELECT, INSERT ON tenant TO dsa_app;                       -- INSERT used only by the provisioning CLI path
GRANT SELECT, INSERT, UPDATE ON organisation, branch, app_user, team, work_queue TO dsa_app;
GRANT SELECT, INSERT ON team_membership, role, role_permission, user_role_assignment, work_queue_member TO dsa_app;

INSERT INTO permission (code, description, introduced_in) VALUES
 ('lead.read','Read leads in scope','MVP-4D'), ('lead.create','Create leads','MVP-4D'),
 ('lead.update','Update leads, log contact effects','MVP-4D'), ('lead.qualify','Qualify or disqualify leads','MVP-4D'),
 ('lead.assign','Assign leads (API in TASK-409)','MVP-4D'),
 ('customer.read','Read customers in derived scope','MVP-4D'), ('consent.record','Record or withdraw consent','MVP-4D'),
 ('activity.create','Log interactions','MVP-4D'),
 ('task.read','Read tasks','MVP-4D'), ('task.create','Create tasks','MVP-4D'), ('task.update','Complete or update tasks','MVP-4D'),
 ('application.read','Read applications','MVP-4D'), ('application.create','Create applications / convert leads','MVP-4D'),
 ('application.update','Update applications, generate checklist','MVP-4D'), ('application.review','Internal review transitions','MVP-4D'),
 ('application.cancel','Cancel applications','MVP-4D'),
 ('document.review','Accept or reject checklist items (interim PA-03)','MVP-4D'),
 ('lender_case.submit','Create, package and submit lender cases','MVP-4D'), ('lender_case.update_status','Record lender status updates','MVP-4D'),
 ('rule.author','Author rule drafts','MVP-4D'), ('rule.simulate','Simulate rules, read decision records','MVP-4D'),
 ('rule.approve','Review rule versions','MVP-4D'), ('rule.publish','Publish rule versions','MVP-4D'), ('rule.suspend','Emergency suspend','MVP-4D'),
 ('audit.read','Search audit events','MVP-4D'), ('config.manage','Manage configuration','MVP-4D'), ('user.manage','Manage users','MVP-4D');
