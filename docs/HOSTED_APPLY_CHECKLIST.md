# Hosted apply checklist (exact commands, in order)

Status date: 2026-10-17. **Nothing in this list has been run against hosted except the read-only checks marked R.** The environment's permission layer refused the hosted write commands I attempted (the first migration apply), so the writes are yours to run, or tell me when the permission is allowed and I will run them one by one.

Target, positively identified: Supabase project `DSA-Agent`, ref `mlpkwwhnagxzinaohdxg`, region ap-south-1, linked in `supabase/.temp/project-ref`; the shared development project (`docs/MODULE_1_PLATFORM_REALM_REVIEW.md`). Its tenants are the demo tenants, the platform tenant and three test tenants; no customer tenant exists.

## Done already (read-only)

- R: preflight on 2026-10-17: every prerequisite PASS; 0054, 0055, 0057, 0058, 0059, 0060, 0061, 0062, 0063 all "not applied". 0055 would reach 7 tenants; 0063 would give `security.incident` to 11 roles.
- R: state backup before the batch, outside the repository: `~/dsa-backups/batch-20261017/state-before.json` (87 permissions, 687 role grants, 51 roles, 10 flags, 7 tenants, no eligibility rule sets) and `0054-backup.json`.
- The 0054 wrapper is generated: `~/dsa-backups/batch-20261017/54/apply-run.sql`, source SHA-256 `ca52ad4ed66dc1ce65bd0f086466debe59e6730c073d32cc49383298cf3422c2` (the same hash as the earlier preparation), wrapper SHA-256 `93a8f6972e261acc6da9db0c9881f3e0a82fded828197b49e1932442bec9b899`, body equal to the migration.

## 1. Migrations (decision D1 is taken: `eligibility.override` goes to the four approver roles, as 0055 is written)

For each of 0054, 0057, 0059, 0060, 0061, 0058, 0055, 0063, 0064, 0065 in that order (0065 matters most for the running app: the invoices code now reads `connector_statement_entry`) (a risk order; the rehearsal shows no technical dependency). 0062 is not in this batch.

```
# once more, read-only: all prerequisites PASS, all "already applied" NO
npx supabase db query --linked -f tools/sql/batch/preflight.sql

# per migration NN (0054 uses its own verify: tools/sql/0054/verify.sql)
node tools/sql/make-apply-run.mjs supabase/migrations/2026100100NN_<name>.sql ~/dsa-backups/batch-20261017/NN/    # prints both hashes
npx supabase db query --linked -f ~/dsa-backups/batch-20261017/NN/apply-run.sql                                    # WRITES
npx supabase db query --linked -f tools/sql/batch/NN.verify.sql                                                    # every row PASS
# if a row is FAIL:  npx supabase db query --linked -f tools/sql/batch/NN.rollback.sql                             # WRITES
```

After the last one: re-run `tools/sql/0050/verify.sql`, `verify-behaviour.sql` and `enforcement-check.mjs`, sign in as the platform operator and as a tenant administrator, open `/security`, `/documents` and the role editor. Then update `docs/MIGRATION_MATRIX.md` from "NOT APPLIED" to the dates applied.

## 2. Test-data cleanup

`tools/sql/cleanup/README.md`. First stop the writers (section 3), or the rows come back.

## 3. Credentials

`docs/CREDENTIAL_REMEDIATION.md`. Rotation changes shared credentials that every teammate's `.env`, CI and any deployment use, and I cannot list those dependencies from here, so I did not rotate. The instructions there are the exact manual steps.

## Update after the rehearsal review (2026-10-17)

`docs/MIGRATION_BATCH_REHEARSAL_REPORT.md` has the evidence. Three things changed here: the runner (`tools/sql/batch/run-batch.sh`) is now resumable, uses a new folder per run and stops before 0054 if its data steps would change users; the state backup is an entity snapshot, not a database backup; and point-in-time recovery of the project should be confirmed in the Supabase dashboard before applying.
