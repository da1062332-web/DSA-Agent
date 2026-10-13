-- 0004_platform_membership_grants.sql  (owner: Dev 1, TASK-104)
-- Additive. Team and queue memberships are effective-dated and never deleted: removing a member closes its
-- effective_range. M-001 granted INSERT only, so the API could not end a membership. Column-level UPDATE keeps
-- every other column immutable.
SET search_path = app, extensions, public;

GRANT UPDATE (effective_range) ON team_membership, work_queue_member TO dsa_app;

-- Lookups used by the platform APIs and the principal resolver.
CREATE INDEX IF NOT EXISTS team_membership_user_idx    ON team_membership (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS work_queue_member_user_idx  ON work_queue_member (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS work_queue_member_queue_idx ON work_queue_member (tenant_id, queue_id);
