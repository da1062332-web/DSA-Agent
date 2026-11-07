# Production security containment

**Date:** 2026-11-04
**Status:** Implemented and verified locally. Not committed, not pushed, not deployed. No hosted database, Render or Vercel change. No key rotated. No file deleted.
**Written for:** the security owner, the finance owner, and the developers who will reopen these routes.
**Basis:** the containment approved for production, items 1 to 10 of the request.

## 1. Summary

- **Public upload route closed.** `/public/v1/upload/:token` refuses every new request with HTTP 503 and `DEPENDENCY_UNAVAILABLE`. The check runs before validation, token lookup, OTP checks and storage. Existing sharing records and uploaded files are not changed.
- **Sensitive financial operations gated on the server.** Nineteen payout, payment, approval and settlement operations now pass through one gate, `requireFinancialStepUp`. While the project has no second factor (`SUPABASE_MFA_ENABLED=false`, which is production today), each of them is refused with 403 `FORBIDDEN` and issue `PROJECT_SECOND_FACTOR_OFF`. While the project has a second factor, each needs a step-up within 900 seconds, or it is refused with 401 `STEP_UP_REQUIRED`.
- **Not changed:** the MFA configuration, the frontend, the database schema, any stored data, the internal document workflows, and the deployed services.
- **Two decisions are open.** The first is a second public upload path that this change deliberately does not close (section 2). The second is how long the containment should stay in place (section 8.5).

## 2. Decisions the owner needs to make

**Answered (second round, 2026-11-04):** item 1 is kept open as `PUT /public/v1/document-uploads/:token`, with quarantine and fail-closed scanning, implemented and tested (`docs/DOCUMENT_UPLOAD_CONTROLS.md`). Item 2 is implemented in code, but the partner link still needs persistence and a contract change (section 8.6). The 15-minute step-up policy is approved for the 19 routes. The ungated operations were audited (section 5.7).

1. **A second public upload path accepts new uploads.** `PUT /public/v1/document-uploads/:token` (`apps/api/src/modules/origination/applications/documents.ts`, line 1026) accepts raw bytes against a single-use upload-intent token. It was not closed, because the internal document flow (`apps/web/src/features/documents/api.ts`) and the partner portal upload flow (`apps/web/src/features/connectors/partner-upload.ts`) both upload through it, and the request asked not to disable internal document workflows. Bytes are written to storage before the malware scan. The scan runs at the authenticated completion step. A partner upload intent is refused when no working scanner is configured (`documents.ts`, the partner scanner check around line 200), but internal intents are not checked the same way. **Decide whether to close it, narrow it (for example, refuse the PUT when the scanner is not ClamAV), or accept it with the controls in section 9.3.**
2. **The partner API still issues upload URLs for the closed route.** `apps/api/src/modules/partner-api/service.ts` line 541 returns `uploadUrl` values under `/public/v1/upload/`. Those links now return 503. **Decide whether to stop issuing them.**
3. **Reopening the closed route** needs the controls in section 9.4. It is not a configuration switch.

## 3. Changed files

