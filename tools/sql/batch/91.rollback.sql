-- Roll back migration 0091: REFUSED. Nothing is changed by this file.
-- 0091 removes public write access, removes the broad anon grants, and drops app.authenticate_user. Restoring those grants would
-- reopen the exposure recorded in docs/AUDIT_REPORT_2026-10-26.md. If a fix is needed, make a forward migration instead.
DO $$
BEGIN
  RAISE EXCEPTION 'rollback of 0091 is refused: it would restore the exposure in docs/AUDIT_REPORT_2026-10-26.md. Use a forward migration.';
END $$;
