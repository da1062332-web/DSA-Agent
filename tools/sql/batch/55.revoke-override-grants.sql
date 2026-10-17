-- Optional, and the quick answer to decision D1: remove only the eligibility.override grants that 0055 made, keep the rules.
-- Run it right after 0055 if the owner decides that these four roles should not be the approvers.
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.role_permission WHERE permission_code = 'eligibility.override';
COMMIT;
