# Eligibility (MOD-ELG, Module 17): final implementation report

Status date: 2026-10-29. Verification runs: 2026-10-28, with the API unit suite re-run and the targeted E2E rerun on 2026-10-29.

## Status, stated by layer

| Layer | Status |
|---|---|
| Local code | Built for the agreed scope. |
| Local tests | Pass, except the end-to-end suite (below). |
| Hosted database | Migration 0094 is **applied** to the shared development project (2026-10-29, owner-approved; verify 7 of 7 PASS). Migrations 0095 and 0096 were applied the same day: PUBLIC's EXECUTE was removed from the app routines, and the test-login functions were dropped. The 2026-10-29 read-only check found hosted different from the records in several places (`docs/HOSTED_STATUS_2026-10-29.md`). |
| End-to-end | **Not verified for eligibility.** 6 of 41 pass in the full run, before the shared MFA mock update; the failures predate this work. |
| Production readiness | **Not ready.** The approvals still open are listed at the end of this report. Decisions A, C, H and I are recommended as production blockers. |

## What was built

- **Assessment (API-ELG-001 to 004).** A run locks the application row, refuses closed, withdrawn, rejected and cancelled applications, and needs a product version. It evaluates `DK-application.eligibility` through the decision engine. Before anything is saved, the rule set version's canonical hash is checked; a mismatch refuses the run with 409 `CONTENT_HASH_MISMATCH`. A `PASS` needs a matched rule, no fallback, nothing pending and no fact the engine reports as missing. A decisive `FAIL` stands even when other information is missing.
- **Provenance.** Each assessment keeps the product version, the rule set version, the decision record, the matched rule codes and the codes of missing information. It never keeps the applicant's values or the input fingerprint. Decision records keep the used facts with the credit score and income replaced by `[redacted]`.
- **Applicant figures (GET and PUT `…/eligibility-inputs`).** Declared income is stored and shown but never used. Verified income must come from the primary applicant's accepted income document; a co-applicant's document is refused (`NOT_PRIMARY`). Manual credit data is off by default behind the tenant flag `eligibility.manual_credit_entry`; the flag is changed only through platform routes that require `platform.flags`. Reports older than 90 days are stale (a placeholder; decision A).
- **Overrides (API-ELG-003).** Only on a `FAIL`, only on the latest assessment, once per product result and set of inputs, serialised by the application row lock. The reason is refused if it carries a PAN, an Aadhaar number or an account number.
- **Dates.** "Today" is the Asia/Kolkata business day, the platform's default timezone (`apps/api/src/modules/platform/configuration.ts`). The API and the web app use the same rule.
- **Audit.** `eligibility.assessed`, `eligibility.overridden` and `eligibility.inputs_updated`, written in the same transaction, carrying no applicant values.
- **Screens.** Eligibility card on the application page, eligibility list, and the applicant-figures panel. The income picker lists only the primary applicant's accepted items. The indicative ceiling is returned by the API but not shown (decision F).
- **Migration 0094** (`supabase/migrations/20261001000094_eligibility_inputs_and_provenance.sql`). Adds the `applicant_financial_input` table (row-level security forced), seven provenance columns and two indexes on `eligibility_assessment`, and the flag row (off). Prerequisite, verify and rollback scripts are in `tools/sql/batch/94.*`.

Not built, by decision: bureau credit data, FOIR (not in the approved rules or any specification here), and outbox events (no consumer).

## Test results

| Check | Result | When |
|---|---|---|
| API typecheck | pass | 2026-10-28 |
| API unit (`npm run test -w @dsa/api`) | 89 files, **1150 of 1150 pass** | 2026-10-29 |
| Eligibility integration and migration 0094 (Testcontainers, real database) | **26 of 26** (`eligibility.int.spec.ts` 23; `eligibility-migration.int.spec.ts` 3) | 2026-10-28 |
| Applications isolation (`tests/isolation/cases/applications.spec.ts`) | **11 of 11** | 2026-10-28 |
| Web tests (`npm run test -w @dsa/web`) | 91 files, **523 of 523 pass** | 2026-10-28 |
| Web typecheck | pass | 2026-10-28 |
| Web production build | pass (20.6 s; existing chunk-size warning only) | 2026-10-28 |
| Lint, changed files | **0 errors, 16 warnings**, all pre-existing | 2026-10-28 |
| Migration immutability (`tools/check-migrations-immutable.ts`) | 84 files unchanged; 0094 hash matches the lock | 2026-10-28 |
| Manifest version tests (`migration-versions.spec.ts`) | 4 of 4 pass | 2026-10-28 |

