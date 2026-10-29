# Connector security remediation: completion record

**Status: complete locally, not deployed.** Nothing is committed, pushed or deployed. Hosted was not written to. Migration 0097 is not applied to hosted. The partner-login containment is prepared, not executed.

Recorded 2026-10-29. Covers the partner-login incident (a connector portal login held the internal `ROLE-RM` role) and the connector changes made to close it.

## 1. What was fixed

**Role assignment and reserved roles**
- A connector portal login holds no role. `POST /v1/users/:id/roles`, `PUT /v1/users/:id/role-assignments` and `POST /v1/users/invitations` all refuse one. Each reads the user type and the role code from the database.
- `PUT /v1/users/:id/role-assignments` revalidates every wanted assignment, including rows already held. An invalid row that is still wanted is refused. Removing it still works.
- The `ROLE-CONNECTOR` namespace is reserved. Creating such a role is refused by the API and by the database (migration 0097). Staff cannot hold one.
- Tenant-scoped role lookups on the invitation and replacement paths.
- Direct writers: the 0054 backfill copy and the hosted fix script assign staff only. The scratch branch-manager script and the platform-admin provisioner check the tenant and the user type.

**Migration 0097 (not applied)**
- A fail-closed precheck, three guards (assignment, user-type change, reserved code), and row locks so a role change and a type change cannot interleave.
- Verification (`tools/sql/batch/97.verify.sql`, read-only) and rollback (`97.rollback.sql`, drops the guards, no data change).
- Manifest, matrix and lock entries.

**API access**
- A connector login is refused on `/v1` and `/platform/v1` except `GET /v1/me` (`connector-identity-gate.ts`). The resolver puts the user type on the principal.
- `/portal/v1` is unchanged. Every portal query is scoped to the connector derived from the login.

**Connector visibility, ownership and sensitive data**
- Visibility is decided by permission and scope, not by a role's name. The rule is in `connector-service.ts` (`visibility`):
  - `connector.manage` at TENANT scope, and `connector.bank_change_approve` at TENANT scope: every connector.
  - `connector.manage` at BRANCH scope: the connectors of its branches.
  - Every reader: the connectors it is the relationship owner of. A relationship manager (`connector.read` only) therefore sees only its own.
- A connector outside what the principal may see is 404 on read, on list, on bank accounts and agreements, and on every write (the write reads the connector first).
- Contact details (mobile, e-mail) are shown in full only to `connector.manage` holders. Everyone else sees them masked.
- The relationship owner must be an active staff member of the same tenant, on create and on update.
- Changing the owner requires `ownerChangeReason` and writes `connector.owner_changed`.
- Bank accounts need `connector.manage` or `connector.bank_change_approve`. Agreements need `connector.manage`.
- The picker reads `GET /v1/connectors/lookup`, which returns id, legal name, status and branch only.
- The Connector page shows a note when bank details or agreements are restricted to the user, so an empty list is not read as "none".

**Optimistic locking and stale responses**
- The version check was a read outside the write. Two writers could both pass it, and the second silently overwrote the first.
- Connector updates, activation and status changes now carry `lock_version = <expected>` in the UPDATE itself, and refuse with `VERSION_CONFLICT` when no row matches.
- Their responses are read inside the same transaction. Before this, activation and status returned the connector as it was before the write, and stored that in the idempotency record.
- `touch_row` already bumps `lock_version` on every update. This was not the defect.

**Portal reconciliation**
- `MOD_CON_IMPLEMENTATION_READINESS.md` has a dated reconciliation note. The `ROLE-CONNECTOR-PORTAL` statements are marked superseded, and the scope rule is updated to what is built.

**Containment (prepared, not run)**
- `docs/CONNECTOR_CONTAINMENT_RUNBOOK.md` has exact commands with placeholders, and the approval gate before section 5.
- `tools/sql/remediation/connector-containment.post-check.sql` is read-only. It gives the state before and after the action.
- `tools/sql/remediation/connector-containment.evidence.sql` is read-only and returns metadata only. Its four sections run cleanly against a local migrated database. The Supabase auth section cannot run locally, so it is not validated.

## 2. Fixes to the four known test failures

