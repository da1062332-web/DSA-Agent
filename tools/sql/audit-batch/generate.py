import os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def tables_rls(names):
    lst = ", ".join(f"to_regclass('app.{n}')" for n in names)
    return (f"(SELECT count(*) FROM pg_class WHERE oid IN ({lst}) AND relrowsecurity AND relforcerowsecurity) = {len(names)}")


def verify(n, title, checks):
    lines = [f"-- Verify migration 00{n} ({title}). Read-only. Expect every row PASS."]
    first = True
    for label, cond in checks:
        label = label.replace("'", "''")
        if first:
            lines.append(f"SELECT '{label}' AS check,\n       CASE WHEN {cond} THEN 'PASS' ELSE 'FAIL' END AS result")
            first = False
        else:
            lines.append(f"UNION ALL SELECT '{label}',\n       CASE WHEN {cond} THEN 'PASS' ELSE 'FAIL' END")
    open(os.path.join(OUT, f"{n}.verify.sql"), "w", encoding="utf8", newline="\n").write("\n".join(lines) + ";\n")


def refuse_rows(tables):
    out = []
    for t in tables:
        out.append(
            f"  IF to_regclass('app.{t}') IS NOT NULL THEN\n"
            f"    IF EXISTS (SELECT 1 FROM app.{t}) THEN\n"
            f"      RAISE EXCEPTION 'Rollback aborted: app.{t} holds rows. Manual review required.';\n    END IF;\n  END IF;"
        )
    return out


def refuse_if(cond, message):
    # "<object exists> AND <data check>": the data check is nested, so PL/pgSQL never plans it against a missing column or table.
    guard, sep, data = cond.partition(" AND EXISTS (SELECT 1 FROM app.")
    if not sep:
        return f"  IF {cond} THEN\n    RAISE EXCEPTION 'Rollback aborted: {message} Manual review required.';\n  END IF;"
    data = "EXISTS (SELECT 1 FROM app." + data
    return (f"  IF {guard} THEN\n    IF {data} THEN\n"
            f"      RAISE EXCEPTION 'Rollback aborted: {message} Manual review required.';\n    END IF;\n  END IF;")


def rollback(n, header, guards, body):
    s = [f"-- Roll back migration 00{n}. {header}", "BEGIN;", "SET search_path = app, extensions, public;"]
    if guards:
        s += ["DO $$", "BEGIN"] + guards + ["END $$;"]
    s += body
    s += ["COMMIT;"]
    open(os.path.join(OUT, f"{n}.rollback.sql"), "w", encoding="utf8", newline="\n").write("\n".join(s) + "\n")


def count_rows(table, where):
    """Row count without naming the table in the statement, so verify answers FAIL (0), not an error, once the table is gone."""
    q = f"SELECT count(*) AS c FROM app.{table} WHERE {where}".replace("'", "''")
    return (f"CASE WHEN to_regclass('app.{table}') IS NULL THEN 0 "
            f"ELSE (xpath('/row/c/text()', query_to_xml('{q}', false, true, '')))[1]::text::int END")


col = lambda t, c: f"EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = '{t}' AND column_name = '{c}')"
fn = lambda sig: f"to_regprocedure('app.{sig}') IS NOT NULL"
con = lambda t, c: f"EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.{t}') AND conname = '{c}')"
trg = lambda t, g: f"EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('app.{t}') AND tgname = '{g}' AND NOT tgisinternal)"
secdef = lambda sig: f"coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('app.{sig}')), false)"
tblpriv = lambda t, p: f"coalesce(has_table_privilege('dsa_app', to_regclass('app.{t}'), '{p}'), false)"
colpriv = lambda t, c, p: (f"coalesce((SELECT has_column_privilege('dsa_app', a.attrelid, a.attnum, '{p}') FROM pg_attribute a "
                           f"WHERE a.attrelid = to_regclass('app.{t}') AND a.attname = '{c}' AND NOT a.attisdropped), false)")

