# Hosted test residue: inventory and cleanup plan

Status date: 2026-10-16. **Nothing was deleted or changed.** This is a read-only inventory of the shared hosted project, taken with a query that only counts rows.

## 1. How it got there

Several integration specs were written against the hosted database. They read `apps/api/.env` or fell back to a connection string written in the spec, so every full integration run wrote test rows into the hosted test tenants. Some of my runs on 2026-10-15 and 2026-10-16 did this before I found it (about 220 of the rows below are from those runs; the rest predate me, from 12 Oct on). Since then the suites cannot reach hosted: see `docs/CREDENTIAL_REMEDIATION.md` section 2, and `integration-tests-can-reach-hosted` in the project memory.

## 2. What is there

Scope of the count: rows with `tenant_id` starting `ten_01J` in tables that have both `tenant_id` and `created_at`. These are the test tenants, not customers.

- **1,704 rows in 30 tables**, created from 2026-10-12 to 2026-10-16 03:29 (UTC).
- By tenant: `test-dsa-alpha` 1,685, `test-dsa-beta` 14, `test-tenant-b` 5.
- Largest tables: `activity` 373, `message_template` 248, `dedupe_registry` 185, `notification` 129, `organisation` 94, `idempotency_key` 79, `connector` 59, `message` 48, `app_user` 46, `public_entry_index` 45, `outbox_event` 40, `upload_link` 40, `payout_request` 31, `branch` 30, `commission_calculation` 27, `user_role_assignment` 25, `lender_statement` and `lender_statement_line` 23 each, then 11 smaller tables.
- Also seen separately: 34 users in `test-dsa-alpha` (most SUSPENDED, named `approver_…`, `importer_…`, `rpt_…`), and 21 ACTIVE users there with no role.

The per-table, per-tenant CSV (with first and last timestamps) is in the session scratchpad, outside the repository. Regenerate it with the query in section 4.

## 3. Safe cleanup candidates (a plan, not executed)

All of this is test-tenant data. Nothing in a customer tenant (`demo-alpha`, `demo-beta`, `demo-dsa`, platform) is a candidate.

1. **Take a backup first** (rows of the candidate tables for the three test tenants, as JSON, outside the repository).
2. **Candidates, in dependency order** (children before parents): `payout_line`, `payout_request`, `commission_payable`, `commission_calculation`, `reconciliation_match`, `lender_statement_line`, `lender_statement`, `connector_bank_account`, `connector`, `upload_link`, `message`, `message_template`, `notification`, `activity`, `outbox_event`, `dedupe_registry`, `idempotency_key`, `public_entry_index`, `import_batch`, `data_correction_request`, `support_access_grant`.
3. **Keep** the fixtures that the test suites and the demo rely on: the three test tenants, their organisations and branches that are referenced by a retained row, the users `usr_01JTESTUSER…`, `usr_demo_01` and their role assignments. Do **not** delete users or roles without checking `user_role_assignment` history (role assignments are kept as history by design, migration 0057).
4. **Immutable tables.** `audit_event` and similar are append-only by trigger and must not be touched; the cleanup does not need to.
5. Run it as `postgres` inside one transaction per tenant, with a row count printed before and after, and only after the owner approves the exact statements.

## 4. The inventory query

It counts, per table and tenant, total rows, rows from the last 14 hours, and the first and last `created_at`. It reads only. It needs `supabase db query --linked -f <file>`, with the file built from `information_schema` (tables in `app` that have `tenant_id` and `created_at`) and `query_to_xml` row counts for `tenant_id like 'ten_01J%'`.

## 5. Update 2026-10-17 (re-inventory, read-only)

- **1,845 rows in 30 tables** (was 1,704): test-dsa-alpha 1,826, test-dsa-beta 14, test-tenant-b 5. 141 rows were written in the last 14 hours, the latest at 04:28 UTC on 2026-10-17. They were not written by this session's guarded suites, so another checkout is still running specs that read a connection string from its own `.env`. A cleanup now would be refilled.
- **1,030 rows cannot be removed by design:** `activity` 394, `message_template` 258, `dedupe_registry` 193, `notification` 135 and `message` 50 are delete-protected by database triggers. The procedure reports them and never disables a trigger. At most 572 rows in 19 tables are deletable.
- **Kept:** organisation 102, app_user 50, branch 34, user_role_assignment 25, metric_definition 18, role 14 (fixtures and history).
- **The procedure is ready and rehearsed:** `tools/sql/cleanup/` (counts, backup to JSON, a transactional children-first delete that aborts unless it finds exactly the three test tenants, verify) and `apps/api/test/cleanup-test-data.int.spec.ts` (5 tests, PostgreSQL 16 and 17). Not run on hosted: the environment refused hosted writes, and stopping the writers comes first. See `tools/sql/cleanup/README.md`.

## 6. Update 2026-10-17 10:28 UTC (read-only)

1,909 rows in 32 tables. Six of them (3 `rule_set`, 3 `rule_set_version`) are the eligibility rules that migration 0055 created in the three test tenants at 10:01 UTC: legitimate, not residue, and not in the cleanup list. **Stray rows: 1,903.** They grew by 58 between 04:34 and 04:48:32 UTC (two full test bursts, 04:07 to 04:09 and 04:47 to 04:48), and nothing stray has been written since. See `docs/HOSTED_FINDINGS_20261017.md`.
