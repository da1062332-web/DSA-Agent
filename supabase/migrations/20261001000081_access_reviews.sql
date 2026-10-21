-- Migration: 20261001000081_access_reviews.sql
-- Owner: Dev 1 (MOD-ACL SUB-ACL.04; API-ACL-005, API-ACL-006)
-- Access certification campaigns. Doc 10.1 has no entity for them; these two tables hold the campaign and one item per role
-- assignment in force when it started. A REVOKE decision ends the assignment (user_role_assignment keeps it as history);
-- SOD-10: a reviewer never decides an item about their own access.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS access_review (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  branch_ids    text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  due_at        timestamptz NOT NULL,
  item_count    integer NOT NULL DEFAULT 0,
  closed_at     timestamptz,
  lock_version  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE TRIGGER access_review_touch BEFORE UPDATE ON access_review FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('access_review');
GRANT SELECT, INSERT, UPDATE ON access_review TO dsa_app;

CREATE TABLE IF NOT EXISTS access_review_item (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  review_id      text NOT NULL,
  assignment_id  text NOT NULL,
  user_id        text NOT NULL,
  role_id        text NOT NULL,
  scope_type     text NOT NULL,
  decision       text CHECK (decision IS NULL OR decision IN ('CERTIFY','REVOKE')),
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 200),
  decided_by     text,
  decided_at     timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (review_id, assignment_id),
  FOREIGN KEY (tenant_id, review_id) REFERENCES access_review (tenant_id, id),
  CHECK ((decision IS NULL) = (decided_by IS NULL) AND (decision IS NULL) = (decided_at IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> user_id)                -- SOD-10
);
CREATE INDEX IF NOT EXISTS access_review_item_review_idx ON access_review_item (tenant_id, review_id, decision);
CALL enable_tenant_rls('access_review_item');
GRANT SELECT, INSERT ON access_review_item TO dsa_app;
GRANT UPDATE (decision, reason, decided_by, decided_at) ON access_review_item TO dsa_app;