# ---- 0066 lender_query
verify("66", "lender queries", [
    ("table lender_query exists with forced row-level security", tables_rls(["lender_query"])),
    ("a query is answered once (trigger)", trg("lender_query", "lender_query_answer_once_guard")),
    ("dsa_app may read, insert and update queries", f"{tblpriv('lender_query', 'SELECT')} AND {tblpriv('lender_query', 'INSERT')} AND {tblpriv('lender_query', 'UPDATE')}"),
])
rollback("66", "The table is dropped only when empty.", refuse_rows(["lender_query"]), [
    "DROP TABLE IF EXISTS app.lender_query;",
    "DROP FUNCTION IF EXISTS app.lender_query_answer_once();",
])

# ---- 0069 platform queue operations
QUEUES69 = count_rows("worker_queue_state", "queue IN ('outbox-relay', 'job-queue')")
verify("69", "platform queue operations", [
    ("worker_queue_state holds the two queues, with forced row-level security",
     f"{tables_rls(['worker_queue_state'])} AND {QUEUES69} = 2"),
    ("outbox_event.discarded_at exists and dsa_app may set it", f"{col('outbox_event', 'discarded_at')} AND {colpriv('outbox_event', 'discarded_at', 'UPDATE')}"),
    ("the platform queue functions exist and run as their owner",
     f"{secdef('platform_queue_stats()')} AND {secdef('platform_dead_letters(integer)')} AND {secdef('platform_dead_letter_action(text, text)')}"),
    ("pending_outbox_events skips discarded events",
     "coalesce(position('discarded_at' in pg_get_functiondef(to_regprocedure('app.pending_outbox_events(integer)'))) > 0, false)"),
])
rollback("69", "Refused while an event is discarded (that state would be lost); pending_outbox_events goes back to its 0067 body.",
         [refuse_if("EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'outbox_event' AND column_name = 'discarded_at') AND EXISTS (SELECT 1 FROM app.outbox_event WHERE discarded_at IS NOT NULL)",
                    "some outbox events are discarded."),
          refuse_if("to_regclass('app.worker_queue_state') IS NOT NULL AND EXISTS (SELECT 1 FROM app.worker_queue_state WHERE paused)",
                    "a queue is paused; resume it first.")],
         ["""CREATE OR REPLACE FUNCTION app.pending_outbox_events(max_rows integer DEFAULT 50)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF app.app_tenant() IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'pending_outbox_events is for the outbox relay only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.tenant_id, e.id
      FROM app.outbox_event e
     WHERE e.published_at IS NULL AND e.dead_lettered_at IS NULL
     ORDER BY e.created_at, e.id
     LIMIT least(greatest(max_rows, 1), 500);
END
$$;""",
          "DROP FUNCTION IF EXISTS app.platform_dead_letter_action(text, text);",
          "DROP FUNCTION IF EXISTS app.platform_dead_letters(integer);",
          "DROP FUNCTION IF EXISTS app.platform_queue_stats();",
          "ALTER TABLE app.outbox_event DROP COLUMN IF EXISTS discarded_at;",
          "DROP TABLE IF EXISTS app.worker_queue_state;"])

# ---- 0070 permission catalogue additions
CODES70 = ['document.view', 'document.download', 'document.waive', 'privacy.manage', 'lead.merge', 'lead.archive', 'application.assign',
           'application.close', 'application.withdraw', 'application.reopen', 'task.assign', 'integration.dlq_manage', 'automation.manage',
           'automation.operate', 'decision.evaluate']
codes70 = ", ".join(f"'{c}'" for c in CODES70)
verify("70", "permission catalogue spec additions", [
    ("the fifteen permission codes are defined", f"(SELECT count(*) FROM app.permission WHERE code IN ({codes70})) = 15"),
    ("compliance roles hold privacy.manage",
     "NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code = 'ROLE-COMPLIANCE' AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.tenant_id = r.tenant_id AND rp.permission_code = 'privacy.manage'))"),
    ("tenant-admin roles hold integration.dlq_manage",
     "NOT EXISTS (SELECT 1 FROM app.role r WHERE r.code = 'ROLE-TENANT-ADMIN' AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.role_id = r.id AND rp.tenant_id = r.tenant_id AND rp.permission_code = 'integration.dlq_manage'))"),
])
rollback("70", "Only codes this migration defined (introduced_in AUDIT-2026-10-19) are removed, with their grants; codes that existed before stay.", [], [
    "DELETE FROM app.role_permission WHERE permission_code IN (SELECT code FROM app.permission WHERE introduced_in = 'AUDIT-2026-10-19');",
    "DELETE FROM app.permission WHERE introduced_in = 'AUDIT-2026-10-19';",
])