| File | Change |
|---|---|
| `apps/api/src/http/financial-step-up.ts` | New. The gate `requireFinancialStepUp(authz, ctx)` and the issue code `PROJECT_SECOND_FACTOR_OFF`. |
| `apps/api/src/modules/origination/document-sharing/router.ts` | `router.use('/upload', …)` at line 171, before the three public handlers. The handlers and the internal router are unchanged. |
| `apps/api/src/modules/finance/router.ts` | Imports the gate. Replaces the five existing step-up calls with the gate. Adds the gate to the six routes that had none (lines 162, 269, 285, 351, 572, 617). Each new gate sits after its permission check. |
| `apps/api/src/modules/finance/connector-portal.ts` | Imports the gate. Replaces the partner payout step-up call (line 355). |
| `apps/api/src/modules/reconciliation/router.ts` | Imports the gate. Adds the gate to adjustment approval (line 240) and payout bank reconciliation (line 360). Adds it to a write-off only (line 204) and to a dispute that releases held payables only (line 316). |
| `apps/api/src/modules/origination/connectors/router.ts` | Imports the gate. Adds the gate to bank-account approval (line 270), attribution change approval (line 441) and attribution dispute resolution (line 475). |
| `apps/api/test/public-upload-containment.spec.ts` | New. Seven regression tests for the public route, and one control test for the internal workflow. |
| `apps/api/test/financial-containment.spec.ts` | New. Helper tests, plus a table of the 19 gated routes and 8 ungated controls. |
| `apps/api/test/sub-permission-gates.spec.ts` | Adds a `freshStepUp` flag, set on the payout batch entry, so its "opens" assertion really passes the gate. Removes the `appFor` helper, which was no longer used. |
| `apps/api/test/reconciliation.spec.ts` | `appWithAuth` builds fixtures with an explicit `authTime`. The separation-of-duties and bank-settlement fixtures now carry a recent step-up, because those operations now require one. |
| `apps/api/test/document-sharing.spec.ts` | API-DSH-003 now asserts the containment (503). The old assertion accepted 200 or 404 and would have failed. |
| `docs/PRODUCTION_SECURITY_CONTAINMENT.md` | New. This document. |

Files the work did not touch: the migrations, `packages/`, `apps/web/`, `render.yaml`, `vercel.json`, the environment files, and `docs/HOSTED_DEPLOYMENT_COMPLETION_REPORT.md` (its earlier uncommitted edit is preserved as it was).

## 4. Public upload route

| Request | Before | After |
|---|---|---|
| `GET /public/v1/upload/:token` | Link status | 503 `DEPENDENCY_UNAVAILABLE` |
| `POST /public/v1/upload/:token/otp-verification` | Checks the OTP and issues a session | 503 `DEPENDENCY_UNAVAILABLE` |
| `POST /public/v1/upload/:token/files` | Accepts a file, stores it, records it | 503 `DEPENDENCY_UNAVAILABLE` |
| Any other method or path under `/upload` | Not routed | 503 `DEPENDENCY_UNAVAILABLE` |

The refusal is a router-level middleware. It runs before validation, token lookup, OTP verification and the service, so no request can reach storage or the database through this route.

**Not touched:** the sharing records (`app.upload_link`, `app.external_share`, `app.uploaded_document`), the uploaded files, the internal sharing routes (`POST /v1/upload-links`, `GET /v1/upload-links`, `/v1/shares`), and the origination document router. The handlers are kept as they were, so the route can be reopened by a reviewed change.

**The hard-coded session secret:** `SESSION_SECRET` in `document-sharing-service.ts` (line 30) signs upload-session tokens. It is used only by `verifyUploadOtp`, which issues the token, and `uploadPublicFile`, which checks it. Both are reached only through the closed route, so the secret is inert for live traffic. It is still in source and in git history, so it is treated as exposed (section 9.1).

## 5. Financial operations: audit

### 5.1 Method

Every payout and approval operation was listed from the routers in `finance/router.ts`, `finance/connector-portal.ts`, `reconciliation/router.ts` and `origination/connectors/router.ts`. For each one the audit recorded the permission it checks, whether it had a step-up before, and what it does to money, read from the service method it calls. The gate is applied in the route, the same place the existing payout gates sit. The permission check runs first, so an unauthorised caller still receives a permission error.

### 5.2 Gated: 19 operations

State "before" is what the code did on `beta` at `55d87d5`, with the second factor on or off.