Notes on the API unit suite. On 2026-10-28 one test, `TEST-MFA-API-05` in `mfa-enforcement.spec.ts`, timed out at 30 s during the full run, although it took 16 s in an earlier run. On 2026-10-29 the full suite passed, and the file passes alone in 13.6 s. The margin against the 30 s limit is thin, so the test is load-sensitive. It is not an eligibility test, and this work did not change the code it covers.

## End-to-end results and analysis

Full run, 2026-10-28, specs 06, 08 and 15 (41 tests, 1 worker, 39.9 min, exit 1): **6 pass, 35 fail.**

Passing: TC-RM-01; TC-MATRIX-00; TC-MATRIX-ROLE-TEAM-MGR-ROUTES; TC-MATRIX-ROLE-RM-ROUTES; TC-MATRIX-ROLE-SALES-EXEC-ROUTES; TC-MATRIX-ROLE-FINANCE-EXEC-ROUTES.

Failure causes, from the 35 failure artifacts:

- **30 stop at the "Set up two-step verification" dialog.** Since commit `2503ed6` (2026-10-27), sign-in asks the auth service whether authenticator sign-in is enabled. The persona mock covers only the factor-list path, returning a verified factor. The challenge and verify requests fall outside its patterns, so the dialog blocks every later step. This reading comes from the code and the mock's route patterns, not from a captured request.
- **4 stop on the login page** ("Welcome Back"), with sign-in not completed.
- **1 fails a customer-data assertion** (TC-RM-05: the shell renders, and the customer name is not found).
- **Two tests (TC-LO-06 and TC-LO-08) hang for the 10-minute test timeout.** Their click actions have no timeout.

None of the 35 failing assertions involves an eligibility element. The two captures that mention eligibility show only the sidebar link, and the page snapshots show no crash or error boundary.

**Targeted rerun, 2026-10-29, before the mock update:** TC-LO-05 (25.2 s), TC-RM-05 (33.1 s) and TC-MATRIX-ROLE-RM sidebar (23.8 s) fail as before. TC-MATRIX-ROLE-RM-ROUTES passes (1.1 min).

**Shared MFA mock updated, 2026-10-29 (approved item 9).** Cause: supabase-js reads the authenticator list from the user returned by `GET /auth/v1/user`. The persona user carried no factors, so every persona was sent to enrolment. The mock now gives the user a verified authenticator and answers the challenge and verify requests. The helper waits 15 s for the code prompt (it waited 4 s). Results: the code prompt replaces the enrolment prompt. TC-LO-02, TC-LO-05 and TC-RM-05 now fail further into their flows, at data and permission assertions. TC-MATRIX-ROLE-RM still stops at the code prompt; its sign-in path does not complete the code step, and that is not yet diagnosed. TC-MATRIX-ROLE-RM-ROUTES passes (one batch run failed; it passed when run alone and in two later runs). The five previously passing tests re-run: 5 of 5 pass, so no regression was measured. None of the affected tests reaches an eligibility element yet.

**Why these are pre-existing.** The failing steps occur before, or independently of, the lines this work changed. `LoginPage.tsx`, `SecondFactorDialog.tsx` and `mfa-project.ts` are unchanged from HEAD. The shared helper `e2e/helpers/mock-session.ts` was changed on 2026-10-29 (see above). I did not run the suite at HEAD, so the claim rests on the code path, not on a before-and-after run.

**Consequence.** The eligibility mocks added to specs 06 and 08 run only after sign-in, which these tests never reach. They are therefore unverified by E2E. The shared MFA mock was updated after approval (item 9 below). It changes the results of all 17 E2E specs; the five previously passing tests re-run without regression.

