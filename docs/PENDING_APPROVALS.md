# Approvals, Decisions, and Coordination Status (Vaibhav's Modules)

**Status:** RESOLVED & SIGNED OFF, except the open spec confirmation in §2 (Module 16 transition table)  
**Date Updated:** 2026-10-28 (§2 corrected to the verified implementation)

---

## 1. Module 1 (Tenant): Platform Realm & Super Admin Provisioning (RESOLVED & VERIFIED)

> **Status: APPLIED & 32/32 VERIFIED ON HOSTED SUPABASE.**  
> Migration `20261001000050_platform_realm.sql` was applied to the hosted database (`mlpkwwhnagxzinaohdxg`).  
> All 32 verification assertions in `tools/sql/0050/verify.sql` have passed:
>
> - `ROLE-PLATFORM-SUPERADMIN` exists with exactly platform permissions + `audit.read`.
> - Super Admin account `vaibhav.qloax@gmail.com` is active in `auth.users` and mapped to platform realm.
> - Operator permissions stripped from customer tenants.
> - Zero cross-tenant data leaks; strict fail-closed RLS enforced across all tables.

## 2. Module 16 (Applications): Withdraw and Reopen Transitions (BUILT; SPEC CONFIRMATION OPEN)

> **Status: WITHDRAW AND REOPEN BUILT ON 2026-10-19 AND VERIFIED ON 2026-10-28. REOPEN OF A TERMINAL LENDER OUTCOME NOT BUILT.**
> The earlier "deferred to Release 2" status is superseded: the code in `apps/api/src/modules/origination/applications/transitions.ts` has both.
>
> - Transitions built and tested (`transitions.spec.ts` 14, `transitions.int.spec.ts` 16, `application-parties.int.spec.ts`, isolation `applications.spec.ts`):
>   - `T-APP-01`: DRAFT -> DOCUMENTS_PENDING (application.update; selects the product version, builds the checklist)
>   - `T-APP-02`: DOCUMENTS_PENDING -> UNDER_REVIEW (application.review)
>   - `T-APP-04`: UNDER_REVIEW -> READY_FOR_SUBMISSION (application.review; mandatory checklist items complete)
>   - `T-APP-08`: DOCUMENTS_PENDING, UNDER_REVIEW or READY_FOR_SUBMISSION -> WITHDRAWN (application.withdraw; reason of 5 to 200 characters)
>   - `T-APP-09`: CANCELLED or WITHDRAWN -> DRAFT (application.reopen; reason required; the cancel reason is cleared)
>   - `T-APP-10`: DRAFT, DOCUMENTS_PENDING or UNDER_REVIEW -> CANCELLED (application.cancel; one of four cancel reasons)
> - SUBMITTED and the states after it are set by the lender-case and sanction roll-up, not by this endpoint.
> - **Open (needs the Notion T-APP table):** the T-APP table was not available when this was built, so the from/to states and permissions above are agreed assumptions, and the codes T-APP-08 and T-APP-09 themselves are assumed. T-APP-03, 05, 06 and 07 are not built. Reopening a terminal lender outcome (`application.reopen_terminal`, REJECTED or CLOSED) is not built: such a reopen is refused (409).

## 3. Modules 14 & 15 (Lenders & Products): Routing & Management Pages (RESOLVED & ALIGNED)

> **Status: RESOLVED & ALIGNED.**
>
> - Routes `/lenders` and `/products` point to feature modules `features/lenders/` (`LenderListPage`, `LenderDetailPage`) and `features/products/` (`ProductCataloguePage`, `ProductDetailPage`).
> - Full test suite passing across all lender and product components (`lenders.spec.tsx`, `products.spec.tsx`, and `admin/products.spec.tsx` — 14/14 tests pass).
> - Versioning terms validation and admin helper types retained in `features/admin/` for cross-module type safety.

## 4. Module 20 (Documents): Verifier Checklist Attestation Contract (RESOLVED & SIGNED OFF)

> **Status: SIGNED OFF & FULLY IMPLEMENTED.**
>
> - Canonical attestation schema formalised in `@dsa/contracts` (`ChecklistAttestationRequestSchema` with `CHECKLIST_REVIEW_STATUSES` and `CHECKLIST_REJECT_REASONS`).
> - Enforced in API and backed by unit/integration tests (`TEST-VRF-010`, `TEST-VRF-021`, `TEST-VRF-025` in `verification.spec.ts`).
> - Verification UI in `features/verifications/` fully consumes and handles attestation reviews.

## 5. Module 13 (Grievances): SLA Due-Date Rule (RESOLVED: OPTION B IMPLEMENTED)