| # | Route | Permission | Step-up before | Money effect | Gate |
|---|---|---|---|---|---|
| 1 | `POST /v1/commission-plans/:id/approval` | `commission.plan.approve` | None | Changes commission rates | Always |
| 2 | `POST /v1/clawbacks/:id/approval` | `adjustment.approve` | None | Approves a recovery from a payee | Always |
| 3 | `POST /v1/clawbacks/:id/rejection` | `adjustment.approve` | None | Decides a recovery | Always |
| 4 | `POST /v1/recalculation-proposals/:id/approval` | `adjustment.approve` | None | Approves a recalculation | Always |
| 5 | `POST /v1/payout-requests/:id/approval` | `payout.approve` | **Yes** | Approves a payout | Always |
| 6 | `POST /v1/payout-requests/:id/payment` | `payout.record_payment` | **Yes** | Records a payment | Always |
| 7 | `POST /v1/payout-requests/:id/payment-failure` | `payout.record_payment` | None | Records a failed payout and its retry | Always |
| 8 | `POST /v1/payout-batches` | `payout.disburse` | None | Builds the batch behind a bank file | Always |
| 9 | `GET /v1/payout-batches/:id/bank-file` | `payout.disburse` | **Yes** | Exports payment instructions | Always |
| 10 | `POST /v1/payout-requests/:id/disburse-gateway` | `payout.disburse` | **Yes** | Would disburse; refused by the gateway until a rail is approved (AUD-P0-02) | Always |
| 11 | `POST /v1/payout-batches/:id/dispatch-gateway` | `payout.disburse` | **Yes** | Dispatches a batch | Always |
| 12 | `POST /v1/adjustments/:id/approval` | `adjustment.approve` | None | Approves a financial adjustment | Always |
| 13 | `POST /v1/reconciliation/payouts/:id/bank-reconcile` | `finance.reconcile` | None | Settles a payout against a bank reference | Always |
| 14 | `POST /v1/reconciliation-exceptions/:id/resolution`, when `status` is `WRITTEN_OFF` | `finance.reconcile` | None | Accepts a loss | Write-off only |
| 15 | `PATCH /v1/disputes/:id`, when `releaseHolds` is true | `finance.reconcile` | None | Releases held payables | Release only |
| 16 | `POST /v1/connectors/:id/bank-accounts/:accountId/approval` | `connector.bank_change_approve` | None | Approves where a connector is paid | Always |
| 17 | `POST /v1/attribution-change-requests/:id/approval` | `connector.attribution_change` | None | Moves a lead's commission to another connector | Always |
| 18 | `POST /v1/attribution-disputes/:id/resolution` | `connector.dispute_resolve` | None | Sets the connector a disputed lead is credited to | Always |
| 19 | `POST /portal/v1/payout-requests` (partner) | Partner payout | **Yes** | Requests a payout to the partner | Always |

Summary: 6 of the 19 had a step-up before. 13 had none. Entries 14 and 15 are gated only in the case that moves money. Every other route in the list is gated in every case.

### 5.3 Reviewed and not gated

These operations are payout- or approval-adjacent. They were reviewed and left open, for the reasons given.

| Route | Reason |
|---|---|
| `POST /v1/payout-requests` (create) | The maker step. Nothing is paid until approval (gated) and payment (gated). |
| `POST /v1/payout-requests/:id/cancel` | Reduces exposure. |
| `GET /v1/payout-requests`, and every other read | Views only. |
| `POST /v1/clawbacks` and `POST /v1/recalculation-proposals` | Create a proposal. Approval (gated) decides it. |
| `POST /v1/adjustments` | Proposes an adjustment. Approval (gated) decides it. |
| `POST /v1/reconciliation-exceptions/:id/resolution` for statuses other than `WRITTEN_OFF` | Classification only. |
| `PATCH /v1/disputes/:id` without `releaseHolds` | Status change only. |
| `POST /v1/connectors/:id/bank-accounts` (create) | Creates a pending account. The approval (gated) is what makes it payable. |
| `POST /v1/attribution-change-requests` and `POST /v1/attribution-disputes` | Create requests. Approval or resolution (gated) decides them. |
| `POST /v1/connectors/:id/users/:userId/access` and the portal invitation routes | Access, not money. |

### 5.4 Financial but not payout or approval: outside this containment

These operations move or record money, but they are not payouts or approvals. They are listed so the owner can decide on them. None is gated here.

