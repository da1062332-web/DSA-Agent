# Project audit: pending work, connections and risks

**Date:** 2026-11-05
**Scope:** the whole repository (`beta` at `55d87d5`, with uncommitted work from 2026-11-04). Read-only. No code, configuration, hosted data or secret was changed. The one file written is this report.
**Written for:** the developers, the security owner, and the owners of finance, operations and compliance.

## 1. Summary

| Area | Verdict |
|---|---|
| Git state | Working tree holds 32 uncommitted changes. Two stashes hold a teammate's work and unrelated changes. Nothing is ahead of or behind `origin/beta` |
| Connections, web to API | Good. Every web call resolves to a mounted route, with the correct HTTP method, apart from two expected exceptions |
| Connections, API to OpenAPI | Every documented operation is mounted. 13 mounted routes are not documented |
| Connections, API to database | Good at table level. Every table the code reads or writes is created by a migration. Column level was not checked |
| Migrations | 92 files, unchanged since their merge (immutability check passes) |
| Configuration | **High risk.** Five production modules fall back to hard-coded keys when the environment variable is missing |
| Security | **High risk.** One approval bypass in commission plans, one email-based account binding that is on by default, and eight production dependency advisories (four high) |
| CI | **Red today.** The lint job fails on formatting (284 files) and on one lint error. The contract job would fail because the OpenAPI output changes every day |
| Feature completeness | Several features are not delivered: consent OTP, real messaging channels, the partner upload link, and the staff invitation sender in production |
| Tests | All local suites pass (unit 1,488, focused integration 115, isolation 549). Gaps: e2e not run, two e2e suites use removed routes, and the isolation sweep misses undocumented routes |

## 2. Git and repository state

- **Branch** `beta` at `55d87d5`. Local `beta` is in sync with `origin/beta`.
- **Uncommitted work:** 23 modified files, 9 new files. This is the work from 2026-11-04 (containment, document upload controls, audit reports). None of it is committed.
- **Stash `stash@{1}`:** "teammate edits (26 files + untracked) - not committed by Vaibhav". It holds changes to `packages/contracts/src/users.ts`, `tools/test_lifecycle.ts` and 24 other files. **Owner needed:** the teammate should confirm whether the work is still wanted. Do not drop it.
- **Stash `stash@{0}`:** "unrelated pre-existing changes". Four files, including `apps/web/src/shell/Sidebar.tsx`. Same action: review, then decide.
- **Branches:** 12 local. Nine are `backup/*` or `backup-*` branches from earlier rewrites. Recommend removing them once the owner confirms the history is safe. One branch, `d1/TASK-102-supabase-auth`, looks stale.
- **Trunk:** `CLAUDE.md` says work goes to `main`. The work is on `beta`, and the Vercel production branch is `main` (`docs/DEPLOYMENT.md`). **Decision needed:** which branch is the release branch.
- **Root clutter:** `DSA_CRM_Comprehensive_Testing_Report_2026-10-17.md`, `DSA-Agent_Manual_Test_Cases.xlsx` and `check_status.cjs` sit at the repository root. Move them under `docs/` or `tools/`.
- **Ignored folders** `uploads/` and `test-results/` are correctly git-ignored. `uploads/` holds development files from 2026-10-26.

## 3. High-severity findings

### 3.1 Hard-coded fallback keys in production code

Five modules use a literal key when the environment variable is missing. The values are not reproduced here. Each literal is public, because it is in the repository.

| Variable | Used by | What it protects |
|---|---|---|
| `FINANCE_ENCRYPTION_KEY` (or `ENCRYPTION_KEY`) | `apps/api/src/modules/finance/crypto.ts`, line 6 | Payment references and bank account numbers (AES-256-GCM) |
| `ENCRYPTION_KEY` | `apps/api/src/modules/origination/connectors/connector-service.ts`, line 140 | Connector data (AES-256-GCM) |
| `HMAC_SECRET` | `connector-service.ts`, line 137 | Blind index for connector data |
| `MOBILE_HMAC_SECRET` | `apps/api/src/modules/crm/leads/normalizer.ts` line 5, `crm/customers/normalizer.ts` line 5 | Hash of every mobile number used for duplicate detection |
| `REC_HMAC_SALT` | `apps/api/src/modules/reconciliation/crypto.ts`, line 4 | Hash of loan account numbers |

