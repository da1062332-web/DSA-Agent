# Migration 0054 runbook: access control and API clients

**Status: pending hosted application.** Nothing here has been run against hosted except the read-only preflight. Every hosted step below is yours to run.

Migration: `supabase/migrations/20261001000054_access_control_and_api_clients.sql` (Akash). What it does and why it is low risk: `docs/MIGRATION_MATRIX.md` and the plan in the session notes (new `role.manage` permission granted to the five admin roles, one registry row with its dependency, the `app.api_client` table with tenant row-level security, and two data steps that change nothing on hosted today).

## Files

| File                    | Purpose                                                                                  | Writes?                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| `preflight.sql`         | prerequisites present, and what would change                                             | no                       |
| `backup.sql`            | one JSON object with the state of the entities 0054 touches                              | no                       |
| `apply.sql`             | the migration inside `BEGIN; … COMMIT;` (kept equal to the migration by a test)          | yes                      |
| `verify.sql`            | 14 PASS/FAIL checks after applying                                                       | no                       |
| `rollback.sql`          | removes what 0054 added, with guards                                                     | yes                      |
| `../make-apply-run.mjs` | generates the apply wrapper from the migration, outside the repository, with both hashes | writes a local file only |

## What the backup is, and is not

`backup.sql` records the **state of the affected entities** (the permission, the admin grants, the eligibility definition, whether `api_client` exists, and the role-less active users). It is not a copy of the database and it does not restore anything by itself. Recovery is `rollback.sql`, which removes only what 0054 added. There is no hosted point-in-time recovery on this project (not enabled, checked 2026-10-17), so the backup JSON and the rollback script are the whole recovery. The backup file contains user e-mails of test accounts, so it lives in `~/dsa-backups/0054/` and is never committed.

## Commands (in order)

```
# 1. read-only: must show every prerequisite PASS and role.manage / eligibility / api_client = 0
npx supabase db query --linked -f tools/sql/0054/preflight.sql

# 2. read-only: take a fresh backup (the one in the folder is from before; replace it)
npx supabase db query --linked -f tools/sql/0054/backup.sql > ~/dsa-backups/0054/backup-before.json

# 3. generate the wrapper from the CURRENT migration; it prints both hashes and refuses to overwrite
node tools/sql/make-apply-run.mjs supabase/migrations/20261001000054_access_control_and_api_clients.sql ~/dsa-backups/0054/

# 4. WRITES TO HOSTED (yours to run): one transaction
npx supabase db query --linked -f ~/dsa-backups/0054/apply-run.sql

# 5. read-only: expect 14 PASS rows and no FAIL
npx supabase db query --linked -f tools/sql/0054/verify.sql
```

If step 5 shows a FAIL: stop, then `npx supabase db query --linked -f tools/sql/0054/rollback.sql` (it refuses to drop a populated `api_client`, and it leaves the eligibility definition alone if a rule set already uses it).

## Hashes prepared on 2026-10-16

- Migration source: `ca52ad4ed66dc1ce65bd0f086466debe59e6730c073d32cc49383298cf3422c2`
- Wrapper `~/dsa-backups/0054/apply-run.sql`: `72663dd3ebc57e6eac71ba81abe7bca1fce997245cff02213e014cca271b6d3a` (the tool also proved the wrapper body equals the migration byte for byte)

The wrapper's first line carries a generation time, so a regenerated wrapper has a different hash from the same source. Compare the **source** hash, and let the tool re-prove the body.

## Rehearsal evidence

`apps/api/test/runbook-0054.int.spec.ts` (11 tests, PostgreSQL 16 and 17): preflight is read-only; the backup is one JSON object; apply runs once and twice with identical results; every verify check passes and each can fail (policy dropped, role.manage over-granted, a policy that does not isolate tenants); rollback is blocked while `api_client` holds a row and while a rule set uses the eligibility definition; after rollback preflight looks like before; the role default and orphan steps behave as designed; **and `api_client` isolates tenants for the real `dsa_api` role (NOBYPASSRLS) with the tenant set exactly the way the API sets it** (own tenant works, another tenant sees and changes nothing, no tenant sees nothing).

Review items from the earlier review that were wrong, and are fixed: `rollback.sql` used a column that does not exist (`rule_set.decision_key` is the name); `verify.sql` hard-coded "5 roles" and "21 users" and only checked that a policy of the right name existed.
