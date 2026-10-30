-- Roll back migration 0092: drop app.staff_invitation.
-- Refuses, and changes nothing, if the table has rows, or if migration 0093's objects are present (roll 0093 back first).
BEGIN;
DO $$
BEGIN
  IF to_regclass('app.staff_invitation') IS NULL THEN
    RAISE NOTICE 'app.staff_invitation is absent; nothing to do';
    RETURN;
  END IF;
  IF to_regprocedure('app.pending_staff_invitation_deliveries(integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'migration 0093 is still present; roll 0093 back first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM app.staff_invitation) THEN
    RAISE EXCEPTION 'app.staff_invitation has rows; rollback refused, nothing was changed';
  END IF;
  DROP TABLE app.staff_invitation;
END $$;
COMMIT;
