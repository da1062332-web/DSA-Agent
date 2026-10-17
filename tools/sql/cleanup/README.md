# Hosted test-data cleanup

Status: **prepared and rehearsed, not run.** Rehearsal: `apps/api/test/cleanup-test-data.int.spec.ts` (PostgreSQL 16 and 17, a database with the same test, demo and platform tenants as hosted). Everything marked WRITES is yours to run.

## What it touches

Only the rows of the three test tenants (`test-dsa-alpha`, `test-dsa-beta`, `test-tenant-b`, all `DSA_ORG`) in 24 candidate tables. The script aborts unless it finds exactly those three tenants by slug. It deletes children before parents (the order is computed from the foreign keys), and a table that refuses is skipped and reported, never forced.

Kept on purpose: the tenants, organisations, branches, users, roles, role assignments (fixtures the test suites use, and assignment history), reporting metric definitions, the permission catalogue and grants, and every row of the demo, platform and any other tenant.

## What it cannot remove, and why that is correct

Five candidate tables are append-only or delete-protected by database triggers (an audit-style guarantee): `activity`, `dedupe_registry`, `message`, `message_template`, `notification`. On the 2026-10-17 inventory they hold **1,030 of the 1,845 test rows**. The cleanup reports them as skipped. Removing them would mean disabling an integrity trigger, which this procedure never does; if you want them gone, that is a separate decision for the table owners. The deletable remainder is at most 572 rows in 19 tables.

## Order

```
# 0. read-only: counts for every tenant (keep the output; only the three test tenants may change)
npx supabase db query --linked -f tools/sql/cleanup/00-counts.sql > ~/dsa-backups/cleanup/counts-before.json

# 1. read-only: the rows that would be deleted, as JSON, outside the repository
npx supabase db query --linked -f tools/sql/cleanup/01-backup.sql > ~/dsa-backups/cleanup/backup.json

# 2. WRITES TO HOSTED: one transaction; prints a row per table with deleted count or the reason it was skipped
npx supabase db query --linked -f tools/sql/cleanup/02-cleanup.sql

# 3. read-only
npx supabase db query --linked -f tools/sql/cleanup/03-verify.sql
npx supabase db query --linked -f tools/sql/cleanup/00-counts.sql > ~/dsa-backups/cleanup/counts-after.json
```

Compare `counts-before.json` and `counts-after.json`: every row for a tenant other than the three test tenants must be identical.

## Before you run it

**Stop the writers first.** The inventory grew from 1,704 rows (2026-10-16) to 1,845 (2026-10-17, latest write 04:28 UTC), so somebody's checkout is still running the old integration specs against hosted (they read a connection string from `.env`). A cleanup now would be refilled. The fix is the credential rotation in `docs/CREDENTIAL_REMEDIATION.md` plus `git pull` for everyone, so the guarded test configuration is used.

## Recovery

Restoring a table is an `INSERT` from `backup.json` (rows are plain JSON of the table). There is no hosted point-in-time recovery on this project (not enabled, checked 2026-10-17), so the backup JSON is the whole recovery.
