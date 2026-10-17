# Hosted migration batch: runbook (0054, 0055, 0057 to 0064)

Status: **prepared and rehearsed, not applied.** Every command below that writes is yours to run, after you approve. Nothing in this folder has been run against hosted except `preflight.sql` and the read-only checks listed in `docs/MIGRATION_MATRIX.md`.

Rehearsal evidence (throwaway PostgreSQL 16 and 17, built to look like hosted: the test tenants and the grants hosted holds):

- `apps/api/test/migration-sequence.int.spec.ts`: the proposed order applies; four other orders (reverse, numeric, two shuffles) apply and end in an identical database (structure, policies, triggers, permissions, grants, flags, functions); the ledger (0056, Release 3) can follow the batch without clashing; the batch can be applied in two halves.
- `apps/api/test/migration-batch-runbook.int.spec.ts`: for every migration, `verify` passes after apply, `rollback` returns the database to exactly the state before (0055 and 0061 as described below), `verify` then notices, and the rollback guards refuse when data would be lost.
- `apps/api/test/runbook-0054.int.spec.ts`: the same for 0054, with its own package in `tools/sql/0054/`.

## What the order really is

The tests show **no technical dependency between these migrations**: every one applies alone on the hosted state, and any order ends in the same database. The suggested order is therefore a risk order, not a requirement:

1. **0054** access control and API clients (a new table and one permission; the 0054 package has its own backup and rollback).
2. **0057** then **0059** role removal, then role edit and delete (grants and guards).
3. **0060** nine permission definitions (grants nothing).
4. **0061** release register table and baseline master data.
5. **0058** two feature flags.
6. **0055** eligibility rules and the `eligibility.override` grant: **only after decision D1** (who may override). Run `55.revoke-override-grants.sql` straight after if you decide the four roles are not the approvers.
7. **0063** security events and incidents tables, and `security.incident` for owner, compliance and tenant admin.
8. **0064** sanction and disbursement grants for branch manager and loan operations (owner and tenant admin already hold them on hosted). Idempotent.
9. **0065** renames the invoices connector-statement table on hosted from `ledger_entry` to `connector_statement_entry`. **Apply it before the application code from the 2026-10-17 merge is deployed**: that code (invoices statements) reads the new name. Preflight row "0065 still needed" says YES on hosted.
10. **0062** only if you want the data-correction executor (Release 2); the executor stays off without `DATA_CORRECTION_EXECUTOR=true`.
11. **Not in this batch:** 0056 (the Release 3 ledger).

Before the application code that uses a migration is deployed, apply that migration. Application code that is deployed first will fail on the missing tables (for example `/v1/api-clients` without 0054).

## Commands, one migration at a time

Replace `NN` with the number. Use the project that `npx supabase projects list` shows as linked (`DSA-Agent`).

```
# 0. once: read-only; every "prerequisite" row PASS and every "already applied" row NO
npx supabase db query --linked -f tools/sql/batch/preflight.sql

# 1. generate the wrapper for this migration (outside the repository; prints the source and wrapper SHA-256; refuses to overwrite)
node tools/sql/make-apply-run.mjs supabase/migrations/2026100100NN_<name>.sql ~/dsa-backups/NN/

# 2. WRITES TO HOSTED (yours to run): one transaction
npx supabase db query --linked -f ~/dsa-backups/NN/apply-run.sql

# 3. read-only; expect every row PASS
npx supabase db query --linked -f tools/sql/batch/NN.verify.sql

# 4. only if verify shows a FAIL or you decide to back out: WRITES TO HOSTED
npx supabase db query --linked -f tools/sql/batch/NN.rollback.sql
```

0054 uses its own package (`tools/sql/0054/README.md`) because it needs a backup of the admin grants first.

## What each rollback does (and does not)

| Migration | Rollback | Kept on purpose |
|---|---|---|
| 0054 | see `tools/sql/0054` | |
| 0055 | removes the override grants; **retires** the seeded rule versions and archives their rule sets | Rule versions, rules and decision records are append-only by design (audit), so they are never deleted. With no active version the decision answers REFER, as before 0055. |
| 0057 | drops the close-only trigger and the column grant | |
| 0058 | removes the two flags if nobody has changed them | A flag an operator touched stays. |
| 0059 | drops the guards and the grants | |
| 0060 | removes the nine permissions nobody holds | A permission granted since stays. |
| 0061 | drops `platform_release` if it holds only the unchanged seed row | The baseline master data rows stay (they cannot be told apart from rows that already existed). |
| 0062 | drops the function and constraint; drops the column if no failure reason is recorded | |
| 0064 | removes the four permissions from branch manager and loan operations again | Owner and tenant admin keep theirs (hosted already had them, so they cannot be told apart from this migration's grants). |
| 0063 | drops the two tables if empty and removes the permissions | Refused if a security event or incident exists: that is an audit trail. |

Anything else (a bad apply that the rollback cannot fix) is recovered with the hosted project's point-in-time recovery; ask for it before, not after.

## After the batch

Run the Module 1 checks again (`verify.sql`, `verify-behaviour.sql`, `enforcement-check.mjs` from `tools/sql/0050`) and sign in once as a platform operator and once as a tenant administrator.
