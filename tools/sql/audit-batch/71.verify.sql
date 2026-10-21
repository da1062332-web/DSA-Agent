-- Verify migration 0071 (documents). Read-only. Expect every row PASS.
SELECT 'the eight document tables exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.document_type'), to_regclass('app.document'), to_regclass('app.document_version'), to_regclass('app.document_review'), to_regclass('app.document_access_log'), to_regclass('app.upload_intent'), to_regclass('app.legal_hold'), to_regclass('app.document_archive')) AND relrowsecurity AND relforcerowsecurity) = 8 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'version content is immutable (trigger)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.document_version') AND tgname = 'document_version_content_guard' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'reviews and the access log are append-only',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.document_review') AND tgname = 'document_review_append_only' AND NOT tgisinternal) AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.document_access_log') AND tgname = 'document_access_log_append_only' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'resolve_upload_intent exists and runs as its owner',
       CASE WHEN coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.resolve_upload_intent(text)')), false) THEN 'PASS' ELSE 'FAIL' END;
