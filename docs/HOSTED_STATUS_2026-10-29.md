# Hosted database status, read-only check, 2026-10-29

**Scope:** the shared development project `DSA-Agent`, ref `mlpkwwhnagxzinaohdxg` (confirmed against `supabase/.temp/project-ref`). Read-only: every statement is a `SELECT`. Nothing was written, granted, revoked, dropped or applied.

**Method:** `npx supabase db query --linked -f <file>` for each file in `tools/sql/status/` (one statement per file), plus `tools/sql/batch/94.prereq.sql`. The login role is `postgres` with `BYPASSRLS`, so counts are complete, not filtered by row-level security.

**Ledger:** the Supabase migration table (`supabase_migrations.schema_migrations`) does not exist on hosted, and `npx supabase migration list --linked` shows no remote entry. Every result below is a catalog check. Nothing here shows which migration files ran, or how.

## Results

| Area | Hosted state (2026-10-29) | What the docs said | Status |
|---|---|---|---|
| Migration 0094 (eligibility) | Absent: no `applicant_financial_input`, no `eligibility_assessment.input_hash`, no flag row. Prerequisite check: all 25 gating rows PASS, plus the INFO row. | Not applied | Confirmed. Ready for the runbook once approved. |
| Eligibility tables (0048, 0068) | `eligibility_assessment` and `tenant_feature_flag` present. | Present | Confirmed. |
| Approved rule set (0055) | `DK-application.eligibility` rule set in **1 tenant** (`platform-operations`). | Rule sets in 7 tenants (2026-10-17) | **Changed.** See "Tenants" below. |
| Migrations 0092 and 0093 (staff invitations) | Objects present: `staff_invitation` (20 columns, one-pending index), `delivery_state` column, `staff_invitation_delivery_due` index, `app.pending_staff_invitation_deliveries(integer, integer)`. | Not applied | **Changed.** The objects exist. Apply date, operator and whether the files ran as written are not recorded. |
| Migration 0086 (test-login functions) | Both functions exist. EXECUTE is held by `postgres`, `dsa_api`, `dsa_app` and **PUBLIC**. | `dsa_app` lost EXECUTE through 0091 (applied 2026-10-27, "verified read-only") | **Not in effect.** See "Test-login functions" below. |
| Migration 0091, `app.authenticate_user` | Dropped (0 overloads). | Dropped by 0091 | Confirmed. |
| Migration 0091, grants on `public` | anon: 0 SELECT grants on the 142 views. authenticated: 0 write grants. | Removed by 0091 | Confirmed. |
| Migration 0087 (public views) | 142 views in `public`. | Views created by 0087; not recorded as applied | Objects confirmed. Whether 0087 itself ran is not recorded. |
| Schema `app` usage | `anon`, `authenticated` and `dsa_app` hold USAGE on schema `app`. | Not recorded | Confirmed. |
| `app_user.password_hash` (R15, P1-2) | Column still present. | Recorded in the 2026-10-26 review | Open. |
| RLS on `decision_definition`, `decision_dependency`, `permission` (R14, P2-5) | Row-level security **off** on all three. | Recorded in the 2026-10-26 review | Open. |
| Migration ledger | `supabase_migrations.schema_migrations` absent. | Not recorded | Hosted changes are not ledgered. |

## Test-login functions (migration 0086)

**What the files say.** `supabase/migrations/20261001000086_test_auth_bypass.sql` revokes EXECUTE from PUBLIC on both functions and grants it to `dsa_app` only. Migration 0091 (`20261001000091_security_hardening.sql`) revokes EXECUTE from `anon` and `authenticated` on all functions, and from `dsa_app` in a `DO` block. It does not revoke from PUBLIC. No later migration in the repository grants EXECUTE on these functions to anyone.

**What hosted shows (2026-10-29).** EXECUTE is held by PUBLIC, `dsa_app`, `dsa_api` and `postgres`. Three things differ from the files:

1. PUBLIC holds EXECUTE. 0086 revokes it, so hosted does not match 0086 as written.
2. `dsa_app` still holds EXECUTE. 0091's revoke from `dsa_app` is not reflected, and nothing in the repository grants it back.
3. `dsa_api` holds an explicit EXECUTE grant. No migration or script in the repository grants it.

**Reach.** PUBLIC includes `anon` and `authenticated`, and both hold USAGE on schema `app`. So those roles can execute both functions inside the database. **The public Data API does not expose schema `app`** (verified 2026-10-29). A `GET` for a nonexistent table with `Accept-Profile: app` returns `406 PGRST106` ("Only the following schemas are exposed: public, graphql_public"). The same request with `Accept-Profile: public` returns `404 PGRST205`. The probe used only the publishable key and read no data. So anon and authenticated cannot reach these functions through the Data API today. The database grants still allow it, and the setting itself is the owner's to record in the dashboard.

**Cause.** The retained statement history shows the revoke from 0091 did run: its `DO` block and the `authenticate_user` drop are each recorded twice, by `postgres`. Later, `postgres` ran `GRANT EXECUTE ON FUNCTION app.list_test_users() TO dsa_api, dsa_app, public`, the same grant for `lookup_test_user`, and `GRANT USAGE ON SCHEMA app TO dsa_api, dsa_app, public`. None of these three statements is in any repository migration. The transaction IDs put them in one transaction after 0091 (see "Investigation" below).