**Why it matters.** A mobile number has about 10 digits, so a public key makes every stored mobile hash reversible by brute force. Changing a key later changes every stored hash, so the migration has to be planned.

**Why it is not caught.** None of the variables is in the configuration schema (`apps/api/src/config.ts`), the example files, or `render.yaml`. Nothing refuses to start without them. Whether they are set in the Render dashboard is unverified.

**Fix.** Make each variable required when `NODE_ENV=production`, with a startup refusal. Remove the literals. Plan a re-hash migration for mobile and loan-account hashes before the keys are rotated.

### 3.2 Commission plan approval bypass

- `PATCH /v1/commission-plans/:id` accepts `status` (`packages/contracts/src/commission.ts`, line 61). The service writes it without any check (`apps/api/src/modules/finance/finance-service.ts`, lines 222 to 245, and `repository.ts`, line 346).
- A holder of `commission.plan.edit` can therefore set a plan to `ACTIVE`, with no approval, no `commission.plan.approve` permission and no step-up.
- The approval route itself sets `ACTIVE` unconditionally (`repository.ts`, line 366).
- An `ACTIVE` plan's basis, qualifying event and clawback window can also be changed without re-approval.

**Fix.** Remove `status` from the edit schema, or accept only `DRAFT` and `RETIRED`. Make `ACTIVE` reachable only through the approval route. Refuse edits to a non-`DRAFT` plan. Add a regression test for each.

### 3.3 Account binding by e-mail is on by default

`IDENTITY_EMAIL_FALLBACK` defaults to `true` (`apps/api/src/config.ts`, lines 35 to 38). When a Supabase user has no bound application identity, the resolver matches it to an application user by e-mail address. The server logs a warning for each use, and the warning says "bind this account". Nothing in the repository shows the binding was reviewed.

**Fix.** Default to `false` in production. Bind accounts explicitly with `tools/identity-binding.ts`, and record each one.

### 3.4 Eight production dependency advisories (npm audit, production only)

| Package | Severity | Note |
|---|---|---|
| `kysely` | high | SQL injection advisory on `Kysely<any>` and JSON path keys. The code uses `sql.raw` only with constants (`connector-insights.ts`, line 32). Upgrade needed; the fix is `npm audit fix --force`, which may be a major version |
| `body-parser` | high | Denial of service on compressed bodies. Fix available |
| `react-router` | high | Web. Fix available |
| `zod` | moderate or high | Fix available |
| `qs` | moderate | Fix available |
| `fflate` | moderate | Infinite loop on malformed ZIP64. Used by the archive job. Fix available |

### 3.5 Consent codes and messages are not delivered

- Consent OTP: the `consent.otp_requested` event is emitted (`apps/api/src/modules/finance/connector-portal.ts`, line 175) but has no consumer. This is open item AUD-P1-01.
- Messaging channels: `apps/api/src/modules/crm/messaging/messaging-service.ts` (lines 58 to 75) registers only `UnconfiguredAdapter` for e-mail, SMS and WhatsApp, unless `ENABLE_MOCK_PROVIDERS` is set. Nothing registers a real provider. The Twilio and Karza adapters exist only in the integrations module.
- Result: in production every customer message fails closed with `PROVIDER_NOT_CONFIGURED`. That is the safe behaviour, but it means the messaging features do not work.

### 3.6 Connector containment still open on hosted