> **Status: IMPLEMENTED & VERIFIED.**
>
> - Option B (Statutory 30-day SLA standard from acknowledgement) adopted and implemented in `apps/api/src/modules/crm/grievances/complaints.ts`.
> - Intake automatically assigns `due_at = now + 30 days` when not explicitly supplied.
> - Verified with 100% passing test suite in `apps/api/test/grievances.spec.ts` and `apps/api/test/grievances.int.spec.ts`.

## 6. Done without anyone else (2026-10-15 & 2026-10-16)

- Toasts on every write, permission-based sidebar (including admin, reporting, performance and import items),
  no retry on 401/403, and a single clear "You don't have access" message for every 403 (screens and toasts).
- Messaging page shows a notice when its requests are refused.
- Tests added for the sidebar, retry policy, MFA helper, toast behaviour, Grievances access and the 403 message.

## 7. Module 17 (Eligibility): built locally, not deployed, decisions open

> **Status, stated separately.**
> - **Local code: built for the agreed scope.** A check runs the approved rule set through the decision engine. Missing, stale, unaccepted or non-primary information cannot give a pass. The test results are in `docs/COMPLETION_TRACKER.md`, row 17.
> - **Local database tests: passing** on Testcontainers PostgreSQL 16, including migration 0094 on a throwaway database (`apps/api/test/eligibility-migration.int.spec.ts`).
> - **Hosted writes from this work, all on 2026-10-29 and owner-approved: the 0086 EXECUTE revoke, migration 0094, and migrations 0095 and 0096.** Each was verified read-only afterwards (`docs/HOSTED_STATUS_2026-10-29.md`). The 2026-10-29 read-only check (`docs/HOSTED_STATUS_2026-10-29.md`) found the objects of 0092 and 0093 present, and the hosted state differs from the 2026-10-17 record in ways the owner must explain: the tenant set, and the grants on the 0086 functions. The "Migration status" section below has the detail.
> - **End-to-end: not verified.** Of the 41 Playwright tests in the three specs this work touches (06, 08, 15), 6 pass and 35 fail, for causes outside this work (see tracker row 17). The eligibility mocks in specs 06 and 08 therefore have not run past the sign-in step.
> - **Production readiness: not ready.** The approvals in the last section are open, 0094 is not applied, and the end-to-end suite does not run for the reasons recorded.

### What the check does (code)

- A run locks the application row. It refuses an application that is `CLOSED`, `REJECTED`, `WITHDRAWN` or `CANCELLED`, and one with no product version.
- It builds the facts the rules read from usable figures only:
  - credit data only while the tenant has `eligibility.manual_credit_entry` switched on, and only while the report is 90 days old or less;
  - verified income only when its checklist document belongs to the primary applicant and is still `ACCEPTED`.
- The decision engine evaluates `DK-application.eligibility`. Before anything is saved, the rule set version's canonical hash is checked. A mismatch refuses the run (409 `CONTENT_HASH_MISMATCH`), and the decision record is rolled back with it.
- A `PASS` needs a matched rule, no fallback, nothing pending, and no fact the engine reports as missing. A decisive `FAIL` stands even when other information is missing.
- The saved assessment keeps the product version, the rule set version, the decision record, the matched rule codes and the codes of missing information. It never keeps the applicant's values or the input fingerprint.
- An override is allowed only on a `FAIL`, only on the latest assessment, once per product result and set of inputs. Overrides are serialised by the application row lock. A database error while looking up the application is reported as an error, not as "not found".
- Audit events (`eligibility.assessed`, `eligibility.overridden`, `eligibility.inputs_updated`) are written in the same transaction and carry no applicant values.
- Without the decision definition from migration 0054, a run answers 503 `DEPENDENCY_UNAVAILABLE`.

### Behaviour to confirm