Details: `docs/MIGRATION_0086_TEST_LOGIN_REVIEW.md`.

## Tenants and the approved rule set

Hosted has **2 tenants** in `app.tenant`:

- `platform-operations`: the platform tenant (migration 0050). It holds the one approved eligibility rule set.
- `adity-finserv`: not named in the repository's hosted records. It has no eligibility rule set.

The repository's hosted records name these tenants: `demo-alpha`, `demo-beta`, `demo-dsa`, `qloax-dsa`, `test-dsa-alpha`, `test-dsa-beta`, `test-tenant-b`, and the platform tenant (`docs/HOSTED_APPLY_CHECKLIST.md`, `docs/HOSTED_TEST_RESIDUE.md`, `docs/PERMISSION_UI_VISIBILITY_AUDIT.md`, `docs/MIGRATION_BATCH_REHEARSAL_REPORT.md`). Only the platform tenant is still present. The repository has no record of any tenant being removed. The test-data cleanup (`tools/sql/cleanup`) is recorded as **not run** on 2026-10-17 (`docs/HOSTED_FINDINGS_20261017.md`), and no later record of it was found.

The owner needs to confirm whether the hosted project was reset or its tenants were removed, and when, before any further hosted step. Query: `tools/sql/status/04-tenants-eligibility-rule-sets.sql`.

## Not shown by this check

- Row contents beyond the counts above.
- The dashboard's exposed-schema setting, which the probe shows is `public` and `graphql_public` today. Only the owner can confirm it there.
- Who ran the migration statements and the grants. The history records only the `postgres` role, and it has no timestamps.
- Who the callers of the test-login functions were, and whether they got data back (see "Investigation").
- Why the grants to `dsa_api` and PUBLIC were made.
- Whether the hosted state matches the migration files beyond the objects listed.

## What this means for the other documents

- **0092 and 0093:** the objects are present, so they are no longer "not applied". Do not run their apply step again until the owner confirms what ran. Their verify and rollback scripts still do not exist.
- **0086:** the containment mitigation (EXECUTE removed from the API role) is **not in effect**. The 2026-10-28 review said it was verified; that was wrong for 2026-10-29.
- **0091:** its revokes ran. A manual grant by `postgres` afterwards re-added `dsa_app`, `dsa_api` and PUBLIC on the test-login functions. Its file does not cover PUBLIC.
- **0094:** still absent; its prerequisites pass. It is the only hosted change still to be made for this work, and it still needs approval.
- **Eligibility rule set:** present in one tenant on hosted, against seven on 2026-10-17.

## Investigation (read-only, 2026-10-29)

Sources: `pg_stat_statements` (the statement history, reset with the statistics on 2026-10-02, no timestamps), `pg_stat_user_tables`, the transaction ID (`xmin`) of each catalog row, and `app.audit_event`. Commit timestamps are not enabled on this database, so transaction IDs order writes but do not date them.

**Migration history.**
- Migration 0091 ran. Its `DO` block (the `dsa_app` revoke) and its `DROP` of `authenticate_user` are each recorded twice, by `postgres`. The 41 app functions and the `public` default privileges were last written in transaction 12223, consistent with 0091's revokes.
- In transaction 12335, after 0091, `postgres` ran the three grants listed under "Test-login functions". The two test-login functions and the `app` schema were last written in that transaction, so the grants were made together.
- The `adity-finserv` tenant row was written in transaction 12540, after 12335. The 0093 function was written in transaction 12669.
- The history has no statement for 0086's own creation or its revoke from PUBLIC. Those predate the retained window or were evicted.

**The API role has called the test-login functions on the shared project.** Recorded calls by `dsa_api`: `app.lookup_test_user` 154, `app.list_test_users` 13, and the legacy `app.authenticate_user` 109 (before it was dropped). Recorded by `postgres`: one lookup. The history does not show the caller (a deployed API, a local API, or test code), whether any call returned data, or when the calls happened. This conflicts with the containment plan's "no hosted API" statement, which is therefore not verified.

**Tenants.**
- Audit events of 2026-10-27 from one platform user (a Windows browser session on localhost) show the tenant list returned 8 at 05:26 UTC, 0 from 05:28 to 06:00, and 1 from 06:05 to 06:33.
- Since 2026-10-02, `app.tenant` has had 15 inserts, 8 deletes and no updates. `app.tenant_offboarding` has had 8 inserts, 4 updates and 1 delete, and has 0 rows now.
- The audit log (174 events in total) records no tenant deletion and no offboarding. Its only tenant events are the 27 list and view events of 2026-10-27.
- The statement history has no DELETE on the tenant table.

This is consistent with tenant rows being removed around 05:26 to 05:28 UTC on 2026-10-27. It is not proven: the deletes have no timestamps, and the change in the list could come from a grant, a session, or a deletion. The 8 deletes and the 8 listed tenants do not match the 2 tenants present in any simple way. The owner should check the Supabase Postgres logs for 2026-10-27 05:00 to 07:00 UTC, and the record of who ran the grants.