`docs/CONNECTOR_HOSTED_DEPLOYMENT_CHECKLIST.md`, lines 13 to 17, records a connector login that still holds an open RM assignment, on user `usr_01M613P3AKR8Z5Q81E2F79GY60`. The checklist items (evidence export, suspend or not, end the assignment, post-check) are all unchecked. **Owner action needed:** run the read-only pre-check, then decide. This is a live access question, and it is the most time-sensitive item in this report.

### 3.7 Ungated financial operations

Full detail is in section 5.7 of `docs/PRODUCTION_SECURITY_CONTAINMENT.md`. The most important items:

- `POST /v1/commission/calculate` accepts `finance.view`, a read permission, and creates payables that feed payouts (`finance-service.ts`, line 284).
- `POST /v1/ledger/accounts` is guarded by `finance.view` (`ledger-service.ts`, line 114).
- `POST /v1/ledger/periods/:period/close` has no step-up and no second approver (`ledger-service.ts`, line 416).
- Invoice pay and void, and connector activation and status changes, have no step-up.
- Manual journal posting is correctly refused for every human session (`ledger-service.ts`, lines 71 to 82). Keep it.

## 4. CI health

Running the CI steps locally, in the order `.github/workflows/ci.yml` defines them:

| Job | Status | Cause |
|---|---|---|
| `lint` | **fails** | `npm run lint` reports 1 error in `e2e/helpers/mock-session.ts` (line 1247, `no-empty`). `npm run format:check` fails on 284 files: 214 under `apps/`, 30 under `docs/`, 23 under `e2e/`, 5 under `packages/`, and others |
| `typecheck` | passes | Root typecheck, exit 0 |
| `unit` | passes | 101 files, 1,488 tests |
| `web-build` | passes | |
| `integration` | passes locally | Focused set: 115 tests. The full suite was not run here |
| `migrate` | passes | `check:migrations`: 92 files unchanged. The `supabase start` and `db reset` steps were not run |
| `secrets` (gitleaks, full history) | **will fail** | The repository history holds the signing-key literal (commits `912a261`, `4000af4`, `71613d7`) and the upload-session secret literal (commits `71613d7`, `e97f998`). Needs an allowlist decision or the rotation in section 6 |
| `dependency-audit` | never blocks | `|| true` in the workflow |
| `contract` | **fails daily** | See 4.1 |
| `isolation` | passes | 549 tests |

### 4.1 OpenAPI contract check

`npm run gen:openapi` was run into the repository and diffed against the committed file. The `openapi/` folder was backed up first and restored exactly afterwards. Two problems:

1. **Dates change every day.** Zod defaults computed with `new Date()` are written into the document (`packages/contracts/src/commission.ts`, line 93; `packages/contracts/src/payouts.ts`, line 88). The `contract` job would fail on any day after the file was committed. **Fix:** replace them with static defaults, or remove the defaults.
2. **Hand-added path is lost on regeneration.** `GET /portal/v1/eligibility` (AUD-P3-01) exists in the committed file, is implemented (`apps/api/src/modules/finance/connector-portal.ts`, line 100), and is not produced by the generator. The next regeneration deletes it. **Fix:** register the route in the portal module's OpenAPI paths.

## 5. Connections

### 5.1 Routes and the OpenAPI contract

- **Mounted routes:** 491, from walking the Express router of the real application (`createApp`), with each top-level router mapped to its mount path.
- **Documented operations:** 481 in `openapi/openapi.yaml`. Every documented operation is mounted. The four "missing" entries from a first pass were array-registered aliases (`/leads/:id/conversion` and `/conversions`, `/reconciliation/auto-ingest` and `/lender-statements/auto-ingest`), so they are present.
- **Mounted but undocumented, 13:**
  - `GET /openapi.json`
  - `GET /public/v1/auth/config`
  - `GET /platform/v1/tenants/:id`, `GET /platform/v1/tenants/:id/flags`, `PUT /platform/v1/tenants/:id/flags/:key`
  - `POST /v1/users/:id/invitation/resend`, `GET /v1/users/:id/invitation`
  - `POST /v1/users/:id/erasure`
  - `GET /v1/leads/:id/assignments`
  - `POST /v1/lender-cases/:id/responses`, `POST /v1/lender-cases/:id/queries/responses`
  - The two alias paths above
