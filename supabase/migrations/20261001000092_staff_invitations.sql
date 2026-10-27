-- Migration: 20261001000092_staff_invitations.sql
-- Owner: Dev 1 (platform; API-USR-001 staff invitations). To confirm in supabase/MANIFEST.md.
--   One row per invitation. A user has at most one PENDING invitation at a time (partial unique index), and each resend updates
--   that row rather than adding one, so the resend limit and cooldown are enforced on a single count.
--   Status: PENDING (link sent, not yet used), EXPIRED (past expires_at), ACCEPTED (the invitee signed in with a password),
--   REVOKED (reserved; no code path sets it yet).
--   Expiry is enforced at sign-in as well as shown here: an expired invitation cannot activate the user.
--   The table is append-friendly: no DELETE is granted to the application role.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS staff_invitation (
  id            text PRIMARY KEY CHECK (id ~ '^inv_[A-Za-z0-9_-]{6,40}$'),
  tenant_id     text NOT NULL REFERENCES tenant(id),
  user_id       text NOT NULL REFERENCES app_user(id),
  status        text NOT NULL CHECK (status IN ('PENDING','EXPIRED','ACCEPTED','REVOKED')),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  resend_count  integer NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  last_failure  text CHECK (last_failure IS NULL OR char_length(last_failure) <= 64),
  lock_version  integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'ACCEPTED' OR accepted_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_one_pending
  ON staff_invitation (user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS staff_invitation_by_user ON staff_invitation (tenant_id, user_id);

CREATE TRIGGER staff_invitation_touch BEFORE UPDATE ON staff_invitation FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('staff_invitation');
GRANT SELECT, INSERT, UPDATE ON staff_invitation TO dsa_app;