# ---- 0071 documents
DOC = ['document_type', 'document', 'document_version', 'document_review', 'document_access_log', 'upload_intent', 'legal_hold', 'document_archive']
verify("71", "documents", [
    ("the eight document tables exist with forced row-level security", tables_rls(DOC)),
    ("version content is immutable (trigger)", trg("document_version", "document_version_content_guard")),
    ("reviews and the access log are append-only",
     f"{trg('document_review', 'document_review_append_only')} AND {trg('document_access_log', 'document_access_log_append_only')}"),
    ("resolve_upload_intent exists and runs as its owner", secdef("resolve_upload_intent(text)")),
])
rollback("71", "The tables are dropped only when all are empty (documents, their history and the access log are records).",
         refuse_rows(DOC), [
             "DROP FUNCTION IF EXISTS app.resolve_upload_intent(text);",
             "DROP TABLE IF EXISTS app.document_archive, app.legal_hold, app.upload_intent, app.document_access_log, app.document_review,",
             "  app.document_version, app.document, app.document_type;",
             "DROP FUNCTION IF EXISTS app.document_version_content_guard();",
         ])

# ---- 0072 application party removal
verify("72", "application party removal", [
    ("application_party has relationship_to_primary, removed_at and removed_by",
     f"{col('application_party', 'relationship_to_primary')} AND {col('application_party', 'removed_at')} AND {col('application_party', 'removed_by')}"),
    ("rows may only be marked removed (remove-only trigger replaces append-only)",
     f"{trg('application_party', 'application_party_remove_only')} AND NOT {trg('application_party', 'application_party_append_only')}"),
    ("a customer is unique among the parties still on the application",
     f"to_regclass('app.application_party_active_customer_uq') IS NOT NULL AND NOT {con('application_party', 'application_party_application_id_customer_id_key')}"),
    ("dsa_app may set removed_at and removed_by only",
     f"{colpriv('application_party', 'removed_at', 'UPDATE')} AND {colpriv('application_party', 'removed_by', 'UPDATE')} AND NOT {colpriv('application_party', 'customer_id', 'UPDATE')}"),
])
rollback("72", "Refused once a party was removed or has a relationship (that would be lost); the append-only trigger and the unique pair come back.",
         [refuse_if(f"{col('application_party', 'removed_at')} AND EXISTS (SELECT 1 FROM app.application_party WHERE removed_at IS NOT NULL OR relationship_to_primary IS NOT NULL)",
                    "parties were removed or given a relationship.")],
         [
             "DROP TRIGGER IF EXISTS application_party_remove_only ON app.application_party;",
             "DROP FUNCTION IF EXISTS app.application_party_remove_only();",
             "DROP INDEX IF EXISTS app.application_party_active_customer_uq;",
             "ALTER TABLE app.application_party DROP CONSTRAINT IF EXISTS application_party_removed_check;",
             "ALTER TABLE app.application_party DROP COLUMN IF EXISTS relationship_to_primary, DROP COLUMN IF EXISTS removed_at, DROP COLUMN IF EXISTS removed_by;",
             "ALTER TABLE app.application_party DROP CONSTRAINT IF EXISTS application_party_application_id_customer_id_key;",
             "ALTER TABLE app.application_party ADD CONSTRAINT application_party_application_id_customer_id_key UNIQUE (application_id, customer_id);",
             "DROP TRIGGER IF EXISTS application_party_append_only ON app.application_party;",
             "CREATE TRIGGER application_party_append_only BEFORE UPDATE OR DELETE ON app.application_party FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();",
         ])

