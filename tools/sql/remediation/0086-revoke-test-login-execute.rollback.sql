-- PROPOSED, NOT APPLIED. Restores the grants recorded on hosted on 2026-10-29 (docs/HOSTED_STATUS_2026-10-29.md).
-- WARNING: this gives EXECUTE back to PUBLIC, which reaches anon and authenticated. Use it only to undo the revoke, and only with the same approval.
-- One transaction.

BEGIN;

GRANT EXECUTE ON FUNCTION app.lookup_test_user(text) TO PUBLIC, dsa_app, dsa_api;
GRANT EXECUTE ON FUNCTION app.list_test_users() TO PUBLIC, dsa_app, dsa_api;

COMMIT;
