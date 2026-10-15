-- 20261001000028_targets.sql (owner: Dev 5, TASK-428, MOD-PERF SUB-PERF.01 Targets, ENT-037)
-- Additive. Targets represent operational performance commitments per slice: period + dimension + metric.
-- Target lifecycle: PENDING_APPROVAL -> APPROVED -> SUPERSEDED (or REJECTED).
-- Dual-control: Creator cannot approve their own target (SOD-04).
SET search_path = app, extensions, public;

CREATE TABLE target (                                              -- ENT-037
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  period           text NOT NULL,                                  -- YYYY-MM or YYYY-Q#
  dimension_type   text NOT NULL CHECK (dimension_type IN ('BRANCH', 'USER', 'PRODUCT')),
  dimension_id     text NOT NULL,                                  -- branch id, app_user id, or loan_product id
  metric_code      text NOT NULL CHECK (metric_code IN ('DISBURSEMENT_AMOUNT', 'LEAD_COUNT', 'SANCTION_COUNT')),
  target_value     numeric(15,2) NOT NULL CHECK (target_value >= 0),
  unit             text NOT NULL CHECK (unit IN ('INR', 'COUNT')),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status           text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
  lock_version     integer NOT NULL DEFAULT 0,
  created_by       text NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  approved_by      text REFERENCES app_user(id),
  approved_at      timestamptz,
  rejection_reason text,

  UNIQUE (tenant_id, id),
  CHECK (approved_by IS NULL OR approved_by <> created_by),       -- SOD-04 separation of duties
  CHECK (
    (metric_code = 'DISBURSEMENT_AMOUNT' AND unit = 'INR') OR
    (metric_code IN ('LEAD_COUNT', 'SANCTION_COUNT') AND unit = 'COUNT')
  ),
  CHECK (
    (status IN ('APPROVED', 'REJECTED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR
    (status = 'PENDING_APPROVAL' AND approved_by IS NULL) OR
    (status = 'SUPERSEDED')
  )
);

-- At most one APPROVED target per tenant + slice
CREATE UNIQUE INDEX target_current_approved_idx
  ON target (tenant_id, period, dimension_type, dimension_id, metric_code)
  WHERE (status = 'APPROVED');

-- Unique version per tenant + slice
CREATE UNIQUE INDEX target_slice_version_uq
  ON target (tenant_id, period, dimension_type, dimension_id, metric_code, version);

-- Query and filtering index
CREATE INDEX target_lookup_idx
  ON target (tenant_id, period, dimension_type, dimension_id, metric_code, status);

CREATE TRIGGER target_touch BEFORE UPDATE ON target FOR EACH ROW EXECUTE FUNCTION touch_row();

CALL enable_tenant_rls('target');
GRANT SELECT, INSERT, UPDATE ON target TO dsa_app;

-- Seed permissions for MOD-PERF SUB-PERF.01
INSERT INTO permission (code, description, introduced_in) VALUES
  ('target.manage', 'Create, revise, and approve performance targets', 'MOD-PERF'),
  ('report.read', 'Read performance and analytical reports', 'MOD-PERF')
ON CONFLICT (code) DO NOTHING;

-- Grant target.manage to admin and management roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'target.manage'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR')
ON CONFLICT DO NOTHING;

-- Grant report.read to staff roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'report.read'
  FROM role r
 WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR', 'ROLE-AGENT', 'ROLE-READONLY')
ON CONFLICT DO NOTHING;
