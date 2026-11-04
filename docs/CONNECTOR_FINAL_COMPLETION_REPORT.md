# Connector ecosystem: final completion report (MOD-CON and MOD-CPT)

Date: 2026-11-02. Branch `beta`, HEAD `071d6c2`. All work is uncommitted. Nothing was pushed, merged, rebased, or applied to hosted Supabase.

## Update: 2026-11-03 (supersedes the verdict below where they differ)

**Verdict: PARTIALLY COMPLETE — TECHNICAL WORK REMAINS.** The code work is done and verified. The verdict stays partial for two reasons: the 20 browser scenarios could not be run in this environment, and two operator actions are still open (rotating the hosted database password, and verifying the pooler certificate in `check_status.cjs`).

What changed since 2026-11-02:

- **F21 fixed.** The signed-link verifier accepts only the canonical signature spelling and exactly two segments (`apps/api/src/modules/origination/applications/document-store.ts`). Tests: `apps/api/test/file-link-signer.spec.ts`, 4 of 4.
- **F22 fixed.** The invitation claim judges due and stale times on the database clock (`apps/api/src/provisioning/invitation-delivery.ts`). The failure was intermittent, and the root cause is likely rather than proven. The provisioning worker file passes 10 of 10.
- **Optional MFA (per the spec).** `GET /public/v1/auth/config` reports `SUPABASE_MFA_ENABLED`, and the sign-in screen reads it before signing anyone in. With second factors off, no factor is listed or enrolled and no dialog opens. With them on, the existing second step runs. If the API asks for a second factor but the sign-in service has none, sign-in ends with a message. The app shell follows the same setting. Tests: `apps/web/src/auth/mfa-flow.spec.ts` and `auth-config.spec.ts`, and `apps/api/test/auth-config.spec.ts`.
- **Isolation grants.** Two cases now grant the permissions that origin's TASK-412 model requires (`eligibility.read`, `lender_case.read`). The 403s were the new permission model, not a tenant leak.
- **Test fixture.** A database URL in the new API spec contained a password-shaped string, which the secrets scan flagged. It is removed.

Verification on 2026-11-03:

| Check                                                 | Result                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full isolation sweep                                  | 18 of 18 files, 548 of 548 tests                                                                                                                                                  |
| Connector integration suites and MFA integration test | 10 files, 97 of 97 tests                                                                                                                                                          |
| Web unit suite                                        | 108 files, 730 of 730 tests                                                                                                                                                       |
| API unit suite                                        | Two failures found, both fixed. The MFA enforcement file passes 6 of 6 on rerun, and the secrets and auth-config files pass. The full suite was not re-run after those two fixes. |
| API and web typecheck                                 | Pass                                                                                                                                                                              |
| Production builds (web `vite build`, API `tsup`)      | Pass                                                                                                                                                                              |
| ESLint on changed files                               | 0 errors                                                                                                                                                                          |

Still open:

- Browser verification of the 20 scenarios: not possible here, since no browser tool is available.
- Business decisions: the connector consent rule, partner document types, partner dispute categories, progress labels, staff visibility of customer names, and dispute evidence.
- Migrations 0100–0102: prepared, not applied to hosted.
- F1 (rotate the hosted database password and clean the history, administrator action), F7 (certificate verification, needs the pooler certificate), and F20 (the `vitest.future-clock` whitespace change, which needs a keep-or-discard decision).
- All changes are uncommitted, and nothing was pushed in this pass.

### Final release pass (2026-11-03)

The full set of checks, the release blockers, the hosted runbook and the manual browser checklist are in
[docs/DSA_FINAL_RELEASE_READINESS.md](DSA_FINAL_RELEASE_READINESS.md). The hosted steps are in
[docs/HOSTED_MIGRATION_RUNBOOK.md](HOSTED_MIGRATION_RUNBOOK.md). Verdict unchanged: **PARTIALLY COMPLETE — TECHNICAL WORK REMAINS**, for the
reasons listed there (hosted migration and its checks, credential rotation, the consent decision, the MFA policy, the Vercel deployment,
and browser verification, which could not be run here).

