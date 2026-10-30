-- Roll back migration 0093: drop the worker's function, its index, its constraint and its six columns.
-- Refuses, and changes nothing, if any invitation has delivery activity (a worker has claimed it, tried it, or sent it).
BEGIN;
DO $$
BEGIN
  IF to_regclass('app.staff_invitation') IS NULL THEN
    RAISE NOTICE 'app.staff_invitation is absent; nothing to do';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM app.staff_invitation
              WHERE delivery_state <> 'QUEUED' OR delivery_attempts > 0 OR claimed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'staff invitations have delivery activity; rollback refused, nothing was changed';
  END IF;
  DROP FUNCTION IF EXISTS app.pending_staff_invitation_deliveries(integer, integer);
  DROP INDEX IF EXISTS app.staff_invitation_delivery_due;
  ALTER TABLE app.staff_invitation DROP CONSTRAINT IF EXISTS staff_invitation_claim_held;
  ALTER TABLE app.staff_invitation
    DROP COLUMN IF EXISTS delivery_state,
    DROP COLUMN IF EXISTS delivery_attempts,
    DROP COLUMN IF EXISTS requested_at,
    DROP COLUMN IF EXISTS next_attempt_at,
    DROP COLUMN IF EXISTS claimed_at,
    DROP COLUMN IF EXISTS claimed_by;
END $$;
COMMIT;