- **Fix:** document these 13, so the contract and the isolation sweep both cover them.

### 5.2 Tenant isolation coverage

The isolation sweep (`tests/isolation/cases/sweep.spec.ts`) builds its list from the OpenAPI document. Undocumented routes are therefore not swept. Some have dedicated cases (erasure, invitation). Others have none: the lender-case responses (both routes), the platform tenant flags (both routes), and the leads assignments list.

### 5.3 Web to API

- **Distinct paths** the web app calls: 292, in non-test files.
- **Resolved:** all of them, against the mounted route table, with the correct HTTP method for each call. Zero method mismatches.
- **Exceptions:**
  - `POST /public/v1/auth/test-login` is called by the login page, but is mounted only when test authentication is enabled. The string also ships in the production bundle. The runtime path is closed by `!import.meta.env.PROD` (`apps/web/src/auth/test-auth.ts`), so risk is low. Recommend removing the client code from production builds.
  - `GET /public/v1/upload/:token` is mounted but closed. `PublicUploadPage` shows the error. This is expected.
- **Route under the wrong prefix:** `GET /v1/portal/connectors/:id/statements` is served under `/v1`, not `/portal/v1`. It works for staff. Connector logins are refused on `/v1` by design. The name is misleading, and it should be renamed or moved.

### 5.4 Web to e2e and test code

- `e2e/17-notion-golden-path-real-db.spec.ts` and `e2e/18-origination-end-to-end.spec.ts` call `/v1/leads/:id/actions/*` (attempt-contact, in-progress, reassign, qualify, convert). Those routes are no longer mounted. The specs are stale.
- `e2e/14-customer-secure-link.spec.ts` and `e2e/16-full-lifecycle-demo.spec.ts` use the closed public upload route. They will fail by design.
- None of the e2e specs was run (they need a browser and the public URL).

### 5.5 API to database

- **Tables:** every table the code reads or writes, extracted from its SQL, is created by a migration. The only matches not created by a migration are the renamed `ledger_entry` (in comments and in the rename test only) and English words from comments.
- **Migrations:** 92 files. The lock file matches every file (`check:migrations`).
- **Not checked:** columns. Column-level references were not validated against the schema. The integration and isolation suites exercise most of them.

### 5.6 Environment variables