### Final verification (2026-11-03, end of day)

| Check                                                                          | Result                           |
| ------------------------------------------------------------------------------ | -------------------------------- |
| Full isolation sweep (`npm run test:isolation`)                                | 18 of 18 files, 548 of 548 tests |
| Connector integration suites and MFA integration test (`vitest.int.config.ts`) | 10 files, 97 of 97 tests         |
| API unit suite (`apps/api`, `npx vitest run`)                                  | 98 files, 1409 of 1409 tests     |
| Web unit suite (`apps/web`, `npx vitest run`)                                  | 109 files, 733 of 733 tests      |
| Web typecheck and API typecheck                                                | Pass                             |
| Production builds: web `vite build`, API `tsup`                                | Pass (web 11.7 s, API 2.4 s)     |
| ESLint on the changed shell and auth files                                     | 0 errors                         |

Changes since the update above:

- **Partner logins no longer call internal endpoints.** `AppLayout` skips `/v1/tenant` and the notification centre for a partner portal login, because the API refuses both (`CONNECTOR_IDENTITY_NOT_ALLOWED`). The check is `isPartnerPortalLogin` in `apps/web/src/shell/partner-login.ts`, with tests in `partner-login.spec.ts`.
- **Env examples document the MFA setting.** `apps/api/.env.example` describes `SUPABASE_MFA_ENABLED`, and `apps/web/.env.example` says the web app reads it from `GET /public/v1/auth/config`.
- **OTP module follows the setting.** With second factors on, the authenticator code step runs as before, at sign-in, for step-up and on the security page. With second factors off, no OTP module appears anywhere: sign-in finishes with the password, including the dev test-login path, step-up does not open the code dialog, and the security page explains that there is nothing to set up.
- **F20 is resolved in the tree.** `apps/api/vitest.future-clock.config.ts` matches the committed file, which ends with a clean newline.

Still open, and needing a decision or access that is not available here: browser verification, the business decisions listed above, applying migrations 0100–0102 to hosted, rotating the hosted database password (F1), and certificate verification in `check_status.cjs` (F7).

## Verdict (as of 2026-11-02, before the update)

**PARTIALLY COMPLETE — TECHNICAL WORK REMAINS**

Reasons, in order of weight:

1. The last full isolation run failed 2 of 548 tests (F21 and F22 in `docs/CONNECTOR_SECURITY_AUDIT.md`). Neither is fixed.
2. The API unit suite, the connector and migration integration suites, and the two production builds were not re-run after the final edits.
3. Browser verification of the 20 scenarios was not performed. No browser tool is available in this session (BLOCKED — ENVIRONMENT REQUIRED).
4. Connector verification consent is still fail-closed, so no connector can be activated until the business decides the rule (approval item).

This is not a claim that the code is finished. It is a claim that the listed checks ran and what they showed.

## A. Implemented features

- **Internal connector workspace (MOD-CON, web):** dashboard with counts, tabs for overview, referrals, activity, earnings and verification, a directory with a branch filter and "Load more", Add Connector wording.
- **Connector insights (API):** `GET /v1/connectors/summary` (a count is null when the caller lacks its permission), `GET /v1/connectors/:id/referrals` (lead.read, no mobile number), `GET /v1/connectors/:id/activity` (audit events, no before or after values).
- **Verification bound to the connector:** activation and bank accounts accept only a VERIFIED verification record about that connector (migration 0101). Suspended-connector reactivation requires a reason of at least 5 characters.
- **Partner portal (MOD-CPT, `/portal/v1`):** referral list and detail (`GET /referrals/:id`) with partner-safe progress; duplicate refusal; statements; rate card; payout requests with step-up MFA that excludes lines under open dispute; disputes with a required category, and a disputes list.
- **Partner document upload:** list of documents approved for partners, upload intent, and completion. Only types with `document_type.partner_upload = true` are accepted, and only while a malware scanner answers PING. The partner learns only ACCEPTED or NOT_ACCEPTED.
- **Partner progress:** `apps/api/src/modules/partner-view/partner-progress.ts` maps internal lead states to four partner states. Application and lender states are recorded but not shown to partners (approval item).

