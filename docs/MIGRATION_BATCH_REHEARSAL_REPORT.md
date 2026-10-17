# Hosted migration batch: rehearsal report (2026-10-17)

Question asked before approving the batch: what were the six PostgreSQL 17 failures, and is the batch safe to propose? Everything below is from commands run on a throwaway PostgreSQL 16 and 17 (Docker) and from **read-only** queries on the hosted project. Nothing was applied to or changed on hosted.

## 1. The six failures

**Which:** in the full PostgreSQL 17 run on the merged tree, `test/migration-batch-runbook.int.spec.ts` reported six failures: TEST-BATCH-63, 55, 64, 55c, 55b and the guard test. They are exactly the six tests that run after TEST-BATCH-62, i.e. the whole tail of the file, and the same file passed 13/13 on PostgreSQL 17 when run alone a few minutes later.

**Root cause: not established.** The run's output was filtered to the failing test names, and the error messages were not kept, so the evidence that would name the cause no longer exists. I did not want to call it "load" without proof, so I tried to reproduce it and to test every plausible cause:

| Hypothesis | Test | Result |
|---|---|---|
| A real defect in the migrations or their scripts | The same tests passed when the spec ran alone, in 4 further complete PG17 runs and 3 complete PG16 runs, and in 6 shuffled-order runs | **Not supported**: no run produced a failure from SQL |
| Test-order dependence or shared state | Whole spec in shuffled order, 3 seeds on PG17 and 3 on PG16 | **Not supported**: 6/6 pass |
| Autovacuum on the template database blocking `CREATE DATABASE ... TEMPLATE` | 40 copies from a populated template, with the default and with a 1 s autovacuum interval | **Not supported**: 0 failures in 80 |
| A single test exceeding its timeout | Timeouts are 120 s per test; in a contended full run the whole 13-test spec took 86 to 98 s, about 7 s per test | **Not supported** |
| A container killed or out of memory | Docker event history only reaches back a few minutes, so the failing window is gone; no kill or out-of-memory event appeared in any later run | **Cannot be checked for that run** |
| Resource exhaustion from running many suites at once | See below | **Observed in other forms**, never as these six failures |

What the experiments did show, and it is the best explanation available:

- The machine is small for this workload: 12 CPUs, a 7.6 GiB Docker VM. Vitest started one test process per CPU, each starting its own PostgreSQL container.
- In a full run the batch spec took **86 to 98 seconds**; alone it takes **about 6 seconds**. That is the contention.
- Six copies of the rehearsal suites at once did not reproduce the failure but crashed the test runner itself (`JavaScript heap out of memory`, `Worker exited unexpectedly`).
- With four test processes, a full run took the same wall time (about 240 s) and the batch spec fell to **33 to 45 seconds**.
- A new failure appeared once under that reduced load, and it is a known Windows Docker Desktop start-up race, not a test failure: `Error: No host port found for host IP` thrown by Testcontainers while starting a container.

So: the six failures are a **test-environment symptom of the suite starting too many PostgreSQL containers at once**, most likely, but that is an inference, and the specific mechanism is unproven. They do not point at the migrations, the verify scripts or the rollbacks, which pass in every run that completed.

A second sign of the same limit turned up at the end: with default settings the api **unit** suite (no database involved) lost 7 of 66 files with `Worker exited unexpectedly` (798 of 918 tests ran), while Docker was also running a local Supabase stack, two other projects' containers, an editor and browsers. With three or four worker processes the same suite passed **918/918** in three runs (two with the new setting, about 100 s each).

**Changes made because of this (all local):**
- `apps/api/vitest.int.config.ts` and `apps/api/vitest.config.ts`: at most four test processes (same wall time, a third of the per-file slowdown; unit suite 918/918 where the default setting lost workers).
- `tests/guard/start-postgres.ts`: starts the container and retries only the known `No host port found` start-up race, three times. Any other error, and every failure inside a test, is thrown unchanged. Used by the integration global setup, the isolation harness and all rehearsal specs.
- Rehearsal specs close their database connections in `finally`, so a failing test no longer produces a cascade of "terminating connection" errors that hides the first failure.

## 2. Local rehearsals after the changes

| Suite | PostgreSQL 17 | PostgreSQL 16 |
|---|---|---|
| Full integration suite (49 files) | **351/351** | **351/351** |
| Isolation suite (11 files) | **55/55** | **55/55** |
| Hosted-batch rehearsal spec alone (13) | 13/13 | 13/13 |
| Partial-application and rollback spec (17) | 17/17 | 17/17 |
| Migration 0065 spec (6) | 6/6 | 6/6 |
| Batch-runner decision tests (7, no database) | 7/7 | |

(The full runs were made before the last small edit, the 0054 data-step guard in the preflight; the batch spec and runner tests were re-run afterwards with the results above.)

## 3. Verification and rollback, tested one by one

