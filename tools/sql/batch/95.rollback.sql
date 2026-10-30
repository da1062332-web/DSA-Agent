-- Roll back migration 0095: give EXECUTE back to PUBLIC on the 24 routines that PUBLIC could run on 2026-10-29.
-- WARNING: this reopens the grant that 0095 removes, so anon and authenticated can execute these routines again. Run only with the same approval.
-- The explicit dsa_app grants from 0095 are left in place (dsa_app keeps every right it had).
BEGIN;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.prokind, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname IN ('app_tenant', 'application_party_remove_only', 'apply_attribution_change',
                         'audit_event_seal_guard', 'check_journal_balance', 'consent_only_withdraw',
                         'document_version_content_guard', 'enable_tenant_rls', 'forbid_delete',
                         'forbid_mutation', 'is_platform_realm', 'lead_attribution_immutable',
                         'ledger_journal_guard', 'lender_query_answer_once', 'message_template_guard',
                         'new_ulid', 'package_freeze_guard', 'platform_require_realm',
                         'product_version_terms_immutable', 'role_guard', 'role_permission_guard',
                         'rsv_immutable_after_draft', 'touch_row', 'user_role_assignment_close_only')
  LOOP
    EXECUTE format('GRANT EXECUTE ON %s %I.%I(%s) TO PUBLIC',
                   CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.nspname, r.proname, r.args);
  END LOOP;
END $$;
COMMIT;
