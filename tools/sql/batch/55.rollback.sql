-- Roll back migration 0055: the eligibility.override grants are removed and the seeded eligibility rules are taken out of service.
-- Rule versions, their rules and decision records are append-only by design (audit), so they are NOT deleted: the seeded versions are
-- RETIRED and their rule sets ARCHIVED. With no active version the decision falls back to its default output (REFER), which is what
-- happened before 0055. The decision definition is left alone (0054 also inserts it; removing it is 0054's rollback).
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.role_permission WHERE permission_code = 'eligibility.override';
UPDATE app.rule_set_version SET status = 'RETIRED'
 WHERE id LIKE 'rsv_elg_%' AND created_by = 'SYSTEM:platform' AND status = 'ACTIVE';
UPDATE app.rule_set SET status = 'ARCHIVED'
 WHERE id LIKE 'rs_elg_%' AND created_by = 'SYSTEM:platform' AND status = 'ACTIVE';
COMMIT;