1. **Who may do what.** Run a check and record figures: `application.update`. Read the checks and their history: `application.read`. Read the figures (`GET …/eligibility-inputs`): `application.update`, because they are personal financial data. Override: `eligibility.override`. No new grant was added.
2. **Only verified income reaches the rules.** Declared income is stored and shown, but never used. Verified income must come from the primary applicant's accepted income document. The income picker lists only the primary applicant's accepted items. The server also requires an income document type and refuses anything else with 422 (`NOT_INCOME`).
3. **Manual credit data is off by default.** The flag is changed only through the platform routes, which require `platform.flags`, so a tenant cannot switch it on for itself. Turning it off stops its use at once, including for data recorded earlier. A report older than 90 days is treated as stale. The 90 days is a placeholder (`CREDIT_DATA_MAX_AGE_DAYS`).
4. **Dates and free text.** A report date must be a real day, and it may not be later than today's business day. Business days are taken in `Asia/Kolkata`, the platform's default timezone (`apps/api/src/modules/platform/configuration.ts`). Per-tenant timezones are not used by this module. An override reason that carries a PAN, an Aadhaar number or an account number is refused (422).
5. **Decision records** keep the facts the decision used, with the credit score and the income replaced by `[redacted]` (`apps/api/src/modules/rules/engine/snapshot.ts`). The decision runs on the real values, and its input hash covers them.
6. **The indicative ceiling** (`indicativeMaxAmount`) is in the API response on a `PASS`, and the screen does not show it. See decision F.
7. **No outbox events** are written for assessments or overrides, because no consumer exists.
8. **FOIR is not calculated.** It is not in the approved rules or in any specification in this repository.
9. **"Net" income.** The approved income rule's reason text says "Monthly net income" (migration 55). The figure the rules read is the verified monthly income entered from an income document. See decision H.

### Decisions (open; each needs its named owner)

- **A. Manual credit score entry and its window (credit policy owner).** Is entry permitted at all? If so, what is the maximum report age? Until decided, the flag stays off. The 90 days is a placeholder.
- **B. Bureau integration, consent and retention (credit policy owner; Dev 1 for configuration).** No integration exists, so nothing is recorded as bureau-verified. Before any integration: the provider, the consent wording and the retention period.
- **C. Override authority (credit policy owner).** Migration 55 grants `eligibility.override` to ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS and ROLE-TENANT-ADMIN. Decision D1 (2026-10-17) kept the grant as written. Re-confirm it. To remove the grant for some roles, run `tools/sql/batch/55.revoke-override-grants.sql` (in the repository) only after an explicit decision.
- **D. `rule.simulate` and the decision records (rules owner, Dev 2).** `GET /v1/decision-records` requires `rule.simulate`. An eligibility record still holds the requested amount, the tenure and the product; only the credit score and the income are redacted. Decide whether to narrow the permission, or to redact these fields too.
- **E. Accepted income documents (credit policy owner).** Default: `SALARY_SLIP` and `ITR`, plus a tenant's own types in category INCOME. Confirm the list for each tenant. The picker shows only the primary applicant's accepted items; it does not yet filter by document category, because the category is not in the checklist response. The server enforces the category.
- **F. The indicative ceiling (credit policy owner).** The API returns it on a `PASS`; the screen hides it. Decide whether users may see it, and the wording.
- **G. Assessments written before this change (product owner).** Earlier rows have no provenance and an UNKNOWN result; they are not re-evaluated. Leave them, or mark them superseded. A new check is the only way to get a current result.
- **H. Which income figure the rule means (credit policy owner).** The approved rule says "net". Decide whether the verified figure from the document is that net figure, and which documents are acceptable for it.
- **I. Separation of duties (product owner).** Nothing stops one person from recording figures, running a check and overriding the result. Decide whether any of these must be different people.
- **J. Checks and overrides after submission (product owner).** Both are allowed until the application is closed, withdrawn, rejected or cancelled, including after it is submitted to a lender. Decide whether they should stop at submission.
- **K. Product version status (product owner).** A check uses the product version on the application and does not refuse a retired version. Decide whether it should.
- **L. Reads of applicant figures (privacy owner).** Reading the figures is not audited. Decide whether reads of credit and income data must be logged.

### Migration status

Every migration file in `supabase/migrations/` (84 files) has a row in `docs/MIGRATION_MATRIX.md`, an entry in `supabase/MANIFEST.md` and an entry in `supabase/migrations.lock.json`. `tools/check-migrations-immutable.ts` reports all 84 unchanged. The hosted state below comes from the documents named and from the 2026-10-29 read-only check (`docs/HOSTED_STATUS_2026-10-29.md`). That check is catalog-only: the migration ledger is absent, so it cannot show which migration files ran.