## B. Defects fixed in the final passes

| Defect                                                                                              | Fix                                                                                                                                 | Evidence                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A connector could pay out a statement line under open dispute                                       | The payout query excludes lines with an OPEN or UNDER_REVIEW dispute, and the error text says so                                    | TEST-CPT-PAYD-01 (last run in an earlier pass, 10 of 10 in `connector-portal.int.spec.ts`)                      |
| The OpenAPI document did not list the connector and portal routes added since the last regeneration | Registered 8 operations (3 connector reads, 1 portal detail, 1 portal disputes list, 3 partner document operations) and regenerated | `npm run gen:openapi` run in this pass; 8 operation IDs found in the generated file; isolation inventory 4 of 4 |
| `ConnectorPage.tsx` had unused imports left by the tab split                                        | Removed                                                                                                                             | ESLint, 0 errors, 13 warnings left                                                                              |
| `check_status.cjs` raised a lint error for `require`                                                | Added a targeted `eslint-disable-next-line` with a reason; the file stays CommonJS                                                  | ESLint exit 0                                                                                                   |
| Formatting drift in changed files                                                                   | Prettier applied to changed files                                                                                                   | Prettier check clean except `apps/api/vitest.future-clock.config.ts` (left untouched)                           |

## C. Files

- **Modified tracked files (25):** `apps/api/src/app.ts`, `apps/api/src/modules/finance/connector-portal.ts`, `apps/api/src/modules/finance/openapi-paths.ts`, `apps/api/src/modules/origination/applications/document-backends.ts`, `apps/api/src/modules/origination/applications/documents.ts`, `apps/api/src/modules/origination/applications/openapi.ts`, `apps/api/src/modules/origination/connectors/connector-service.ts`, `apps/api/src/modules/origination/connectors/openapi-paths.ts`, `apps/api/src/modules/origination/connectors/router.ts`, four API integration specs, `apps/api/vitest.future-clock.config.ts` (not reverted, see section H), web connector files (`ConnectorPage.tsx` and its spec, `ConnectorPortalPage.tsx` and its spec), `check_status.cjs`, `docs/MIGRATION_MATRIX.md`, `openapi/openapi.yaml`, `packages/contracts/src/connector.ts`, `packages/contracts/src/documents.ts`, `supabase/MANIFEST.md`, `supabase/migrations.lock.json`.
- **New untracked files (40 before this report):** the connector insights module, the `partner-view` module, the new API and web test files, the web connector components and models, three migrations (0100, 0101, 0102), six verify and rollback scripts in `tools/sql/batch/`, and the connector docs.
- **Formatting churn:** `docs/MIGRATION_MATRIX.md`, `supabase/MANIFEST.md` and `ConnectorPage.tsx` were already unformatted at HEAD. Prettier rewrote them, so their diffs are larger than their content changes. The git diff stat for the 25 tracked files is 5,989 insertions and 2,852 deletions.

## D. Migrations

| Migration                                  | State                               | Notes                                                                                                       |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0100 `connector_portal_dispute_and_upload` | Locked, unchanged                   | Partner dispute, upload and document-type tables                                                            |
| 0101 `verification_connector_subject`      | Prepared, **not applied to hosted** | Adds CONNECTOR as a verification subject, with a composite FK and a check that connector ID matches subject |
| 0102 `partner_dispute_category_required`   | Prepared, **not applied to hosted** | `NOT VALID` rule: partner disputes need a category                                                          |

Migration lock check: `migrations unchanged (90 files)`, run in this pass.

## E. API changes

