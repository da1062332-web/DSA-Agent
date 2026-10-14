-- 0029_application_hold.sql  (owner: Dev 3, MOD-APP Loan Applications, DSA Notion MODULE 16, API-APP-010)
-- Additive. Adds the hold fields the spec defines on ENT-045 and that 0021 does not have. A held application keeps its
-- status; the hold only tells operations that work is paused, and why, until a date. A hold always carries a reason.
SET search_path = app, extensions, public;

ALTER TABLE loan_application ADD COLUMN on_hold     boolean NOT NULL DEFAULT false;
ALTER TABLE loan_application ADD COLUMN hold_reason text;
ALTER TABLE loan_application ADD COLUMN hold_until  timestamptz;
ALTER TABLE loan_application ADD CONSTRAINT loan_application_hold_reason_required
  CHECK (NOT on_hold OR hold_reason IS NOT NULL);
ALTER TABLE loan_application ADD CONSTRAINT loan_application_hold_clear_fields
  CHECK (on_hold OR (hold_reason IS NULL AND hold_until IS NULL));