- **Each migration is all-or-nothing through the real wrapper** (`TEST-PARTIAL-ATOMIC`, 10 tests): the wrapper made by `tools/sql/make-apply-run.mjs` is run with an error added at its end; the database is exactly as before (structure, policies, triggers, constraints, permissions, grants, flags, functions, privileges, rule sets); without the error it applies.
- **Stopping half way** (`TEST-PARTIAL-ROLLBACK`, stopped after 1, 3, 5, 7, 9 and 10 of 10): rolling back the applied migrations in reverse order succeeds and restores the database, and every row that existed before the batch is unchanged (tenants, users, roles, an operator-edited feature flag, operator master data, a custom role and its grants, all earlier grants).
- **The starting state is the real hosted one:** the rehearsal base uses the original 0053 text (the table is called `ledger_entry`), taken from git, not a renamed copy.
- **Verify scripts** pass after apply, and report FAIL after the rollback (`TEST-BATCH-nn`, one per migration).
- **Known and documented limits of the rollbacks:**
  - 0055's rollback removes **every** `eligibility.override` grant, including one added by hand after the batch (`TEST-PARTIAL-DATA`), and retires the seeded rule versions instead of deleting them (rule versions are append-only by design).
  - 0061's rollback leaves the baseline master data rows (they cannot be told apart from older rows).
  - 0064's rollback leaves owner and tenant admin grants (hosted had those before).
  - **0054 has two data steps that its rollback cannot undo:** it gives ROLE-RM to active users who have no role (in tenants that have that role) and deactivates role-less test accounts. See section 5.

## 4. Migration 0065 (invoices table rename)

- **Why it exists:** hosted ran the original 0053 (table `ledger_entry`); 0053 and the invoices code were then edited to `connector_statement_entry`. Without 0065, the new invoices code would fail on hosted.
- **Hosted state (read-only):** `ledger_entry` exists with 0 rows; no foreign keys point to it; no views, triggers or functions mention it; `dsa_app` holds SELECT, INSERT, UPDATE; its constraints are `ledger_entry_pkey`, `ledger_entry_tenant_id_key`, `ledger_entry_entry_type_check`, `ledger_entry_tenant_id_fkey`, with index `ledger_entry_tenant_conn_date_idx` and policy `ledger_entry_tenant_isolation`.
- **Defect found and fixed:** my first version renamed the table, primary key, one index and the policy but **not** the check and foreign-key constraints, and my test hid that by renaming a new table backwards. The migration now renames everything carrying the old name, and `TEST-MIG65-03` proves the result equals a fresh build exactly (columns, indexes, constraints, policies, privileges, row-level-security flags).
- **Data and access:** rows are kept (a row inserted before is found after); row-level security still isolates tenants for the real `dsa_api` login (`TEST-MIG65-04`); the invoices code's own insert works; running it twice changes nothing; a table called `ledger_entry` that has no `connector_id` column is never touched.
- **Application compatibility:** the only code reading the table is `invoices/repository.ts` (3 statements, all on the new name); the ledger module uses `ledger_journal_line`.
- **Order:** apply 0065 before the new invoices code is deployed.

## 5. Findings that change how the batch should be run

1. **0054's data steps depend on live data.** On 2026-10-17 they would change **0 users** (0 given ROLE-RM, 0 deactivated), because the three test tenants have no ROLE-RM role. But 27 active users have no role (all in `test-dsa-alpha`, up from 21 the day before: the stray test writers described in `docs/HOSTED_TEST_RESIDUE.md` are still running), so creating that role first would change 27 users and 0054's rollback cannot undo it. The preflight now reports both counts and the runner stops unless they are 0 (or `DSA_ALLOW_0054_DATA_STEPS=1`).
2. **The first runner could not have run twice.** `make-apply-run.mjs` refuses to overwrite a wrapper, and an earlier wrapper for 0054 already existed in the default folder. The runner now uses a new folder per run, skips migrations the preflight shows as applied (so a stopped run can be resumed), and refuses to start without the state backup.
3. **Hosted is changing underneath us.** Feature flags went from 10 to 11 between the two state backups, and role-less users from 21 to 27. Someone is writing to the shared project. Re-run the preflight immediately before applying.

## 6. Hosted status (read-only evidence, 2026-10-17 08:05 UTC)

Nothing from the batch is applied: 0054, 0055, 0057, 0058, 0059, 0060, 0061, 0063 and 0064 are all "not applied"; 0065 is "still needed" (old table name present, new name absent). Counts are unchanged since the backup: 87 permissions, 687 role grants. 0056 (ledger) and 0062 (executor) are not part of the batch.

## 7. The backup, and what it can restore

`~/dsa-backups/batch-20261017/state-before-apply.json` (165 KB, taken 2026-10-17 07:17 UTC) exists. It is a **snapshot of the entities the batch touches, not a database backup.** It holds: all 87 permissions, all 687 role-to-permission grants, all 51 roles (id, tenant, code, name, template flag), all 11 feature flags with their values, the count (only) of master data rows, the list of rule sets (none), the decision definition keys, and the 7 tenants (id, slug).

It can be used to see exactly what the grants, roles and flags were, and to re-insert deleted grants, roles or flags by hand. It **cannot** restore: table structure, any other table's rows (users, applications, leads, invoices, audit), master data contents, or anything changed after it was taken. `0054-backup.json` (5.8 KB) is a similar entity snapshot for 0054. The real recovery for anything beyond that is the tested per-migration rollback scripts, and the hosted project's point-in-time recovery, **whose availability on this plan I could not verify** from here; check it in the Supabase dashboard before applying.

## 8. Is the batch safe to propose?

**Yes, for the local evidence:** every migration is atomic, order-independent, verified, and reversible within the limits in section 3, on both PostgreSQL versions, from the faithful starting state.

**Conditions and remaining risks:**
- The cause of the six failures is unproven (section 1); the suite is now configured to be less contended and to retry only the known start-up race. If the same six failures return, the kept logs will say why.
- Re-run the preflight right before applying; the runner now refuses on a non-zero 0054 data-step count.
- Confirm point-in-time recovery in the dashboard, and use the state backup only as the entity snapshot it is.
- Apply 0065 before deploying the new invoices code.
- The 1,845 stray test rows keep growing; the writers should be stopped (credential rotation, everyone pulls) so verification counts and cleanup are meaningful.