- **Read by the code:** 27 distinct names.
- **Declared in the configuration schema:** 25.
- **Read by the API runtime but not declared in the schema:** the five fallback keys in section 3.1, `DOCUMENT_STORAGE_DIR` and `DOCUMENT_QUARANTINE_DIR`.
- **Read by the web app but not declared in its configuration:** `VITE_TEST_AUTH`, `VITE_TEST_BYPASS_OTP` and `VITE_DISABLE_MFA`. They are test switches, gated by `PROD` at runtime (section 5.3).
- **Read only by tools and tests:** `SUPABASE_SERVICE_ROLE_KEY` (`tools/feed-notion-real-data.ts`, `tools/provision-platform-admin.ts`), `DIRECT_DATABASE_URL`, `ALLOW_HOSTED_DEMO_SEED`, `DSA_ALLOW_0054_DATA_STEPS`, `HOSTED_CHECK_DATABASE_URL`. The API runtime does not read the service-role key. That matches the rule in `CLAUDE.md`.
- **Declared in the schema but missing from every example file:** `CLAMAV_ADDRESS`, `DOCUMENT_STORE`, `DOCUMENT_S3_ACCESS_KEY_ID`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_SECRET_ACCESS_KEY`, `ENABLE_MOCK_PROVIDERS`, `IDENTITY_EMAIL_FALLBACK`, `DATA_CORRECTION_EXECUTOR`.
- **`render.yaml` sets 8 variables.** Not set there: `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED`, `DISABLE_MFA`, `TEST_AUTH_ENABLED`, `IDENTITY_EMAIL_FALLBACK`, and the five fallback keys. Whether the Render dashboard sets them is unverified.

### 5.7 Background work

- **Job worker and outbox relay** run inside the API process. `server.ts` starts them every two seconds (`startBackgroundWorker`).
- **Job handlers:** three registered (document archive, user transfer, webhook delivery). Each enqueue site matches a registered handler.
- **Outbox subscribers** (`apps/api/src/wiring.ts`, lines 87 to 107): automation triggers, outbound webhooks, and in-app notifications for events that name a recipient. Events with no subscriber are `consent.otp_requested` (the known gap in 3.5), and `document.uploaded` and `document.scanned`. Those two are for audit and integrations, so their absence is probably intended.
- **Staff invitation sender:** a separate process, `tools/provisioning-worker.ts`. `server.ts` says it is sent by that worker. `render.yaml` defines no worker service. **Invitations are not sent in production unless someone runs that worker.**

### 5.8 Permissions

- **Permission codes checked directly by the code:** 69. All 69 exist in the catalogue (151 codes).
- **Catalogue codes not seen by a direct check:** 82. Most are probably checked through arrays, through `withLegacy`, or through role grants. Treat as a lead for a dead-permission review, not as a finding.

### 5.9 External systems

| System | State |
|---|---|
| Supabase (auth, database) | Connected. Migrations and the pooler are configured |
| ClamAV | Configured through `CLAMAV_ADDRESS`. No ClamAV service is defined in the blueprint |
| S3 document store | Code is ready. Not configured |
| Messaging (e-mail, SMS, WhatsApp) | Not connected. Fails closed (3.5) |
| Twilio and Karza | Adapters exist in the integrations module. Not wired to messaging |
| Payment rail | Deliberately refused (`payment-gateway.ts`). Good |
| Inbound webhooks | Signature checked with a timestamp window (`inbound-webhooks.ts`, lines 34 to 57) |

## 6. Pending work, consolidated

### Priority 1: before anything else

1. Confirm the connector containment on hosted (3.6).
2. Fix the commission plan approval bypass, with a test (3.2).
3. Make the five fallback keys required in production, and plan the hash migration (3.1).
4. Turn off e-mail account binding by default in production (3.3).
5. Decide on the stashes (teammate work, section 2).

### Priority 2: this week

6. Upgrade the eight dependency advisories, starting with `kysely` (3.4).
7. Fix the OpenAPI contract: static defaults, and the eligibility route registration (4.1).
8. Document the 13 undocumented routes, and add their isolation cases (5.1, 5.2).
9. Format the repository, and fix the lint error in `e2e/helpers/mock-session.ts`, so CI can go green (4).
10. Remove the stale startup warning in `server.ts`. It says document uploads fall back to the signature check, which is no longer true.
11. Add the production variables to `render.yaml` or the runbook: `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED`, `DISABLE_MFA`, `TEST_AUTH_ENABLED`, `IDENTITY_EMAIL_FALLBACK`, and the fallback keys.
12. Decide how the staff invitation sender runs in production (5.7).

### Priority 3: features not delivered

13. Consent OTP delivery: a consumer for `consent.otp_requested`, and a messaging channel (3.5). Needs the product owner's decision on the channel and the message.
14. Real messaging adapters: wire Twilio and the e-mail provider into the messaging channels (3.5).
15. Partner upload link: persist the session and change the partner contract (`docs/DOCUMENT_UPLOAD_CONTROLS.md`, section 6).
16. Document storage: S3 configuration, migrate the 13 origination documents and 2 sharing rows, and a private quarantine prefix (`docs/PRODUCTION_SECURITY_CONTAINMENT.md`, sections 8.2 and 8.3).
17. Session endpoints: `GET` and `DELETE /v1/me/sessions` (API-AUTH-005 and 006). `CLAUDE.md` lists them as not implemented.
18. Database types: `packages/contracts/src/db.ts` exports an empty `Database` interface. Generate it from the migrations, as the TODO says.
19. Missing document: `docs/DEFERRED_MODULES_TRACKING.md`, which `CLAUDE.md` refers to.

### Priority 4: financial and compliance controls

20. The ungated financial operations (3.7), each with a regression test, in the order given in the containment report.
21. Connector audit items still open (`docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`): AUD-P2-02 to 06, AUD-P3-03 to 05, the migration 0102 backfill decision, and the owner's read-only checks (Step 2).
22. The R1 check for fabricated payments (payouts marked `PAYMENT_RECORDED` with a `CMS` reference). Still not run. Owner action.

### Priority 5: hosted and operations (carried over from 2026-11-04)

23. The migration ledger (`supabase_migrations.schema_migrations`) is absent. Reconciliation plan in `docs/HOSTED_DEPLOYMENT_COMPLETION_REPORT.md`, section 11.
24. Backups: encrypt them, and add the `auth` schema. The current dumps do not include it.
25. Render: hold redeploys until the 13 document files' location is confirmed. Set the MFA and storage variables. Provision ClamAV.
26. Vercel: confirm the production branch, and remove `VITE_TEST_BYPASS_OTP` from its environment.
27. MFA enrolment: 20 of 22 app users have no verified factor. Enrol before setting `SUPABASE_MFA_ENABLED=true`.
28. Secrets: rotate the gateway signing key (AUD-P0-03) and the upload-session secret literal. Decide how the gitleaks job handles the history.

### Priority 6: testing

29. Run the Playwright e2e suite once the stale specs (5.4) are fixed.
30. Run the browser checklist in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`, section 10.
31. The live-database suites skip silently unless `DATABASE_URL` is set. The integration config sets it. Make the skip visible in the unit run, or document it.