**Tenant delete.** The statement history has one `DELETE FROM app.tenant WHERE id <> $1`, run once by `postgres`. No repository file contains that statement. Its parameter is not recorded, so which tenant it kept is unknown. One statement can remove several rows, so it fits the 8 recorded deletes, but the history cannot show when it ran.

**Role membership.** `dsa_api` is a member of `dsa_app`, with inheritance on, so a revoke from `dsa_app` also removes what `dsa_api` inherits. Both also hold a direct grant. The effective EXECUTE check returns true for `dsa_api`, `dsa_app`, `anon` and `authenticated` on both functions.

**Local configuration.** `apps/api/.env` (a local file; not read beyond its names and hosts) sets `SUPABASE_URL` to the shared project. Its `DATABASE_URL` uses the `dsa_api` role, and its `DIRECT_DATABASE_URL` and `VERIFY_DATABASE_URL` use `postgres`, all on the shared project's hosts. `NODE_ENV` is `development`. `TEST_AUTH_ENABLED` is not set, so it defaults to `false` (`apps/api/src/config.ts`), and `testAuthProblems` refuses the shared project anyway (`apps/api/src/test-auth.ts`). So this file does not mount the test-login routes. So the route did not come from this file's settings. The 154 lookup calls by `dsa_api` have no identified source. The containment plan's note that a previous build may have run on hosted fits, but this is not verified.

**Migration 0091's assumption.** Its comment says the app schema already denies USAGE to anonymous and signed-in users. On hosted, `GRANT USAGE ON SCHEMA app TO dsa_api, dsa_app, public` is recorded, so both reach the schema through PUBLIC. The assumption does not hold on hosted.

No tenant was recreated, and no cleanup was run.

## Remediation applied, 2026-10-29 (approved)

- Ran `tools/sql/remediation/0086-revoke-test-login-execute.sql` on the shared project. It is one transaction and returned no error.
- Before the run, both functions had `{postgres=X/postgres,dsa_api=X/postgres,dsa_app=X/postgres,=X/postgres}`.
- After the run, the verify file shows both as `{postgres=X/postgres}`.
- Effective EXECUTE after the run (membership check) is false for `dsa_api`, `dsa_app`, `anon` and `authenticated`.
- The revoke was the only write. No function was dropped, and no other grant, schema setting or data was changed. Schema `app` USAGE for PUBLIC is still granted, which is a separate decision.
- Expected but not observed: the test-login routes now fail for `dsa_api` and `dsa_app` connections. The unit tests mock the database, so they do not show this.

## Changes applied 2026-10-29 (owner-approved, each verified read-only)

| Step | What | Result |
|---|---|---|
| 1 | Migration 0094 (eligibility inputs and provenance), applied through the wrapper `C:\Users\Vaibhav\dsa-backups\batch-94\apply-run.sql` (source SHA-256 `edf565d1…`). The prerequisites were checked again immediately before. | Applied. `94.verify.sql`: 7 of 7 PASS. Row counts before and after: `eligibility_assessment` 5 and 5; `feature_flag` 14 and 15 (the new `eligibility.manual_credit_entry` row); `tenant_feature_flag` 0 and 0; `rule_set` 3 and 3; `rule_set_version` 3 and 3. |
| 2 | Migration 0095: PUBLIC's EXECUTE removed from the app routines. Before it, a read-only check found nothing outside schema `app` that calls an app routine (no policy, trigger, routine or view). | Applied. `95.verify.sql`: PASS. PUBLIC can execute 0 app routines (was 24). `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin`, `supabase_storage_admin` and `dashboard_user` can execute 0 (were 24 each). `dsa_app` and `dsa_api` execute 43 before and after. `dsa_app` now holds explicit grants on the 24. |
| 3 | Migration 0096: `app.lookup_test_user(text)` and `app.list_test_users()` dropped. | Applied. `96.verify.sql`: PASS. Routines in schema `app`: 45, then 43. |

Not changed by these steps: schema `app` USAGE is still granted to PUBLIC (the comment in 0091 assumed it was not). The migration ledger is still absent, so this section is the record of the apply. `tools/sql/batch/86.verify.sql` now reports FAIL for its two functions by design.

Still open: the test-login route code and its default OTP remain in `apps/api` (a request to the route would now fail at the database); the tenant-set difference (approval 12); owner confirmation of 0092 and 0093 (approval 2); the Dashboard exposed-schema check; `apps/api/.env`; credential rotation.

## Reproduce

```
npx supabase db query --linked -f tools/sql/status/01-eligibility-invitations-test-login.sql
npx supabase db query --linked -f tools/sql/status/02-test-login-acl-public-views.sql
npx supabase db query --linked -f tools/sql/status/03-roles-tenants-rls.sql
npx supabase db query --linked -f tools/sql/status/04-tenants-eligibility-rule-sets.sql
npx supabase db query --linked -f tools/sql/status/05-postgrest-settings.sql
npx supabase db query --linked -f tools/sql/batch/94.prereq.sql
```

Each statement is read-only. Do not add a write to these files.