# ---- 0073 user lifecycle handover
verify("73", "user lifecycle hand-over", [
    ("new_ulid() exists", fn("new_ulid()")),
    ("handover_owned_records exists and runs as the caller", f"{fn('handover_owned_records(text, text, text)')} AND NOT {secdef('handover_owned_records(text, text, text)')}"),
])
rollback("73", "Drops the two functions (nothing is stored by them).", [], [
    "DROP FUNCTION IF EXISTS app.handover_owned_records(text, text, text);",
    "DROP FUNCTION IF EXISTS app.new_ulid();",
])

# ---- 0074 lead apply links and duplicate reviews
verify("74", "lead apply links and duplicate reviews", [
    ("apply_link and duplicate_review exist with forced row-level security", tables_rls(["apply_link", "duplicate_review"])),
    ("lead has merged_into_id and archived_at with their checks",
     f"{col('lead', 'merged_into_id')} AND {col('lead', 'archived_at')} AND {con('lead', 'lead_merged_into_check')} AND {con('lead', 'lead_archived_at_check')}"),
    ("one open review per pair", "to_regclass('app.duplicate_review_open_pair_uq') IS NOT NULL"),
    ("resolve_public_apply_link exists and runs as its owner", secdef("resolve_public_apply_link(text)")),
])
rollback("74", "Refused once a link, a review, a merged or an archived lead exists.",
         refuse_rows(["apply_link", "duplicate_review"]) + [
             refuse_if(f"{col('lead', 'merged_into_id')} AND EXISTS (SELECT 1 FROM app.lead WHERE merged_into_id IS NOT NULL OR archived_at IS NOT NULL)",
                       "leads are merged or archived.")],
         [
             "DROP FUNCTION IF EXISTS app.resolve_public_apply_link(text);",
             "DROP TABLE IF EXISTS app.duplicate_review, app.apply_link;",
             "ALTER TABLE app.lead DROP CONSTRAINT IF EXISTS lead_merged_into_fk, DROP CONSTRAINT IF EXISTS lead_merged_into_check,",
             "  DROP CONSTRAINT IF EXISTS lead_archived_at_check;",
             "ALTER TABLE app.lead DROP COLUMN IF EXISTS merged_into_id, DROP COLUMN IF EXISTS archived_at;",
         ])

# ---- 0075 customer merge
verify("75", "customer merge", [
    ("customer.merged_into_id exists with its check", f"{col('customer', 'merged_into_id')} AND {con('customer', 'customer_merged_into_check')}"),
    ("merge_customer_links exists and runs as the caller", f"{fn('merge_customer_links(text, text, text)')} AND NOT {secdef('merge_customer_links(text, text, text)')}"),
    ("dsa_app may move the primary flag of a contact point", colpriv("customer_contact_point", "is_primary", "UPDATE")),
])
rollback("75", "Refused once a customer was merged.",
         [refuse_if(f"{col('customer', 'merged_into_id')} AND EXISTS (SELECT 1 FROM app.customer WHERE merged_into_id IS NOT NULL)", "customers were merged.")],
         [
             "DROP FUNCTION IF EXISTS app.merge_customer_links(text, text, text);",
             "ALTER TABLE app.customer DROP CONSTRAINT IF EXISTS customer_merged_into_fk, DROP CONSTRAINT IF EXISTS customer_merged_into_check;",
             "ALTER TABLE app.customer DROP COLUMN IF EXISTS merged_into_id;",
             "REVOKE UPDATE (is_primary) ON app.customer_contact_point FROM dsa_app;",
         ])