- **New operations in `openapi/openapi.yaml`:** `CON-GET-CONNECTORS-SUMMARY`, `CON-GET-CONNECTORS-BY-ID-REFERRALS`, `CON-GET-CONNECTORS-BY-ID-ACTIVITY`, `API-CPT-001b`, `API-CPT-006b`, `API-CPT-008`, `API-CPT-009`, `API-CPT-010`.
- **Behaviour changes:** activation needs a reason for a suspended connector; bank accounts and activation need a verification record about the same connector; partner disputes need a category; partner payouts exclude disputed lines.
- **Regeneration side effects:** `partnerUpload` on document types and the required `category` on portal disputes are now in the spec. Two schema defaults show the run date (2026-11-02), so they will change on each regeneration.
- **Isolation coverage:** the sweep covers `/v1` operations only. The `/portal/v1` operations and the public upload PUT are outside it.

## F. UI changes

- Connector page: dashboard, five tabs, directory with branch filter, Add Connector wording.
- Partner portal: referral detail dialog, payout busy state, status message from the server response, real OTP handling (no fabricated OTP id).
- Partner upload and document list components.

## G. Security

Full findings are in `docs/CONNECTOR_SECURITY_AUDIT.md`. Summary:

- **Fixed:** F2 (suspended reactivation needs a reason), F3 (verification bound to the connector, in code and migration 0101), F5, F6, F10 to F18 (partner upload refusals, cross-connector 404s, connector identity refusal, response allow-lists).
- **Open:** F1 (credential rotation and history cleanup, administrator action), F7 (TLS certificate check in `check_status.cjs`), F21 (tampered signed link returns 200), F22 (resend returns SKIPPED), F20 (stray whitespace in the future-clock config).
- **Accepted, to confirm:** F4 (a duplicate refusal confirms an open enquiry).

## H. Test commands and results

**Run in this pass, after the final edits unless noted:**

| Command                                                                                       | Result                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run gen:openapi`                                                                         | Exit 0; all 8 new operation IDs present in the output                                                                                                                                                                                                                                                                        |
| `npx vitest run --config tests/isolation/vitest.config.ts inventory.spec.ts` (guarded config) | 4 of 4 pass (run before the formatting pass; formatting does not change behaviour)                                                                                                                                                                                                                                           |
| `npm run test:isolation` (full, guarded config, background)                                   | **Exit 1: 546 of 548 tests pass, 2 fail, 18 files.** Failures: `cases/application-documents.spec.ts` TEST-SEC-001 (tampered link: expected 410, got 200; see F21) and `cases/provisioning-worker.spec.ts` TEST-WRK-10 (resend: expected SENT, got SKIPPED; see F22). Duration 1,077 s. Run before the final formatting pass. |
| `apps/api`: `npm run typecheck`                                                               | Exit 0                                                                                                                                                                                                                                                                                                                       |
| `apps/web`: `npm run typecheck`                                                               | Exit 0                                                                                                                                                                                                                                                                                                                       |
| `apps/web`: `npx vitest run src/features/connectors`                                          | 8 files, 43 of 43 pass (includes `ConnectorPage.spec.tsx`, 3 of 3)                                                                                                                                                                                                                                                           |
| `apps/web`: `npx vitest run` (full web unit suite)                                            | 102 files, 597 of 597 pass                                                                                                                                                                                                                                                                                                   |
| `npm run check:migrations -w @dsa/tools`                                                      | Exit 0; migrations unchanged (90 files)                                                                                                                                                                                                                                                                                      |
| ESLint on the 47 changed `.ts`, `.tsx`, `.cjs` files                                          | Exit 0; 0 errors, 13 warnings (`any` and existing unused-variable warnings in spec files)                                                                                                                                                                                                                                    |
| Prettier `--check` on changed `.ts`, `.tsx`, `.cjs`, `.md`, `.json`                           | Clean, except `apps/api/vitest.future-clock.config.ts` (not touched)                                                                                                                                                                                                                                                         |

**Not run in this pass (do not treat as passing until re-run):**

| Suite                                                                      | Last recorded result (earlier pass, before the final edits) |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/api` unit suite (`npx vitest run`, default config)                   | Not run in this pass. The attempt was stopped by the user.  |
| `connector-portal.int.spec.ts`                                             | 10 of 10 (after the payout fix)                             |
| `connector-insights.int.spec.ts`                                           | 7 of 7                                                      |
| `connector-verification.int.spec.ts`                                       | 8 of 8                                                      |
| `connector-portal-documents.int.spec.ts`                                   | 13 of 13                                                    |
| `document-type-approval.int.spec.ts`                                       | 5 of 5                                                      |
| `connector-access.int.spec.ts`                                             | 21 of 21                                                    |
| `migration-upgrade-0100-0102.int.spec.ts`                                  | 9 of 9                                                      |
| `migration-0100.int.spec.ts`                                               | 3 of 3                                                      |
| `migration-audit-batch.int.spec.ts`                                        | 19 of 19                                                    |
| `connector-role-guard.int.spec.ts` / `connector-role-precheck.int.spec.ts` | 14 of 14 / 6 of 6                                           |
| `vite build` (web)                                                         | Not run                                                     |
| `tsup` (API)                                                               | Not run                                                     |