- `POST /v1/ledger/journals` (manual journal) and `POST /v1/ledger/periods/:period/close` (period close). These post to the ledger.
- `POST /v1/invoices/:id/status` (issue, pay or void).
- `POST /v1/commission/calculate`, which creates payables that feed the payouts.
- `POST /v1/connectors/:id/activation` and `POST /v1/connectors/:id/status`. These decide whether a connector may earn, and they are the approval controls behind AUD-P1-08.

### 5.5 Behaviour after the change

| Project state | Gated operations, before | Gated operations, after |
|---|---|---|
| Second factor off (`SUPABASE_MFA_ENABLED=false`) | Ran on a password alone. The step-up check was a no-op | Refused, 403 `FORBIDDEN`, issue `PROJECT_SECOND_FACTOR_OFF` |
| Second factor on, no recent step-up | 6 refused (`STEP_UP_REQUIRED`), 13 ran with no check | Refused, 401 `STEP_UP_REQUIRED` |
| Second factor on, recent step-up | Ran | Ran |

The developer switch `DISABLE_MFA` does not lift the containment, because the gate does not read it (test TEST-FSU-03). Setting `SUPABASE_MFA_ENABLED` to `true` lifts it. This change does not set that value.

## 6. Policy change in the second-factor-on state

Thirteen of the 19 operations had no step-up before. With the second factor on, they now need a recent step-up. This applies the step-up policy that was proposed as AUD-P1-08 (bank approvals, attribution approvals, dispute resolution and status changes), and it extends the existing payout policy to payment failure, batch creation and the reconciliation operations.

This is a behaviour change, and it needs the security owner to confirm it. The effect is that a user who holds one of these permissions and has not enrolled a second factor is refused on these routes until they enrol. Enrolment is not assumed anywhere in the code.

### 5.6 The 13 newly gated routes

These had no step-up before this change. Each one is marked "None" in the table in section 5.2. With the second factor on, each now needs a step-up within 900 seconds. With it off, each is refused.

| # | Route | Permission | Why it is gated |
|---|---|---|---|
| 1 | `POST /v1/commission-plans/:id/approval` | `commission.plan.approve` | Approves commission rates |
| 2 | `POST /v1/clawbacks/:id/approval` | `adjustment.approve` | Approves a recovery |
| 3 | `POST /v1/clawbacks/:id/rejection` | `adjustment.approve` | Decides a recovery |
| 4 | `POST /v1/recalculation-proposals/:id/approval` | `adjustment.approve` | Approves a recalculation |
| 5 | `POST /v1/payout-requests/:id/payment-failure` | `payout.record_payment` | Records a failed payout and its retry |
| 6 | `POST /v1/payout-batches` | `payout.disburse` | Builds the batch behind a bank file |
| 7 | `POST /v1/adjustments/:id/approval` | `adjustment.approve` | Approves a financial adjustment |
| 8 | `POST /v1/reconciliation/payouts/:id/bank-reconcile` | `finance.reconcile` | Settles a payout |
| 9 | `POST /v1/reconciliation-exceptions/:id/resolution` (`WRITTEN_OFF`) | `finance.reconcile` | Accepts a loss |
| 10 | `PATCH /v1/disputes/:id` (`releaseHolds: true`) | `finance.reconcile` | Releases held payables |
| 11 | `POST /v1/connectors/:id/bank-accounts/:accountId/approval` | `connector.bank_change_approve` | Approves where a connector is paid |
| 12 | `POST /v1/attribution-change-requests/:id/approval` | `connector.attribution_change` | Moves a commission to another connector |
| 13 | `POST /v1/attribution-disputes/:id/resolution` | `connector.dispute_resolve` | Sets the connector a lead is credited to |

Tests: `financial-containment.spec.ts`, TEST-FSU-10 (refused when the second factor is off), TEST-FSU-20 (refused without a recent step-up), and TEST-FSU-21 (passes with one). The 15-minute window is `STEP_UP_MAX_AGE_SECONDS = 900` (`packages/kernel/src/authz/authz.ts:16`). All 19 gates use that default.