# ---- 0076 webhook delivery
verify("76", "webhook delivery", [
    ("webhook_subscription has secret_ciphertext and last_failure_at", f"{col('webhook_subscription', 'secret_ciphertext')} AND {col('webhook_subscription', 'last_failure_at')}"),
    ("subscriptions may be FAILING", "coalesce(position('FAILING' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = to_regclass('app.webhook_subscription') AND conname = 'webhook_subscription_status_check'))) > 0, false)"),
    ("one delivery per subscription and event", "to_regclass('app.webhook_delivery_once_uq') IS NOT NULL"),
    ("delivery log has last_error and updated_at", f"{col('webhook_delivery_log', 'last_error')} AND {col('webhook_delivery_log', 'updated_at')}"),
])
rollback("76", "Refused once a subscription stores an encrypted secret or is FAILING, or a delivery recorded an error.",
         [refuse_if(f"{col('webhook_subscription', 'secret_ciphertext')} AND EXISTS (SELECT 1 FROM app.webhook_subscription WHERE secret_ciphertext IS NOT NULL OR status = 'FAILING' OR last_failure_at IS NOT NULL)",
                    "subscriptions hold secrets or failure state."),
          refuse_if(f"{col('webhook_delivery_log', 'last_error')} AND EXISTS (SELECT 1 FROM app.webhook_delivery_log WHERE last_error IS NOT NULL)",
                    "deliveries recorded errors.")],
         [
             "DROP INDEX IF EXISTS app.webhook_delivery_tenant_created_idx;",
             "DROP INDEX IF EXISTS app.webhook_delivery_once_uq;",
             "ALTER TABLE app.webhook_delivery_log DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS updated_at;",
             "ALTER TABLE app.webhook_subscription DROP CONSTRAINT IF EXISTS webhook_subscription_status_check;",
             "ALTER TABLE app.webhook_subscription ADD CONSTRAINT webhook_subscription_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED'));",
             "ALTER TABLE app.webhook_subscription DROP COLUMN IF EXISTS secret_ciphertext, DROP COLUMN IF EXISTS last_failure_at;",
         ])

# ---- 0077 inbound webhooks
verify("77", "inbound webhooks", [
    ("inbound_webhook exists with forced row-level security", tables_rls(["inbound_webhook"])),
    ("received webhooks are append-only", trg("inbound_webhook", "inbound_webhook_append_only")),
])
rollback("77", "The table is dropped only when empty.", refuse_rows(["inbound_webhook"]), ["DROP TABLE IF EXISTS app.inbound_webhook;"])

# ---- 0078 privacy
verify("78", "retention policies and data-subject requests", [
    ("retention_policy and data_subject_request exist with forced row-level security", tables_rls(["retention_policy", "data_subject_request"])),
])
rollback("78", "The tables are dropped only when empty.", refuse_rows(["retention_policy", "data_subject_request"]),
         ["DROP TABLE IF EXISTS app.data_subject_request, app.retention_policy;"])

# ---- 0079 lender reason map
verify("79", "lender reason map", [
    ("lender.reason_map exists with its check", f"{col('lender', 'reason_map')} AND {con('lender', 'lender_reason_map_check')}"),
])
rollback("79", "Refused once a lender has a reason map.",
         [refuse_if(f"{col('lender', 'reason_map')} AND EXISTS (SELECT 1 FROM app.lender WHERE reason_map <> '[]'::jsonb)", "lenders have reason maps.")],
         ["ALTER TABLE app.lender DROP CONSTRAINT IF EXISTS lender_reason_map_check;", "ALTER TABLE app.lender DROP COLUMN IF EXISTS reason_map;"])

# ---- 0080 reference lists
verify("80", "BRE reference lists", [
    ("reference_list and reference_list_version exist with forced row-level security", tables_rls(["reference_list", "reference_list_version"])),
    ("published versions are immutable", trg("reference_list_version", "reference_list_version_append_only")),
])
rollback("80", "The tables are dropped only when empty.", refuse_rows(["reference_list", "reference_list_version"]),
         ["DROP TABLE IF EXISTS app.reference_list_version, app.reference_list;"])

# ---- 0081 access reviews
verify("81", "access reviews", [
    ("access_review and access_review_item exist with forced row-level security", tables_rls(["access_review", "access_review_item"])),
    ("a reviewer never decides their own access (SOD-10 check)", "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('app.access_review_item') AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%decided_by <> user_id%')"),
])
rollback("81", "The tables are dropped only when empty.", refuse_rows(["access_review", "access_review_item"]),
         ["DROP TABLE IF EXISTS app.access_review_item, app.access_review;"])