Re-run the integration suites through `apps/api/vitest.int.config.ts` only. Re-run the full isolation sweep after F21 and F22 are fixed.

**Browser verification:** 0 of 20 scenarios performed. No browser tool is available in this session; ToolSearch found no browser or Chrome tools. The new screens are checked only by component tests that render them. Do not treat them as checked on screen.

## I. Known limitations and approval items

1. **Connector verification consent (F3):** a business and compliance decision. Options A to D are in `docs/CONNECTOR_VERIFICATION_DECISION.md`. Until one is chosen, activation of pending connectors is blocked by design.
2. **Duplicate refusal disclosure (F4):** accept that a refusal confirms an open enquiry.
3. **Partner progress labels for application and lender states:** `docs/CONNECTOR_PHASE1_CONTRACT.md` section B. Until approved, partners see lead-level steps only.
4. **Partner document types:** which types have `partner_upload = true`.
5. **Partner dispute categories:** the category list and whether to backfill existing partner disputes (0102 requires a category on new rows only).
6. **Dispute evidence attachments:** not built. A new subject type is needed first.
7. **Staff visibility of customer name on the connector workspace:** today `lead.read` staff see it, and the mobile number is hidden.

## J. Hosted deployment prerequisites and order

Nothing has been applied to hosted. Before any hosted change:

- Confirm the verification consent decision (I-1) and the partner document type list (I-4).
- Confirm `CLAMAV_ADDRESS` on hosted with an authorised operator. Partner uploads stay off until then.
- Rotate the hosted database credentials and clean the history that holds the old password (F1). The rotation runs under `docs/SECURITY_CREDENTIAL_ROTATION.md`. Do not rewrite history without the team's agreement.
- Replace `rejectUnauthorized: false` in `check_status.cjs` with certificate verification (F7), or confirm it is only run from a trusted network.

**Deployment order:** apply migrations 0100, then 0101, then 0102, in the order given in `docs/MIGRATION_INVENTORY_CONNECTOR_2026-11.md` (not re-read in this pass). Run the matching `tools/sql/batch/NN.verify.sql` before and after each step. Deploy the API and web build only after the migrations are applied.

**Rollback:** `tools/sql/batch/102.rollback.sql` drops the partner dispute category rule only. `101.rollback.sql` refuses while any CONNECTOR verification exists. `100.rollback.sql` refuses while categorised disputes or partner-approved document types exist. Roll back in reverse order (100, 99, 98).

## K. Final git status

- Branch `beta`, HEAD `071d6c2 feat(web): show the account type and partner-login role on the Users screens`.
- 25 tracked files modified, 40 untracked before this report was written. Nothing staged, committed or pushed.
- `apps/api/vitest.future-clock.config.ts` is still modified. It has a trailing space and a missing final newline. Its origin is not known. It is not reverted, and it needs your decision (keep or discard).
- The `apps/api/.env` file was opened in the IDE during this session. It was not read or changed.