## Fixes made in this work

In order of the session:

1. Eligibility check: a PASS also requires that the engine reports no missing fact. The approved rules never trigger this, so it is a latent guard. Unit test added.
2. Override lookup: only `NOT_FOUND` maps to 404; database errors are no longer reported as "not found".
3. Migration 0094 rollback guard: refuses while any of the seven provenance columns holds data (previously three were checked). The new branch has no test of its own; the existing rollback tests cover the tenant-flag branch.
4. Migration 0094 prerequisite script: six structural checks for unique keys and columns the migration depends on. Covered by `eligibility-migration.int.spec.ts`.
5. Report dates: "today" is the Asia/Kolkata business day in the API and the web app, so a report dated today in India is accepted between 00:00 and 05:30 IST, when the UTC date is still the day before. Unit tests added (API rules spec; web review spec).
6. Income picker: lists only the primary applicant's accepted items. The server still enforces the income document type. Unit test added (web review spec).
7. Test file formatting, and the page spec mock updated for the new lookup.
8. Shared E2E persona mock (approved item 9): the mocked user carries a verified authenticator, and the challenge and verify requests are answered; the code-prompt wait is 15 s. Details in the E2E section. This did not turn the affected tests green.

## Remaining defects and gaps

Severity reflects the effect on production use.

- **High, blocks production:** migration 0094 is not applied to any database. The eligibility decisions A (credit entry), C (override roles), H (net income) and I (separation of duties) are open. End-to-end coverage of the eligibility flows is unverified (see above).
- **High, security (migration 0086):** see the section below. EXECUTE was revoked from PUBLIC, `dsa_app` and `dsa_api` on 2026-10-29, and the functions were dropped the same day by migration 0096 (approved, verified).
- **Medium:** the approved income rule says "monthly net income", but the figure the rules read is verified monthly income from a document (decision H). Checks and overrides are allowed after submission (decision J). Product version status is not checked at run time (decision K). Reads of applicant figures are not audited (decision L). Credit data has no consent or retention rule (decision B). The picker does not filter by document category, because the checklist response carries no category; the server enforces it (422).
- **Low:** the business timezone is the platform default, not a per-tenant setting. The history list is ordered by id and "latest" by database time; they can differ only if application-server clocks disagree. The approved reason text says "Credit bureau score", although no bureau exists; changing approved text needs a forward migration. The regenerated `openapi/openapi.yaml` includes unrelated drift from other sections (decision needed: keep or revert those sections). Sixteen lint warnings and the E2E failures are pre-existing.

## Migration 0086 (QA login helpers): security findings

Full review: `docs/MIGRATION_0086_TEST_LOGIN_REVIEW.md`. Summary:

- **Design exposure, Critical (audit AUD-001, 2026-10-26).** `app.list_test_users()` returns every active staff member's email, name, tenant and role, across all tenants. `app.lookup_test_user()` returns the identity-provider subject for any email, with no tenant check. Both are `SECURITY DEFINER`, so they bypass row-level security.
- **Current state on the shared hosted project.** The two functions were dropped on 2026-10-29 by migration 0096, after EXECUTE had been revoked from PUBLIC, `dsa_app` and `dsa_api` (approved; verified).
- **Route gating.** `GET /public/v1/auth/test-users` lists users with no credential. `POST /public/v1/auth/test-login` accepts the fixed code `000000` (the default `TEST_BYPASS_OTP`). Both routes are mounted only when `TEST_AUTH_ENABLED=true` and the checks in `apps/api/src/test-auth.ts` pass: not production, a local Supabase URL, a local or approved test database, never the shared project, and a bypass secret that is not published.
- **Forged-token path (AUD-002).** The current verifier accepts the published bypass secret only against a local Supabase URL, and `BYPASS_JWT_SECRET` has no default. A deployed build older than that change is not verified.
- **Open:** the containment plan says a previous build may have run on hosted and logged emails and one-time codes. No hosted API is recorded as deployed (updated 2026-10-27). No probe has been run.
- **Recommended remediation** (none done here): revoke EXECUTE from PUBLIC, `dsa_app` and `dsa_api` (done 2026-10-29) and confirm it on a schedule; confirm no deployed API runs test login; drop both functions in a new migration once the test route is removed, with owner approval; remove the default code and retire the published secret; review old logs under a retention decision; record an owner for 0086.