### 5.7 Ungated financial operations: audit (decision 6)

Scope: ledger, period close, invoices, commission and connector operations that move or decide money and have no step-up. Each route's permission was taken from the route or its service method. Nothing in this section was changed in this round. The controls below are recommendations, in priority order.

| Priority | Route | Permission | Finding | Recommended control |
|---|---|---|---|---|
| **P0** | `PATCH /v1/commission-plans/:id`, field `status` | `commission.plan.edit` | The edit schema accepts `status` (`packages/contracts/src/commission.ts:61`) and the service writes it with no check (`finance-service.ts:222-245`, `repository.ts:346`). A holder of the edit permission can set a plan to `ACTIVE` with no approval, no approval permission and no step-up. The approval itself also sets `ACTIVE` unconditionally (`repository.ts:366`) | Remove `status` from the edit schema, or accept only `DRAFT` and `RETIRED`. Make `ACTIVE` reachable only through the approval route. Add a regression test that a PATCH to `ACTIVE` is refused |
| **P0** | `PATCH /v1/commission-plans/:id`, `basis`, `qualifyingEvent`, `clawbackWindowDays` | `commission.plan.edit` | An `ACTIVE` plan's basis can be changed with no status check and no re-approval (`finance-service.ts:222`) | Editing a plan that is not `DRAFT` returns it to `DRAFT` and needs approval again, or is refused |
| P1 | `POST /v1/commission/calculate` | `commission.calculate` **or** `finance.view` (`finance-service.ts:284`) | A read-only role can create commission calculations and payables, which feed payouts | Remove `finance.view` from the check |
| P1 | `POST /v1/ledger/accounts` | `finance.view` (`ledger-service.ts:114`) | A read permission creates ledger accounts (the chart of accounts) | A dedicated permission, step-up for creation, and separation of duties on activation |
| P1 | `POST /v1/ledger/periods/:period/close` | `finance.period_close` (`ledger-service.ts:416`) | One holder closes a period. The trial-balance check (zero variance) is the only control. No step-up, no second approver | Step-up, a second approver, a required reason, and audit |
| P1 | `POST /v1/invoices/:id/status` (pay, void) | `invoice.manage` (`invoices/service.ts:140`) | Pay and void change money state with no step-up and no separation of duties | Step-up for pay and void; separation of duties for void |
| P1 | `POST /v1/connectors/:id/activation` | `connector.manage` (`connector-service.ts:654`) | Requires a `VERIFIED` verification about this connector (`assertConnectorVerification`). No step-up. The check does not compare the activator with the verifier | Step-up, and refuse when the activator recorded the verification |
| P1 | `POST /v1/connectors/:id/status` (suspend, terminate) | `connector.manage` (`connector-service.ts:733`) | Stops referrals and earnings with no step-up | Step-up for suspend and terminate; a reason is required |
| P2 | `POST /v1/recalculation-proposals` | `commission.plan.edit` (`finance-service.ts:521`) | Proposes recalculated payables. Its approval is gated; the proposing permission belongs to the plan editor | Propose with `adjustment.create`. Keep the approval gate |
| P2 | `POST /v1/clawbacks` | `adjustment.create` | Creates a request. Its approval is gated. Separation of duties at clawback approval is not verified in this audit | Verify; no other change |
| P2 | `POST /v1/ledger/exports` | `export.run` | Record-level export, audited, no step-up | Step-up, as the reporting export check already requires (`reporting/service.ts:965`) |
| P2 | `POST /v1/connectors/:id/agreements` | `connector.agreement_manage` | Agreements carry validity, products, share-rule scope and evidence, not rates (`packages/contracts/src/connector.ts:189`). They decide which referrals a connector may send | Step-up and separation of duties for scope changes |
| P2 | `POST /v1/connectors/:id/users`, `POST /v1/connectors/:id/users/:userId/access` | `connector.portal_user_manage` | Grants a partner user access to a connector's data. Not money | Step-up for granting access |
| P2 | `POST /v1/lender-statements/:id/match` | `finance.reconcile` | Matches statement lines to calculations. Whether it settles payables was not verified | Verify. Step-up if it settles |