# ---- 0082 tenant configuration
CFG = ["setting", "label_set", "business_calendar", "picklist_value", "config_bundle_draft"]
verify("82", "tenant configuration", [
    ("the five configuration tables exist with forced row-level security", tables_rls(CFG)),
])
rollback("82", "The tables are dropped only when empty.", refuse_rows(CFG),
         ["DROP TABLE IF EXISTS app.config_bundle_draft, app.picklist_value, app.business_calendar, app.label_set, app.setting;"])

# ---- 0083 tenant lifecycle
verify("83", "tenant lifecycle", [
    ("tenant has entitlements, entitlements_version, status_reason and status_changed_at",
     f"{col('tenant', 'entitlements')} AND {col('tenant', 'entitlements_version')} AND {col('tenant', 'status_reason')} AND {col('tenant', 'status_changed_at')}"),
    ("the four platform.tenant permissions are defined", "(SELECT count(*) FROM app.permission WHERE code LIKE 'platform.tenant.%') = 4"),
    ("the platform super admin holds them, and no customer role does",
     "(SELECT count(*) FROM app.role_permission WHERE role_id = 'role_01M4ZG67WYKTMHNAX6RB8RYQYQ' AND permission_code LIKE 'platform.tenant.%') = 4 "
     "AND NOT EXISTS (SELECT 1 FROM app.role_permission WHERE permission_code LIKE 'platform.tenant.%' AND tenant_id <> 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG')"),
    ("tenant_offboarding exists with forced row-level security", tables_rls(["tenant_offboarding"])),
    ("the lifecycle functions run as their owner",
     f"{secdef('platform_provision_tenant(text, text, text, text, text, text, text, text)')} AND {secdef('platform_set_tenant_status(text, text, text, text)')} "
     f"AND {secdef('platform_request_offboarding(text, text, text)')} AND {secdef('platform_set_entitlements(text, jsonb, integer, text)')}"),
])
rollback("83", "Refused once an offboarding was requested or a tenant has entitlements or a status change recorded. Tenants provisioned "
               "through the API stay (they are ordinary tenants).",
         refuse_rows(["tenant_offboarding"]) + [
             refuse_if(f"{col('tenant', 'entitlements')} AND EXISTS (SELECT 1 FROM app.tenant WHERE entitlements <> '{{}}'::jsonb OR entitlements_version <> 0 OR status_reason IS NOT NULL OR status_changed_at IS NOT NULL)",
                       "tenants have entitlements or status changes recorded.")],
         [
             "DROP FUNCTION IF EXISTS app.platform_set_entitlements(text, jsonb, integer, text);",
             "DROP FUNCTION IF EXISTS app.platform_request_offboarding(text, text, text);",
             "DROP FUNCTION IF EXISTS app.platform_set_tenant_status(text, text, text, text);",
             "DROP FUNCTION IF EXISTS app.platform_provision_tenant(text, text, text, text, text, text, text, text);",
             "DROP FUNCTION IF EXISTS app.platform_require_realm();",
             "DROP TABLE IF EXISTS app.tenant_offboarding;",
             "DELETE FROM app.role_permission WHERE permission_code IN (SELECT code FROM app.permission WHERE introduced_in = 'M-083');",
             "DELETE FROM app.permission WHERE introduced_in = 'M-083';",
             "ALTER TABLE app.tenant DROP COLUMN IF EXISTS entitlements, DROP COLUMN IF EXISTS entitlements_version,",
             "  DROP COLUMN IF EXISTS status_reason, DROP COLUMN IF EXISTS status_changed_at;",
         ])

# ---- 0084 connector portal
verify("84", "connector portal", [
    ("referral_consent_otp exists with forced row-level security", tables_rls(["referral_consent_otp"])),
    ("dsa_app may update only attempts, verified_at and used_by_lead",
     f"{colpriv('referral_consent_otp', 'attempts', 'UPDATE')} AND {colpriv('referral_consent_otp', 'used_by_lead', 'UPDATE')} AND NOT {colpriv('referral_consent_otp', 'code_hash', 'UPDATE')}"),
])
rollback("84", "The table is dropped only when empty.", refuse_rows(["referral_consent_otp"]), ["DROP TABLE IF EXISTS app.referral_consent_otp;"])
print("ok")