| Migrations | Hosted state (evidence) |
|---|---|
| 0001–0053 | Applied before the batch of 2026-10-17; the rehearsal report starts from the hosted state at 0053 (`docs/MIGRATION_BATCH_REHEARSAL_REPORT.md`). |
| 0046 | Recorded as applied (`docs/MIGRATION_MATRIX.md`). |
| 0048 | Recorded as applied to hosted on 2026-10-15 (`docs/MIGRATION_MATRIX.md`). |
| 0054, 0055, 0057–0061, 0063–0065 | Applied 2026-10-17, each with its verify script passing (tracker, section 12). 0062 was not in that batch. |
| 0066–0068 | Recorded as applied, verified by the preflight prerequisite check (`docs/MIGRATION_MATRIX.md`). 0068 creates `tenant_feature_flag`, which 0094 depends on. |
| 0069–0085 | Recorded as applied on 2026-10-21, each with its verify script. |
| 0086 | **Dropped on hosted 2026-10-29** by migration 0096. The EXECUTE revoke was applied the same day, with approval, and verified. Review: `docs/MIGRATION_0086_TEST_LOGIN_REVIEW.md`. |
| 0087 | **Not recorded as applied.** 142 views in `public` were found on hosted (remediation plan, 2026-10-26); the migration's broad grants are described there as a finding (R8). |
| 0088–0090 | **Not recorded** in any document. |
| 0091 | **Recorded as applied on 2026-10-27** by the owner. On 2026-10-29 its `dsa_app` revoke is not in effect, so the earlier "verified read-only" record is contradicted. |
| 0092, 0093 | **Objects present on hosted** (2026-10-29). Apply date and operator not recorded. Do not apply again until the owner confirms what ran. |
| 0094 | **Applied to hosted 2026-10-29** (owner-approved; `94.verify.sql` 7 of 7 PASS). Created locally and tested on a throwaway database. |
| 0095 | Applied 2026-10-29: PUBLIC's EXECUTE removed from the 24 app routines; `dsa_app` holds explicit grants on them (verify PASS). |
| 0096 | Applied 2026-10-29: the two test-login functions dropped (verify PASS). |

### Migration 0094: review

- **Additive.** The new table is empty, and the seven new columns are nullable or default to empty arrays, so no existing row is rewritten. The two indexes are built without `CONCURRENTLY`, which blocks writes to `eligibility_assessment` while they build. That table is small today.
- **Not re-runnable** (plain `CREATE`). The wrapper runs it in one transaction, so a second apply fails before anything changes.
- **Prerequisites** (`tools/sql/batch/94.prereq.sql`): 26 read-only rows, including six structural checks that the migration depends on (the unique keys its foreign keys and `ON CONFLICT` use, and the columns it reads).
- **Rollback refuses while data would be lost** (`tools/sql/batch/94.rollback.sql`): when any applicant figure exists, when any assessment carries provenance in any of the seven columns, or when a tenant has its own setting of the flag. The refusal runs before any `DROP`.
- **Tested on a throwaway database** (`apps/api/test/eligibility-migration.int.spec.ts`): verify passes after apply; rollback refuses while a tenant setting exists; with nothing to lose, rollback removes the objects; the prerequisite check passes on the clean database; the migration then applies again and verifies.
- **Pair the rollback with the code.** The code reads and writes the new columns, so revert the code before rolling the migration back.

### Hosted runbook for 0094 (applied 2026-10-29: steps 1 to 5 run; step 6 not needed)

Before any step, confirm the linked project is `DSA-Agent`, ref `mlpkwwhnagxzinaohdxg` (`supabase/.temp/project-ref`). Stop if it is any other project.

1. **Prerequisites (read-only).** `npx supabase db query --linked -f tools/sql/batch/94.prereq.sql`. Expect every row PASS, except the INFO row. A FAIL on a row that reads "not present yet" means 0094 is partly applied: stop and read `94.verify.sql`.
2. **State, outside the repository.** Take the same entity snapshot as the 2026-10-17 batch (`~/dsa-backups/batch-20261017/state-before.json`). The repository does not contain the script that produced it. Also record the row counts of `eligibility_assessment`, `feature_flag` and `tenant_feature_flag`.
3. **Wrapper (no database connection).** `node tools/sql/make-apply-run.mjs supabase/migrations/20261001000094_eligibility_inputs_and_provenance.sql ~/dsa-backups/batch-94/`. Expect the source SHA-256 `edf565d1d48c355a70a0b38de028722de42a78d0b186944afbda211bb217d78f` and `body equals the migration: YES`. Stop on anything else.
4. **Apply (writes to hosted).** `npx supabase db query --linked -f ~/dsa-backups/batch-94/apply-run.sql`. Expect no error. An error means the transaction rolled back; read the message before retrying.
5. **Verify (read-only).** `npx supabase db query --linked -f tools/sql/batch/94.verify.sql`. Expect seven rows, all PASS. Run it straight after the apply: its last row starts to fail once any tenant switches the credit flag on, so it is not a routine health check.
6. **Only if a verify row is FAIL (writes).** `npx supabase db query --linked -f tools/sql/batch/94.rollback.sql`. Expect it to apply, or to refuse with the reason. A refusal changes nothing.
7. **Deploy the code that reads the new columns only after step 5 passes.**