| Test | Cause | Fix |
|---|---|---|
| TEST-ABATCH-00 | Vitest could not load a path containing a space (`Qloax Intern`) | Load `pending.mjs` through `createRequire` |
| TEST-VERIFY-06 | The test created `service_role`, which `start-postgres` already creates | Alter the existing role to a login instead of creating it |
| TEST-TFLAG-INT-05 | Migration 0087 exposes every app table as a `public` view. The 0068 rollback's `DROP TABLE` failed on that view | The rollback drops `public.tenant_feature_flag` first, in the same transaction. The rollback was broken on hosted too |
| TEST-USR-LC-INT-07 | The test did not perform the two writes the provisioning worker makes (bind the subject, mark the invitation SENT), and it sent no password sign-in | The test makes those two writes and sends `authMethods: ['password']`. Its "someone else" case now uses a different subject |

## 3. Tests

Run on the final code.

| Suite | Result |
|---|---|
| API typecheck | Pass (after the visibility change) |
| Web typecheck; tools typecheck | Pass |
| API unit: connector specs (`connectors`, `connector-role-guard`, `connector-identity-gate`, `platform-users`, `role-guards`) | Pass, 49 of 49 (after the visibility change) |
| API unit: whole suite | 92 files, 1181 of 1181 (before the visibility change, which touches only the connector module) |
| Web unit: connector specs and picker | Pass, 9 of 9 (after the page change) |
| Web unit: whole suite | 95 files, 548 of 548 (before the page change) |
| Connector access (scope, owner, lock, masking, portal) | Pass, 21 of 21 |
| Connector live-PG, portal | Pass, 3 of 3 and 3 of 3 |
| Connector role guard (triggers, concurrency, routes) | Pass, 14 of 14 |
| Role assignment end (containment route keeps history) | Pass, 8 of 8 |
| Migration 0097 precheck, verify, rollback, re-apply | Pass, 6 of 6 |
| User lifecycle, 0054 runbook | Pass, 7 of 7 and 11 of 11 |
| Migration and batch: audit-batch 19, enforcement 19, role-management 11, feature flags 5, migration-sequence 4, flag persistence 3 | Pass, 61 of 61 |
| Migration lock (`check-migrations-immutable`) | Pass, 87 files unchanged |
| ESLint on touched connector files | 0 errors |

Not run:
- The whole API integration suite on the final code. A run before this round had 4 failures; all four are fixed and their files pass. Other modules were not re-run, by your instruction to limit the run to this task.
- The tenant-isolation suite (18 files). It was last run before the shared harness gained one additive field.
- E2E (Playwright).
- Anything on hosted.

## 4. Migration readiness (0097)

- Precheck: refuses while a connector login holds an open role or a staff account holds a reserved role. Tested.
- Verify: `97.verify.sql` reports no FAIL rows after apply. Legacy reserved roles are an INFO row. Tested.
- Rollback: `97.rollback.sql` removes the guards and changes no data. Tested, including that a connector login can take a role again while the guard is off, and that re-applying is refused while such a row is open.
- Replay on a fresh database with 0097 applied passes (`migration-sequence`).
- Lock: recorded at the rewritten hash. The earlier provisional entry was replaced because the file had never been merged or applied. This is a process deviation to review.
- Hosted: not applied. The precheck refuses until the partner's open RM assignment is ended.

## 5. Approvals still required

Nothing below has been done. Each needs explicit approval:
1. Evidence export (run `connector-containment.evidence.sql` on the linked project). Checkpoint C5.
2. Suspension of the partner login, yes or no, with a reason. Checkpoint C2.
3. Removal of the RM role through the API. Checkpoint C1, naming the operator.
4. Whether the partner keeps portal access afterwards. Checkpoint C3.
5. The identity question: whether `Farhan Finance` and `Farhan Finance (Partner)` are one person. Checkpoint C4.
6. Applying migration 0097 to hosted. Only after the containment steps and the post-check.
7. Decisions: whether the lookup may show legal names to lead, finance and share holders; whether bank and agreement permissions reuse existing permissions or get a new `connector.finance_read`.

## 6. Known gaps (not fixed here)

- A database superuser can bypass the triggers (`session_replication_role`) or write directly. The guard assumes ordinary writers.
- Suspending the login does not revoke its Supabase sessions. The API refuses requests from it, so access ends on the next request. Revoking sessions needs the identity provider's admin API, which this change does not call.
- The UI has no owner-change control. The API supports it, with the reason and the audit event.
- Reads are not audited (decision L).
- The subject-first identity binding in the resolver ignores the token's e-mail once a subject is bound. This is existing design; it is recorded for review.

## 7. Can connector development start?

Yes, for local work that does not touch the partner account, hosted, or the migration apply. The role-less model, the internal-API gate, the owner and scope rules, the lookup, the locking and the masking are in place and tested locally.

Do not roll connector changes to production yet. That waits on the approvals in section 5, on applying 0097 after containment, and on the decisions in section 5, item 7.
