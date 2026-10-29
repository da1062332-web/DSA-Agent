-- Roll back migration 0088: drop platform_support_view.
-- Run after 0089 is rolled back, because 0089 replaces this function. The function stores no data, and support_access_grant is not changed here.
BEGIN;
DROP FUNCTION IF EXISTS app.platform_support_view(text, text);
COMMIT;