## Migration status

Every one of the 84 migration files has a matrix row, a manifest entry and a lock entry. Hosted state comes from the documents named in `docs/MIGRATION_MATRIX.md` and `docs/COMPLETION_TRACKER.md` section 12, and from the 2026-10-29 read-only check (`docs/HOSTED_STATUS_2026-10-29.md`). That check cannot show which migration files ran: the ledger is absent.

| Migrations | Hosted state (documented) |
|---|---|
| 0001–0053 | Applied before the 2026-10-17 batch. |
| 0046 | Recorded as applied. |
| 0048 | Recorded as applied 2026-10-15. |
| 0054, 0055, 0057–0061, 0063–0065 | Applied 2026-10-17, each with its verify script. On 2026-10-29 the 0055 rule set is in 1 tenant, not 7 (`docs/HOSTED_STATUS_2026-10-29.md`). |
| 0062 | Not in that batch. |
| 0066–0068 | Recorded as applied; verified by preflight. |
| 0069–0085 | Recorded as applied 2026-10-21. |
| 0086 | Functions created. EXECUTE revoked from PUBLIC, `dsa_app` and `dsa_api` on 2026-10-29; dropped by migration 0096 the same day. |
| 0087 | Not recorded as applied. 142 views in `public` were seen on hosted. |
| 0088–0090 | Not recorded. |
| 0091 | Recorded as applied 2026-10-27 by the owner. Its `dsa_app` revoke is not in effect on 2026-10-29. |
| 0092, 0093 | **Objects present** on 2026-10-29; apply date and operator not recorded. |
| 0094 | **Applied 2026-10-29** (verify 7 of 7 PASS). |
| 0095 | Applied 2026-10-29: PUBLIC's EXECUTE removed from the 24 app routines; `dsa_app` holds explicit grants on them (verify PASS). |
| 0096 | Applied 2026-10-29: the two test-login functions dropped (verify PASS). |

## Hosted deployment steps (not run)

Confirm first that the linked project is `DSA-Agent`, ref `mlpkwwhnagxzinaohdxg` (`supabase/.temp/project-ref`).

**Migration 0094** (full runbook: `docs/PENDING_APPROVALS.md` §7):

1. Prerequisites, read-only: `npx supabase db query --linked -f tools/sql/batch/94.prereq.sql`. Expect every row PASS, except the INFO row.
2. Take a state snapshot outside the repository, as the 2026-10-17 batch did. The repository has no script for it.
3. Build the wrapper: `node tools/sql/make-apply-run.mjs supabase/migrations/20261001000094_eligibility_inputs_and_provenance.sql ~/dsa-backups/batch-94/`. Expect source SHA-256 `edf565d1d48c355a70a0b38de028722de42a78d0b186944afbda211bb217d78f` and "body equals the migration: YES".
4. Apply (writes): `npx supabase db query --linked -f ~/dsa-backups/batch-94/apply-run.sql`.
5. Verify, read-only: `npx supabase db query --linked -f tools/sql/batch/94.verify.sql`. Expect seven rows, all PASS.
6. Only if a verify row fails (writes): `npx supabase db query --linked -f tools/sql/batch/94.rollback.sql`. It refuses while data would be lost.
7. Deploy the code that reads the new columns only after step 5 passes.

**Migrations 0092, then 0093.** Their objects are already present on hosted (2026-10-29), so the first step is for the owner to confirm what ran. Neither has a verify or rollback script yet. The invitation API must not deploy before this is settled (`docs/INVITATION_HOSTED_CHECKLIST.md`, section 1).

## Approvals needed

None of these has been given.

