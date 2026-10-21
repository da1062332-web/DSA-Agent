-- Verify migration 0074 (lead apply links and duplicate reviews). Read-only. Expect every row PASS.
SELECT 'apply_link and duplicate_review exist with forced row-level security' AS check,
       CASE WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('app.apply_link'), to_regclass('app.duplicate_review')) AND relrowsecurity AND relforcerowsecurity) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL SELECT 'lead has merged_into_id and archived_at with their checks',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lead' AND column_name = 'merged_into_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'lead' AND column_name = 'archived_at') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.lead') AND conname = 'lead_merged_into_check') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.lead') AND conname = 'lead_archived_at_check') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'one open review per pair',
       CASE WHEN to_regclass('app.duplicate_review_open_pair_uq') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'resolve_public_apply_link exists and runs as its owner',
       CASE WHEN coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.resolve_public_apply_link(text)')), false) THEN 'PASS' ELSE 'FAIL' END;