**Confirmed sound.** The manual journal (`POST /v1/ledger/journals`) is refused for every human session and accepts only system identities (`ledger-service.ts:71-82`). Keep it. Its permission decision (D-03 in that comment) is still open. Proposals (adjustments, clawbacks, recalculations) are separate from their approvals, and every approval is gated. Connector bank accounts can be created without a gate, but where a payout goes is decided at the approval, which is gated (item 11 in section 5.6).

**Order of work.** Fix the two P0 items first. The first is a one-line schema change plus a regression test, and it closes an approval bypass that sits beside the gated approval. Then the P1 items, each with its test. Each control changes behaviour, so each needs the owner's approval before it is built.

## 7. Verification

Results are recorded in section 7.1. Every command was run in the `apps/api` or repository root directory, and nothing ran against a hosted database.

### 7.1 Results

| Check | Command | Result |
|---|---|---|
| Typecheck, all workspaces | `npm run typecheck` | Pass (exit 0). The API tsconfig includes `test/`, so the new specs are type-checked |
| Focused unit: new and changed specs | `npx vitest run` on the six changed spec files (`public-upload-containment`, `financial-containment`, `sub-permission-gates`, `reconciliation`, `document-sharing`, `finance`) | 6 files, 335 tests passed |
| Full API unit suite | `npx vitest run` in `apps/api` | 100 files, 1,486 tests passed (exit 0) |
| Focused integration (local Testcontainers, guarded config) | `npx vitest run --config vitest.int.config.ts` with the payout, reconciliation, connector, sharing, document and MFA files | 14 files, 101 tests passed (exit 0). Docker was available |
| Lint, changed files | `npx eslint` on the 11 changed or new files | 0 errors, 22 warnings across the 11 files. The repository total below is the check that matters: it did not rise. The two `any` uses this change added were removed |
| Lint, repository | `npm run lint` | 958 problems: 1 error, 957 warnings. The same total as before this change. The error is `no-empty` in `e2e/helpers/mock-session.ts`, which predates this work |
| API build | `npm run build -w @dsa/api` | Pass (exit 0) |
| Web build | `npm run build:web` | Pass (exit 0) |
| Formatting, changed files | `npx prettier --check` | All matched files use Prettier code style |

Two formatting-only edits (Prettier, and typed fixtures) were made after the focused runs. The full unit suite was run after them, and the integration run was not repeated. The change was made in the working tree on `beta`. Nothing was committed.

### 7.2 Second round (document upload controls and ungated audit)

| Check | Result |
|---|---|
| Typecheck, all workspaces | Pass (exit 0) |
| Focused integration (15 files, including the new upload lifecycle spec) | 15 files, 115 tests passed |
| Full API unit suite | 101 files, 1,488 tests passed |
| Isolation sweep | 18 files, 549 tests passed |
| API build and web build | Pass |
| Lint, repository | 958 problems: 1 error, 957 warnings. The same total as before this round |

Details of the upload work are in `docs/DOCUMENT_UPLOAD_CONTROLS.md`, section 7.

## 8. Remediation plan

### 8.1 Signing keys

**A. The upload-session secret (`document-sharing-service.ts` line 30).** The literal is in source and in history (commits `71613d7` and `e97f998`). It is treated as exposed.

1. The owner confirms that no external party holds an upload session. Sessions last 15 minutes and the route is closed, so nothing valid is outstanding.
2. Move the value to an environment variable. The name is to be decided. The proposal is `DOCUMENT_UPLOAD_SESSION_SECRET`. It must be at least 32 random bytes, and `loadConfig` must refuse to start in production without it.
3. Remove the literal from source in the same change that reopens the route. Doing it earlier would turn a routing containment into a code change.
4. Generate the value offline, and set it only in the Render environment. Never commit it. Record the date and the people involved, but not the value.
5. Rotate once the code change is live. Because the route was closed, rotation has no user impact.
6. Do not rewrite git history without approval, the same rule as the gateway key.
7. Tests: production start-up refuses a missing or short secret. A session token round-trips with the configured secret and fails with any other.

