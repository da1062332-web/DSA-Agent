-- 02: delete the disposable test rows of the three test tenants. WRITES. One transaction.
-- Safety: aborts unless the three tenants are exactly the expected DSA_ORG test tenants (by slug). Candidate tables are deleted children
-- first, ordered from the foreign keys. A table that refuses (an append-only trigger, a foreign key from a row that stays) is skipped and
-- reported, never forced. Nothing outside the candidate list is touched, and no other tenant is read or changed.
BEGIN;
SET LOCAL search_path = app, public;
CREATE TEMP TABLE cleanup_result (seq serial, table_name text, deleted bigint, skipped text) ON COMMIT DROP;
DO $cleanup$
DECLARE
  allowed_slugs constant text[] := ARRAY['test-dsa-alpha', 'test-dsa-beta', 'test-tenant-b'];
  candidates    constant text[] := ARRAY['activity', 'message_template', 'dedupe_registry', 'notification', 'idempotency_key', 'connector', 'message', 'outbox_event', 'public_entry_index', 'upload_link', 'payout_request', 'lender_statement', 'lender_statement_line', 'commission_calculation', 'commission_payable', 'payout_line', 'connector_bank_account', 'import_batch', 'lead', 'attribution_change_request', 'reconciliation_match', 'data_correction_request', 'support_access_grant', 'lender'];
  test_ids  text[];
  remaining text[] := candidates;
  ordered   text[] := '{}';
  t text;
  n bigint;
  progressed boolean;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO test_ids FROM app.tenant WHERE slug = ANY (allowed_slugs) AND tenant_type = 'DSA_ORG';
  IF test_ids IS NULL OR cardinality(test_ids) <> cardinality(allowed_slugs) THEN
    RAISE EXCEPTION 'Aborted: the expected test tenants were not found exactly (%).', coalesce(cardinality(test_ids), 0);
  END IF;

  WHILE cardinality(remaining) > 0 LOOP
    progressed := false;
    FOREACH t IN ARRAY remaining LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_class child  ON child.oid  = c.conrelid
          JOIN pg_class parent ON parent.oid = c.confrelid
         WHERE c.contype = 'f' AND parent.relnamespace = 'app'::regnamespace AND parent.relname = t
           AND child.relnamespace = 'app'::regnamespace AND child.relname = ANY (remaining) AND child.relname <> t
      ) THEN
        ordered := ordered || t;
        remaining := array_remove(remaining, t);
        progressed := true;
      END IF;
    END LOOP;
    IF NOT progressed THEN ordered := ordered || remaining; remaining := '{}'; END IF;
  END LOOP;

  FOREACH t IN ARRAY ordered LOOP
    BEGIN
      EXECUTE format('DELETE FROM app.%I WHERE tenant_id = ANY ($1)', t) USING test_ids;
      GET DIAGNOSTICS n = ROW_COUNT;
      INSERT INTO cleanup_result (table_name, deleted) VALUES (t, n);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO cleanup_result (table_name, deleted, skipped) VALUES (t, 0, SQLERRM);
    END;
  END LOOP;
END
$cleanup$;
SELECT seq, table_name, deleted, skipped FROM cleanup_result ORDER BY seq;
COMMIT;