### Priority 7: housekeeping

32. Remove the nine backup branches once the owner confirms the history is safe. Review `d1/TASK-102-supabase-auth`.
33. Move the root-level report, workbook and status script under `docs/` or `tools/`.
34. Refresh `CLAUDE.md`'s "Known gaps" section. It was last updated on 2026-10-21.
35. Reconcile the contradictory MFA statements across the docs with the current state (`docs/DSA_FINAL_RELEASE_READINESS.md`).

## 7. How this audit was done

- **Repository and git:** status, branches, stashes, remotes and CI definition, read directly.
- **Route table:** the real Express router, walked after `createApp()` with a transaction runner that refuses every call. Nothing was listened on, and no database was touched.
- **Web calls:** every string beginning with an API prefix in non-test web code, matched against the route table, with the HTTP method taken from the same statement.
- **OpenAPI:** the document parsed and compared with the route table. The generator was run once into the repository, the output was diffed, and the `openapi/` folder was restored from a backup, byte for byte.
- **Database:** SQL identifiers in the API source compared with the objects created by the migrations.
- **Environment:** every `process.env` read, compared with the configuration schema, the examples and `render.yaml`.
- **Permissions and jobs:** direct checks and handler registrations compared with the catalogue and the enqueue sites.
- **Tests:** skipped and conditional tests searched for. The local unit and integration suites were run again as part of the containment work on 2026-11-04.
- **Dependencies:** `npm audit --omit=dev --audit-level=high`. Development dependencies were not audited.

## 8. Limits

- No browser run. No e2e run.
- Column-level database references were not checked.
- The Render dashboard, the Vercel settings and the Supabase dashboard were not read. Every statement about them is marked unverified.
- The unused-permission count (82) and the undocumented-route list are based on static reading and may contain false positives.
- Messaging and integrations were assessed by reading the code, not by sending a message.
- The hosted database was not queried in this audit.