### Approvals needed (numbered; none has been given)

1. **Done 2026-10-29 (approved; applied and verified, 7 of 7).** Previously: either approve the runbook above, or approve me to run steps 1, 3, 4, 5 and 6 one at a time, with the prerequisite check first. That check passed on 2026-10-29.
2. **Migrations 0092 and 0093 on the hosted project.** Their objects are already present, so this is no longer an apply. Approve: (a) the owner confirms what ran and when, from the operators' records; (b) verify scripts exist (item 8). Before the invitation API is deployed (`docs/INVITATION_HOSTED_CHECKLIST.md`, section 1).
3. **Migration 0086's functions.** **Done 2026-10-29 (approved):** EXECUTE was revoked from PUBLIC, `dsa_app` and `dsa_api`, and verified. Before the revoke, `dsa_api` had run the functions 167 times in the retained statement history (`docs/HOSTED_STATUS_2026-10-29.md`, "Investigation"). Done 2026-10-29 (approved): the two functions were dropped by migration 0096 (`supabase/migrations/20261001000096_drop_test_login_functions.sql`). Re-creating them needs 0086's definitions (`tools/sql/batch/96.rollback.sql`). Recorded in `docs/MIGRATION_0086_TEST_LOGIN_REVIEW.md`, section 4.
4. **Owner for migration 0086.** It is listed as "owner to confirm" in the manifest and the matrix.
5. **Confirmation that no deployed API runs test login**, or that the published test secret is not used on any deployment: read-only probes of any deployed API (`GET /public/v1/auth/test-users` and `POST /public/v1/auth/test-login` must return 404).
6. **The remediation items of the 2026-10-26 review that are not built:** P1-2 (drop `app.authenticate_user` and the `password_hash` column), P1-3 (remove the remaining broad grants on `public`), P2-5 (row-level security on `decision_definition`, `decision_dependency` and `permission`), P2-6 (reconcile schema drift). Each needs approval and a migration.
7. **Eligibility decisions A to L** (owners in the list above). The ones that change behaviour before any deployment are A (credit entry), C (override roles), H (net income) and I (separation of duties).
8. **Verify and rollback scripts for 0086 to 0093.** Written 2026-10-29 as `tools/sql/batch/86` to `93` (verify and rollback each). The verify files are read-only: all pass on hosted (2026-10-29). The rollbacks are not run; 0091's refuses by design. The batch standard in `tools/sql/batch/README.md` requires them before a hosted apply.
9. **Done 2026-10-29 (approved): shared E2E persona mock.** `e2e/helpers/mock-session.ts` now answers the authenticator challenge and verify requests, and waits 15 s for the code prompt. It did not turn the affected tests green; see `docs/ELIGIBILITY_FINAL_REPORT.md`, E2E section.
10. **`openapi/openapi.yaml`.** Keep the regenerated file (it includes unrelated drift), or revert the unrelated sections.
11. **Commit.** Nothing has been committed. The working tree holds this work together with pre-existing uncommitted changes (`docs/ELIGIBILITY_FINAL_REPORT.md`, "Working tree").
12. **Hosted tenant set and grants.** On 2026-10-29 hosted has 2 tenants (the 2026-10-17 record lists 7), and the approved eligibility rule set is in 1 of them. The owner explains that change, and the 0086 and 0091 grant differences, before any further hosted step (`docs/HOSTED_STATUS_2026-10-29.md`).
13. **Done 2026-10-29 (approved): PUBLIC's EXECUTE on the 24 app routines.** Migration 0095 removed it. `dsa_app` and `dsa_api` keep every routine they could run (43); anon, authenticated and service_role can run none.

## 8. Clean Database Setup Issues (RESOLVED by Akash)

All blockers for fresh database setup (`supabase db reset` and `tests/isolation/harness.ts`) have been resolved:

1. `20261001000019_verification.sql`: Removed inline foreign keys to `loan_application` and `application_party` that do not exist at file order 0019. The foreign keys are safely applied in `20261001000021_origination_application.sql` via an idempotent `DO $$ ...` block once those tables exist.
2. `20261001000037_api_development.sql`: Corrected column name from `task_ref` to `introduced_in` on `app.permission`, and ensured RLS policy creation is idempotent (`DROP POLICY IF EXISTS`).
3. `20261001000042_audit_tamper_evidence.sql` and the security migration (renamed to `20261001000063_security_monitoring_incidents.sql` on 2026-10-16 to end a duplicate 0043; content unchanged): Corrected column name from `task_ref` to `introduced_in`, and ensured RLS policy creation is idempotent.
4. Clean database migrations run in alphabetical sequence with zero errors.
