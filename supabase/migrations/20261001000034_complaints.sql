-- 0034_complaints.sql  (owner: Dev 3, MOD-GRV Grievances, DSA Notion MODULE 13, ENT-034)
-- Additive. Records customer complaints against a lead or an application, acknowledges them and drives resolution.
-- Customer linking waits for MOD-CUST (Dev 5); until then the complainant is a lead or an application of the tenant.
-- Complaints are never deleted. A resolved complaint that is reopened keeps its history in the audit trail.
SET search_path = app, extensions, public;

CREATE TABLE complaint (                                           -- ENT-034
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  complainant_type text NOT NULL CHECK (complainant_type IN ('LEAD','APPLICATION')),
  complainant_id   text NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('PHONE','EMAIL','BRANCH','WEB','LENDER','OTHER')),
  category         text NOT NULL CHECK (category IN ('SERVICE','PROCESS','CHARGES','COLLECTION','DATA_PRIVACY','OTHER')),
  description      text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  owner_user_id    text,
  due_at           timestamptz,
  ack_ref          text NOT NULL,
  lender_referral  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(lender_referral) = 'object'),
  resolution       text,
  resolved_at      timestamptz,
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ack_ref),
  CHECK (status <> 'RESOLVED' OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES app_user (tenant_id, id)
);
CREATE INDEX complaint_queue_idx ON complaint (tenant_id, status, owner_user_id);

CREATE TRIGGER complaint_touch BEFORE UPDATE ON complaint FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('complaint');
GRANT SELECT, INSERT, UPDATE ON complaint TO dsa_app;

-- Permissions for MOD-GRV. complaint.create: any staff who log complaints. complaint.manage: handlers who assign,
-- refer, resolve and reopen. ROLE-COMPLIANCE does not exist in the seed roles yet; it is granted in a later migration.
INSERT INTO permission (code, description, introduced_in) VALUES
  ('complaint.create', 'Record customer complaints', 'MOD-GRV'),
  ('complaint.manage', 'Assign, refer, resolve and reopen complaints', 'MOD-GRV')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'complaint.create'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR', 'ROLE-AGENT')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'complaint.manage'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR')
ON CONFLICT DO NOTHING;