**B. The gateway acknowledgement key (AUD-P0-03).** The literal was removed from source earlier. Rotation is still required, as set out in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`. The payment gateway refuses every disbursement (AUD-P0-02), so no live payment uses the key.

1. The security owner inventories every place the key was given (any bank, gateway, partner or script).
2. Rotate it at each external party first, using that party's own process.
3. Set the replacement only in the deployment environment, under the name the code will read once a real integration exists.
4. Record the date and the people. Do not record the value.

**C. `APP_SIGNING_SECRET`.** It derives the per-tenant key that encrypts stored document bytes, and it signs download links. Rotating it without a plan makes stored files unreadable and invalidates every signed link. **Do not rotate it.** Before any rotation, add a key identifier so that ciphertext and links name their key, and keep the old key until everything is re-encrypted.

### 8.2 Persistent document storage

Current state: the origination documents (13) and the sharing rows (2) have their bytes on the instance disk when `DOCUMENT_STORE` is `local`. The blueprint has no persistent disk, so a redeploy loses them.

1. **Choose the provider.** Either the Supabase Storage S3 endpoint, which keeps one vendor, or AWS S3. Either way: a private bucket, a key scoped to that bucket, and a key separate from the service-role key. Choose a region near the API.
2. **Create the bucket** with no public access, encryption at rest, and no lifecycle rule until the retention decision is made.
3. **Set the environment** on Render: `DOCUMENT_STORE=s3`, `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ACCESS_KEY_ID`, `DOCUMENT_S3_SECRET_ACCESS_KEY` (a secret), and `DOCUMENT_S3_REGION` where the provider needs it.
4. **Close the sharing gap.** `DocumentSharingService` builds `LocalDocumentStorage` and `MagicByteFileScanner` unless it is given the configured backends. `DOCUMENT_STORE=s3` does not reach it. Route it through `documentBackendsFromConfig`. This is needed before the sharing routes are reopened.
5. **Migrate the existing bytes.** First confirm where they are on the instance. Copy each one into the bucket under its existing key (`<tenantId>/<name>` for origination, the storage path for sharing). Read each one back through the store and compare the SHA-256 with the stored value. Confirm first what that hash covers. Keep the local copies. Delete nothing.
6. **Cut over** by setting `DOCUMENT_STORE=s3` only after every row verifies. Redeploy only after the bytes are safe, because a redeploy replaces the disk.
7. **Roll back** only by pointing reads at the local copies. New documents written to S3 stay there.
8. **Back up the bucket** under a written decision, and restore-test it.
9. **Test:** an integration test against a MinIO container in Testcontainers, covering put, get, the sha256 check, and the encryption wrapper.

### 8.3 ClamAV integration

Current state: `CLAMAV_ADDRESS` is named in `render.yaml` but no ClamAV service is defined. The origination path falls back to a signature check when it is unset. The sharing path never uses ClamAV.

1. **Provision clamd** as a private service on the same network as the API, with signature updates (`freshclam`) at least daily.
2. **Set `CLAMAV_ADDRESS`** to `host:3310` on the API. Check that the API can reach it. The partner upload intent already uses the health check (`ClamAvFileScanner.healthy()`) and refuses when the scanner does not answer.
3. **Keep the fail-closed behaviour.** A scanner that cannot answer fails the upload completion with 503 (retryable). Nothing is marked clean without a verdict.
4. **Wire the sharing path** to the same scanner (section 8.2, step 4).
5. **Decide the scan timing for the PUT route** (section 2, item 1). Today the bytes are stored before the scan, and the scan happens at completion. Either scan before the store, or hold the bytes in quarantine until completion.
6. **Test:** an integration test with a real clamd container. The EICAR test string must return `INFECTED`. A stopped clamd must return 503.
7. **Monitor:** alert when the scanner's health check fails.

### 8.4 Reopening the public upload route

Do all of the following, in one reviewed change:

1. Move the session secret to the environment and rotate it (8.1 A).
2. Route the sharing storage and scanner through the configured backends (8.2 step 4).
3. Confirm that `DOCUMENT_STORE=s3` and `CLAMAV_ADDRESS` are set and healthy in production (8.2, 8.3).
4. Remove the `router.use('/upload', …)` containment from `document-sharing/router.ts`, and update `public-upload-containment.spec.ts` and API-DSH-003 in `document-sharing.spec.ts` to match.
5. Get the security owner's written approval, and the decision in section 2, item 2 on the partner URLs.

### 8.5 Lifting the financial containment

No code change is needed. The containment lifts when `SUPABASE_MFA_ENABLED` is `true` and the following are true:

1. TOTP is enabled in the Supabase project. The owner confirms this in the dashboard, because the database cannot show it.
2. Every user who holds an MFA-required role has enrolled a factor, or the role has been removed.
3. `GET /public/v1/auth/config` returns `{"mfaEnabled":true}`.
4. A sign-in with an enrolled account, followed by an approval, passes the step-up.

Until then, the owner should record the written acceptance of the payment risk, or keep the containment in place. The setting itself is not changed by this work.

### 8.6 Partner API upload sessions

The partner session (`POST /v1/partner/applications/:id/documents/upload-session`) now returns `https://app.dsa-crm.com/public/v1/document-uploads/<token>` (decision 4). **The link does not work yet.** The partner-API service is an in-memory stub: its token is never stored, and it has no database access. A PUT to the link returns 404.