1. **Done 2026-10-29 (approved; applied and verified, 7 of 7).** The prerequisite check passed first.
2. Confirm what ran for migrations 0092 and 0093 (their objects are present on hosted), before the invitation API deploys.
3. Migration 0086: done 2026-10-29 (approved). The EXECUTE revoke was applied, then migration 0096 dropped the two functions in a new migration (irreversible without re-creating them from 0086, and the test route must be removed first).
4. Name an owner for migration 0086.
5. Confirm that no deployed API runs test login or uses the published test secret. This needs read-only probes of any deployed API.
6. Approve the unbuilt remediation items from the 2026-10-26 review: P1-2 (drop `app.authenticate_user` and the `password_hash` column), P1-3 (remaining public grants), P2-5 (row-level security on three reference tables), P2-6 (schema drift).
7. Eligibility decisions A to L (`docs/PENDING_APPROVALS.md` §7). A, C, H and I block production.
8. Verify and rollback scripts for migrations 0086 to 0093: written 2026-10-29 (`tools/sql/batch/86` to `93`). The verify files pass on hosted; the rollbacks are not run. The batch standard in `tools/sql/batch/README.md` requires them before a hosted apply.
9. **Done 2026-10-29 (approved):** the shared E2E persona mock, `e2e/helpers/mock-session.ts`, is updated for the post-`2503ed6` MFA flow. The E2E section records what it changed and what it did not.
10. Decide whether to keep the regenerated `openapi/openapi.yaml`, or revert its unrelated sections.
11. Commit: nothing has been committed. The working tree holds this work together with pre-existing uncommitted changes (see below).
12. **Hosted tenant set and grants.** On 2026-10-29 hosted has 2 tenants (the 2026-10-17 record lists 7), and the approved eligibility rule set is in 1 of them. The owner explains that change, and the 0086 and 0091 grant differences, before any further hosted step (`docs/HOSTED_STATUS_2026-10-29.md`).

## Working tree

Uncommitted changes from this work, with the pre-existing changes left untouched:

- Modified (tracked): `apps/api/src/modules/origination/applications/{documents,eligibility,eligibility-schemas,openapi,schemas}.ts`; `apps/api/src/modules/rules/engine/decision-engine.ts`; `apps/api/test/{eligibility.int.spec,eligibility.spec}.ts`; `apps/web/src/features/applications/{ApplicationDetailPage,EligibilityCard,EligibilityPage,EligibilityPage.spec,eligibility,eligibility.spec}.ts(x)`; `apps/web/src/features/lender-cases/LenderCaseDetailPage.tsx` (minimal change); `apps/web/src/shell/access.ts`; `docs/{COMPLETION_TRACKER,MIGRATION_MATRIX,PENDING_APPROVALS}.md`; `e2e/{06,08,15}*.spec.ts`; `e2e/helpers/mock-session.ts`; `openapi/openapi.yaml`; `supabase/MANIFEST.md`; `supabase/migrations.lock.json`; `tests/isolation/cases/applications.spec.ts`.
- New: `apps/api/src/modules/origination/applications/{eligibility-inputs,eligibility-rules}.ts`; `apps/api/src/modules/rules/engine/snapshot.ts`; `apps/api/test/{decision-snapshot,eligibility-drift,eligibility-migration.int,eligibility-rules}.spec.ts`; `apps/web/src/features/applications/{EligibilityInputsPanel.tsx,eligibility-review.spec.ts}`; `docs/MIGRATION_0086_TEST_LOGIN_REVIEW.md`; `docs/ELIGIBILITY_FINAL_REPORT.md`; `supabase/migrations/20261001000094_eligibility_inputs_and_provenance.sql`; `tools/sql/batch/94.{prereq,rollback,verify}.sql`; `docs/HOSTED_STATUS_2026-10-29.md`; read-only hosted checks `tools/sql/status/01` to `05`.
- **Not changed by this work:** `apps/web/src/features/sanctions/SanctionsPanel.tsx` (uncommitted before this work). `ApplicationDetailPage.tsx` also carries uncommitted hold and transition-card changes outside the eligibility card. I did not verify their origin; they were not reverted.

Nothing has been committed. Nothing has been written to the hosted database.
