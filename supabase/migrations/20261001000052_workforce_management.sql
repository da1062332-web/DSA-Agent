-- 20261001000046_workforce_management.sql
-- Module 26: Workforce (MOD-WRK, DOM-I)
-- Tables: delegation (ENT-038), attendance_record (ENT-039), and app_user capacity (ENT-005)

SET search_path = app, extensions, public;

-- 1. ENT-005: Add capacity to app_user if missing
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 10 CHECK (capacity >= 0);

-- 2. ENT-038: Leave Coverage Delegations
CREATE TABLE IF NOT EXISTS delegation (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  delegator_id text NOT NULL,
  delegate_id  text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  reason       text,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  lock_version integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  CHECK (delegator_id <> delegate_id),
  CHECK (starts_at < ends_at),
  FOREIGN KEY (tenant_id, delegator_id) REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, delegate_id) REFERENCES app_user (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS delegation_tenant_delegator_idx ON delegation (tenant_id, delegator_id, status);
CREATE INDEX IF NOT EXISTS delegation_tenant_delegate_idx ON delegation (tenant_id, delegate_id, status);

ALTER TABLE delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'delegation' AND policyname = 'delegation_tenant_isolation'
  ) THEN
    CREATE POLICY delegation_tenant_isolation ON delegation
      FOR ALL
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON delegation TO dsa_app;

-- 3. ENT-039: Attendance Records
CREATE TABLE IF NOT EXISTS attendance_record (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  user_id       text NOT NULL,
  date          date NOT NULL,
  check_in      timestamptz,
  check_out     timestamptz,
  status        text NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'HALF_DAY', 'ON_LEAVE', 'ABSENT')),
  notes         text,
  correction_of text REFERENCES attendance_record(id),
  approved_by   text,
  lock_version  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  UNIQUE (tenant_id, user_id, date),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS attendance_tenant_user_date_idx ON attendance_record (tenant_id, user_id, date);

ALTER TABLE attendance_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_record FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'attendance_record' AND policyname = 'attendance_tenant_isolation'
  ) THEN
    CREATE POLICY attendance_tenant_isolation ON attendance_record
      FOR ALL
      USING (tenant_id = app_tenant())
      WITH CHECK (tenant_id = app_tenant());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON attendance_record TO dsa_app;

-- 4. Permissions and Role Grants
INSERT INTO permission (code, description, introduced_in) VALUES
  ('attendance.manage', 'Manage, view, and correct workforce attendance records', 'MOD-WRK')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'attendance.manage'
FROM role r
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-BRANCH-MGR', 'ROLE-TEAM-MGR')
ON CONFLICT DO NOTHING;