To make the link work:

1. Create a real upload intent for each requested document. An intent needs the file's size, SHA-256, MIME type, and checklist item. The partner request carries none of them, so `PartnerUploadSessionRequestSchema` must change, and that change goes to the partner integrators.
2. Persist the session in the database for the caller's tenant, and resolve the application and checklist items there.
3. Decide who owns the session: the partner integration, or the connector-portal flow that already does this correctly.
4. Test that the URL returned by the session completes an upload end to end.

This is a blocker for the partner API. Details in `docs/DOCUMENT_UPLOAD_CONTROLS.md`, section 6.

## 9. Residual risks and what was not done

- **Second public upload path live** (section 2, item 1).
- **Partner API URLs point at the closed route** (section 2, item 2).
- **Partner payouts and gated approvals are unavailable** while the second factor is off. That is the intended containment. The partner portal shows the error.
- **Ungated financial operations** (section 5.4) are unchanged.
- **The e2e specs** `e2e/14-customer-secure-link.spec.ts` and `e2e/16-full-lifecycle-demo.spec.ts` use the closed public upload route. They will fail until the decision in section 2 is made. They were not run here, because they need a browser and the public URL.
- **The web public upload page** shows an error. No frontend change was made, because the server enforces the refusal.
- **Deployment:** nothing is deployed. Render and Vercel still run the earlier builds until a reviewed deployment.
- **Hosted data check** (R1 in `HOSTED_DEPLOYMENT_COMPLETION_REPORT.md`) was not run.
- **Integration run** is the focused set in section 7.1, not the full integration suite.

## 10. Approvals needed

| Approval | Owner |
|---|---|
| Section 2, item 1: the second public upload path | Security owner |
| Section 2, item 2: partner upload URLs | Product owner and security owner |
| Section 6: step-up on the 13 operations that had none | Security owner |
| Section 8.1: session secret and gateway key rotation | Security owner |
| Section 8.2: storage provider and migration | Operations and the developer owner |
| Section 8.3: ClamAV service and scan timing | Operations and the security owner |
| Section 8.5: when the financial containment lifts | Finance owner and security owner |
