# DSA CRM connector ecosystem: comprehensive audit

**Date:** 2026-11-03
**Scope:** MOD-CON (internal connector management) and MOD-CPT (partner portal, `/portal/v1`).
**Repository state:** branch `beta`, last commit `cbc3114` (pushed). Uncommitted changes are listed in section 17.
**Method:** code read at the file and line level, migration hash verification, reproduction tests run through the product's own routes against a disposable local database, and the test suites listed in section 10.

## 1. Executive summary

**Verdict: BLOCKED — CRITICAL SECURITY ISSUES.**

Three P0 defects were found. Two were reproduced through the product's own API routes, not only read from code:

| ID | Defect | Reproduced |
|---|---|---|
| AUD-P0-01 | `POST /v1/connectors/:id/status` accepts `targetStatus: "ACTIVE"` and sets it directly. It never checks for a VERIFIED connector verification. A user with `connector.manage` can activate any connector, which the compliance gate was built to prevent. | Yes: HTTP 200, connector went from PENDING_VERIFICATION to ACTIVE with no verification |
| AUD-P0-02 | `POST /v1/payout-requests/:id/disburse-gateway` makes no bank call. It generates its own reference, records the payout as paid, and posts the settlement journal. No money moves. | Yes: HTTP 200, payout became PAYMENT_RECORDED with a service-generated reference |
| AUD-P0-03 | The gateway service signs its acknowledgement with a key literal written in the source. Anyone with repository access can read it. | Yes, by reading the source (the value is not reproduced here) |

The compliance decision on connector verification is still open. That open decision is why the legitimate activation path is blocked. The status route is a second path that does not depend on that decision, so it is an outright bypass. The compliance documents currently say activation is refused for non-ACTIVE connectors. That is true only for `POST /v1/connectors/:id/activation`, and the documents need correcting (section 14).

**Primary P1 defects:**
- The consent OTP that the partner referral flow depends on is written to the outbox, but nothing delivers it. Referral submission cannot complete for a real customer.
- A partner payout request does not check for an approved bank account, and no finance code reads the connector's bank accounts.
- A verification is not checked against the consent record's subject, so a consent given for one subject can support a verification of another.
- Staff can attribute new leads to suspended, terminated or pending connectors.
- Attribution-dispute resolution has no segregation-of-duties check.
- Connector approvals (bank accounts, attribution, status changes) do not require step-up authentication. Payouts do.
- The rate card shown to a partner comes from `connector_agreement`. The commission engine does not read that table, so the rate shown may not be the rate applied.

**What is working:**
- The migration lock is clean: 92 files, 92 entries, no hash mismatches, no duplicate versions.
- Connector tables use tenant row-level security with FORCE enabled.
- Segregation of duties is enforced on bank-account approval and attribution approval.
- PAN is stored encrypted and shown masked.
- Payout amounts are recomputed on the server from stored payables, and open-dispute lines are excluded.
- Partner document uploads fail closed when the scanner is unavailable, with regression tests.
- Portal eligibility refuses every non-eligible state, and the identity gate stops portal logins from using internal routes.

**Before any production release:** AUD-P0-01, AUD-P0-02 and AUD-P0-03 must be fixed, and the fixes must be verified. Section 16 gives the reasoning, and the remediation plan (`docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`) gives the order.

## 2. Scope, method and limits

- **Read:** the connector service, router, insights, verification service, finance payout and gateway code, portal routes, lead creation, the event subscriber, the migrations for connectors (27, 84, 97–102), the contracts package, the OpenAPI document, and the web connector feature folder.
- **Verified by a script:** the migration lock (hash of every `.sql` file against `supabase/migrations.lock.json`).
- **Reproduced:** AUD-P0-01 and AUD-P0-02, in `apps/api/test/connector-audit-defects.int.spec.ts`. Each case is written as the behaviour the product must have and is marked `it.fails`. It passes while the defect exists and turns red when it is fixed, which is when the marker must be removed.
- **Not performed:**
  - **Browser testing.** No browser tool is available in this session. The UI findings come from code and the React Query key check, and the manual checklist in section 10 remains to be run.
  - **Hosted Supabase.** Not read or changed. Hosted migration state, hosted data and hosted credentials are unverified.
  - **External systems.** The real Supabase Auth e-mail delivery, the real ClamAV scanner, and any real bank or payment rail were not exercised. Tests use test doubles for these.
  - **Deployment.** The Render and Vercel deployed versions were not inspected.
- **Correction to the brief:** the brief describes a Next.js frontend. The repository uses a Vite and React single-page app (`apps/web`, built with `vite build`) and an Express API (`apps/api`, built with `tsup`). Data access uses Kysely. Prisma is not used.

## 3. Architecture and dependency map

```
apps/web (Vite + React)
  features/connectors/ConnectorPage.tsx ........ internal workbench (tabs in section 4)
  features/connectors/ConnectorPortalPage.tsx .. partner portal
  features/connectors/portal-eligibility.ts .... portal state notice and gating
  shell/partner-login.ts ....................... partner logins skip internal calls
        |  /v1 (internal)              /portal/v1 (partner)
apps/api (Express)
  app.ts ....................................... mounts /v1, /platform and /portal/v1
  http/connector-identity-gate.ts .............. refuses CONNECTOR logins on /v1 and /platform
  origination/connectors/router.ts ............. internal connector routes (25)
  origination/connectors/connector-service.ts .. lifecycle, bank accounts, agreements,
                                                 portal users, attribution, disputes
  origination/connectors/connector-insights.ts . dashboard summary, visibility-scoped
  origination/verifications/* .................. verifications (activation evidence)
  partner-view/portal-standing.ts .............. portal state: ELIGIBLE / CONNECTOR_PENDING / ...
  partner-view/partner-progress.ts ............. coarse partner-facing statuses
  finance/connector-portal.ts .................. partner routes (referrals, OTP, statements,
                                                 rate card, payouts, disputes)
  origination/applications/documents.ts ........ partner document routes and signed file links
  finance/finance-service.ts, router.ts ........ commission payables, payouts, gateway disburse
  finance/payment-gateway.ts ................... SIMULATED gateway (see AUD-P0-02)
  crm/leads/lead-service.ts .................... referral lead creation (connectorId accepted)
  crm/notifications/event-subscriber.ts ........ outbox consumer (lead, task, application only)
  provisioning/invitation-delivery.ts .......... invitation worker (Supabase Auth)
packages/contracts ............................. Zod schemas, permission codes, status enums
packages/kernel ................................ principal resolver, authz, idempotency, audit
supabase/migrations ............................ 92 SQL files, verified by migrations.lock.json
```

**Key dependencies:**
- Activation depends on `verification` rows with `subject_type = CONNECTOR` and `connector_id` set (migration 0101), and on the connector's own status.
- Partner payouts depend on `commission_payable` rows (finance), on `payout_request` and `payout_line`, and on step-up authentication.
- Partner referrals depend on the consent OTP (`referral_consent_otp`), which depends on the outbox, which depends on a consumer that does not exist (AUD-P1-01).
- The portal's eligibility depends on `app_user.user_type`, `app_user.status`, `connector.status` and `connector_id`, read in the caller's tenant.

## 4. MOD-CON: internal connector management

Status key: **Pass** (verified in code and, where stated, in tests) · **Partial** · **Fail** · **Not verified**.

| Area | Status | Evidence and notes | Findings |
|---|---|---|---|
| Dashboard statistics | Pass | `connector-insights.ts` counts connectors by status in the caller's visibility. Earnings are `null` when the caller cannot read them, not zero. The connector state set has no `REJECTED`, so a "rejected" count cannot exist. | — |
| Dashboard filters, pagination, loading and empty states | Partial | Listing takes `limit` and a cursor (`max(200)`). Loading and empty states are in the UI. Not browser-tested. | — |
| Directory: listing and search | Pass | `GET /v1/connectors` requires `connector.read` and applies visibility. `GET /v1/connectors/lookup` is a separate route. Tenant scoping is enforced by row-level security. | — |
| Directory: row actions | Partial | Row actions depend on status and `connector.manage`. Not browser-tested. | — |
| Creation: permission | Pass | `createConnector` requires `connector.manage` (service line 232). Partners cannot create connectors. | — |
| Creation: default status | Pass | New connectors are inserted as `DRAFT` (service lines 303, 332). Creation does not activate. | — |
| Creation: duplicates | Partial | PAN is checked for duplicates within the tenant, and so is e-mail. Mobile is not checked: `connector_mobile_idx` is a plain index, not a unique constraint, and the service has no mobile check. | AUD-P2-01 |
| Creation: branch and relationship manager | Partial | The branch is checked for existence within the tenant. The relationship manager is an internal user. Whether the frontend can choose a branch outside the caller's scope was not tested. | — |
| Profile and KYC: PAN | Pass | PAN is encrypted at rest (`encrypted_pan`) and returned as `pan_masked` only. | — |
| Profile and KYC: contact details | Pass | Managers see full contact details. Others see masked values (`contactValue`, service line 114). | — |
| Profile: editing | Pass | `PATCH /v1/connectors/:id` requires `connector.manage` and an ETag. Changing the relationship manager needs a reason and is audited separately. | — |
| Verification: records | Partial | A verification names its subject and, for a connector, `connector_id` (migration 0101, composite foreign key). The verification service refuses `CONNECTOR` as a subject, so connector verifications cannot be recorded. This is the documented compliance block. | AUD-P1-07 (business) |
| Verification: consent link | Fail | The consent check reads the record by id, tenant, status, purpose and expiry. It does not compare the consent's subject with the verified subject. | AUD-P1-03 |
| Verification: activation gate | Pass with bypass | `POST /v1/connectors/:id/activation` requires a VERIFIED record about this connector (service `assertConnectorVerification`, line 186). The status route does not apply this gate. | AUD-P0-01 |
| Lifecycle: states | Pass | `DRAFT`, `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `TERMINATED` (`packages/contracts/src/connector.ts` lines 16–22). No undocumented states. | — |
| Lifecycle: transitions | Fail | `updateConnectorStatus` writes any target that the schema accepts (`ACTIVE`, `SUSPENDED`, `TERMINATED`) from any state except `TERMINATED`. There is no transition table. | AUD-P0-01 |
| Lifecycle: reason and audit | Pass | A status change needs a reason of at least five characters, is audited as `connector.status_changed` with the previous and new status, and is written in the same transaction. | — |
| Lifecycle: portal access on suspension | Pass | Suspending or terminating a connector suspends its linked portal logins (service, status update). Tests TEST-CPU-08 and portal test 3 cover refusal. | — |
| Lifecycle: referrals to suspended connectors | Fail | Staff can attribute a new lead to a suspended, terminated or pending connector. Only the existence of the connector is checked (foreign key `lead_connector_fk`). | AUD-P1-04 |
| Bank accounts: create | Partial | Created as `PENDING_APPROVAL` (line 844). Account numbers are validated (9–18 digits) and IFSC format is checked. Masked display helper exists (`maskAccountNumber`); response masking was not checked on every path. | — |
| Bank accounts: approval and SOD | Pass | `approveBankAccount` requires `connector.bank_change_approve` and refuses the creator as approver (`SOD_SELF_APPROVAL_PROHIBITED`, line 931). | AUD-P1-08 (no step-up) |
| Bank accounts: rejection, primary, change history | Fail | No rejection path (only approve and disable). No primary-account concept. Disable overwrites status without a separate change record. | AUD-P2-02 |
| Bank accounts: use in payouts | Fail | No finance code reads `connector_bank_account`. Payouts are not tied to an approved account. | AUD-P1-02 |
| Agreements: versions and validity | Partial | Agreements carry `version`, `valid_from`, `valid_to`, `lock_version`, and a check that `valid_to > valid_from`. No overlap check. | AUD-P2-03 |
| Agreements: rate cards and commission | Fail | The rate card is shown from `connector_agreement`. Commission is calculated from rule sets (`commission_calculation`, `rule_set_version`). The two are not linked. | AUD-P1-06 |
| Referrals: connector list | Pass | `GET /v1/connectors/:id/referrals` requires `lead.read` and the caller's visibility. | — |
| Referrals: duplicates and attribution (partner) | Pass | The partner route refuses an exact duplicate or an attribution conflict (`DUPLICATE_OPEN_ENQUIRY`), and rolls back the lead and leaves the consent code unused. A possible duplicate in another branch is created and flagged. | — |
| Referrals: duplicates (staff) | Not verified | Staff leads use `lead-service`; duplicate flags were not re-verified in this audit. | — |
| Earnings: payables | Pass | `GET /v1/commission-payables?connectorId=` requires finance view (`assertCommissionRead`). The earnings tab uses this route. | — |
| Earnings: reconciliation | Partial | Settlement journals post fixed accounts (`2100-COMMISSION-PAYABLE`, `1010-SETTLEMENT-BANK`), not per-connector accounts. Per-connector reconciliation was not verified. | AUD-P0-02 |
| Attribution requests: approval and SOD | Pass | `approveAttributionChangeRequest` requires `connector.attribution_change` and refuses the requester as approver (`SOD_09_SELF_APPROVAL_PROHIBITED`, line 1706). | AUD-P1-08 (no step-up) |
| Attribution requests: atomicity | Not verified | Whether the lead reassignment and the request status change happen in one transaction was not traced line by line. | — |
| Attribution disputes: resolution | Fail | `resolveAttributionDispute` requires `connector.dispute_resolve` but does not compare the resolver with the person who raised the dispute. | AUD-P1-05 |
| Portal access and users: invitation | Pass | Invitations create an `INVITED` login with no role, delivered by the provisioning worker. Tests TEST-CPU-01 to 10 cover creation, delivery, resend, revoke, suspension, expiry and reactivation. | — |
| Portal access and users: activation of login | Pass | A login becomes `ACTIVE` only on a password sign-in that completes the invitation (lifecycle test 1). | — |
| Portal access and users: shared query key | Pass (fixed this session) | `['connector-portal-users', id]` was used with two response shapes. Fixed by `connectorPortalUsersQuery`, with regression spec `connector-portal-users-query.spec.ts`. | — |
| Activity and audit | Partial | Fourteen connector audit actions are recorded in the service (`connector.created`, `connector.activated`, `connector.status_changed`, bank and agreement events, invitations, attribution and disputes). Consent-OTP sends are not audited. Sensitive-value exposure in activity payloads was not checked field by field. | AUD-P3-02 |

**Workbench tabs (internal):** the tab order is fixed (`CONNECTOR_TAB_KEYS`): overview, profile, verification, bank, agreements, referrals, earnings, attributions, portal, activity. Visibility rules and labels are in `connector-workspace-model.ts`. The page also has three top-level tabs: Directory, Attribution Requests and Disputes & Duplicate Referrals. Each tab's purpose is explained in the connector module review given to the owner on 2026-11-03.

## 5. MOD-CPT: partner portal

| Area | Status | Evidence and notes | Findings |
|---|---|---|---|
| Authentication: Supabase Auth and invitation only | Pass | Partner logins are created only through the invitation pipeline, and activated on password sign-in (lifecycle tests). | — |
| Authentication: user type and status from the database | Pass | The principal resolver reads `user_type` and `status` from `app_user`. A request cannot choose them. | — |
| Authentication: identity gate | Pass | `connectorIdentityGate` refuses partner logins on `/v1` and `/platform` except `GET /me`. Tests in `connector-identity-gate.spec.ts` and `connector-insights` TEST-CINS-06. | — |
| Authentication: logout and session expiry | Not verified | Not audited in this pass. | — |
| MFA | Partial | Step-up is required for partner payout requests and for the gateway disbursement. The partner login's own MFA setting was covered in the earlier MFA work and is not re-audited here. | AUD-P1-08 |
| Eligibility: the states | Pass | `standing()` in `partner-view/portal-standing.ts` returns one state per login. The matrix in section 5.1 was checked against it and against tests. | — |
| Eligibility: the frontend gate | Pass | `ConnectorPortalPage` requests nothing but the eligibility state until the state is ELIGIBLE. Blocked states show a notice. | — |
| Eligibility: no connector data | Pass | The eligibility response names no connector, customer or identifier. Refusal details carry only a reason code. | — |
| Dashboard: referrals count and progress | Pass | `GET /portal/v1/referrals` returns the connector's leads only, with masked names and mobiles and coarse statuses. | — |
| Dashboard: earnings and statements | Pass | `GET /portal/v1/statements` totals come from `commission_payable`, computed on the server. | — |
| Dashboard: pending documents | Partial | `GET /portal/v1/referrals/:leadId/documents` lists approved document types with partner status. | — |
| Dashboard: recent activity | Missing | No partner-facing activity feed exists. | AUD-P3-03 |
| Dashboard: loading, empty and error states | Partial | Implemented in the page. Not browser-tested. | — |
| Referral submission: fields and strictness | Pass | `ReferralCreate` is `.strict()`, so the partner cannot send a connector id to change attribution. The connector is taken from the caller's standing. | — |
| Referral submission: consent OTP sending | Partial | `POST /portal/v1/referrals/consent-otp` with `SEND` stores a hashed code, rate-limits to 20 sends per hour, and writes `consent.otp_requested` to the outbox. | AUD-P1-01 |
| Referral submission: consent OTP verification | Pass | Five attempts and a ten-minute expiry. The code is never returned or logged. A verified code is single-use (`used_by_lead`). | — |
| Referral submission: duplicates and attribution | Pass | See section 4, referrals. | — |
| Referral tracking: coarse status | Pass | `partner-progress.ts` maps internal lead states to partner labels. Tests in `partner-progress.spec.ts`. The mapping was not re-read line by line. | — |
| Document upload: approved types | Pass | Only types with `partner_upload = true` (migration 0100) are offered and accepted. Tests TEST-CPT-DOC and TEST-CPT-DOCL. | — |
| Document upload: scanning and fail-closed | Pass | Without a working scanner the upload is refused and nothing is recorded (TEST-CPT-DOC-01, -02). A file the scanner finds infected is quarantined (DOC-07). The real ClamAV service was not exercised. | — |
| Document upload: ownership | Pass | Another connector cannot upload to the referral (DOC-04), and completion is limited to the connector that started it (DOC-09). | — |
| Document download | Pass | Partners have no download route (DOC-10). Staff document routes refuse connector logins. | — |
| Signed file links | Partial | `GET /portal/v1/document-files/:token` serves a file to anyone holding a valid signed token, without a login. The signature is canonical and must have exactly two segments (F21, earlier phase). Link lifetime and single-use were not reviewed. | AUD-P2-06 |
| Statements and rate card | Partial | Totals are server-computed. The rate card is read from `connector_agreement`, which is not the commission rule. | AUD-P1-06 |
| Payouts: payable validation | Pass | Every payable must belong to the connector, be ELIGIBLE or APPROVED, not be in an included payout line, and have no open dispute. Rows are locked with `FOR UPDATE`. | — |
| Payouts: amount | Pass | The amount is summed on the server from stored payables. The client sends only payable ids. | — |
| Payouts: step-up | Pass | `requireStepUp` is called before the request is processed. | — |
| Payouts: bank account | Fail | The request does not check for an approved bank account. | AUD-P1-02 |
| Payouts: duplicate prevention | Pass | Included payout lines and the `Idempotency-Key` both guard against duplicates. | — |
| Payouts: after the request | Fail | The staff payment path can be the simulated gateway (AUD-P0-02). The manual payment path was not reviewed. | AUD-P0-02 |
| Disputes: raise | Pass | Categories depend on the item type (`DISPUTE_CATEGORIES_FOR`). A reason may not contain an identity or account number. One open dispute per item. | — |
| Disputes: own list and resolution visibility | Pass | The list excludes the internal resolution. | — |
| Disputes: evidence attachments | Missing | No evidence attachment exists. Adding one needs a new subject type, storage, malware scanning and access control. | AUD-P3-04 (business decision) |
| Profile | Missing | The portal has no profile route and no profile section. The brief asks partners to manage their profiles. | AUD-P2-04 |

### 5.1 Portal eligibility matrix (checked against `standing()` and the lifecycle tests)

| User status | User type | Connector status | Expected | Result |
|---|---|---|---|---|
| INVITED | CONNECTOR | ACTIVE | Refused | Refused (`NOT_LINKED`, login not ACTIVE; sign-in refused until password set) |
| ACTIVE | CONNECTOR | PENDING_VERIFICATION | Refused | Refused (`CONNECTOR_PENDING`) |
| ACTIVE | CONNECTOR | SUSPENDED | Refused | Refused (`ACCESS_SUSPENDED`) |
| SUSPENDED | CONNECTOR | ACTIVE | Refused | Refused (`ACCESS_SUSPENDED`, sign-in refused with suspension text) |
| ACTIVE | CONNECTOR | ACTIVE | Allowed | Allowed (`ELIGIBLE`) |
| ACTIVE | STAFF | ACTIVE | Refused | Refused (`NOT_LINKED`, not a partner login) |
| ACTIVE | CONNECTOR | no link | Refused | Refused (`NOT_LINKED`, no connector link) |

Each refused row has a fixed message and reveals no connector data. The lifecycle tests cover the INVITED, PENDING, SUSPENDED and no-link rows. The staff row is covered by `standing()` and was not tested separately.

## 6. API audit

- **Route inventory.** Internal connector routes: 25 (`router.ts`). Partner routes: 10 in `finance/connector-portal.ts` under `/portal/v1`, and 5 document routes in the partner section of `documents.ts` (list, upload intent, completion, signed PUT, signed file). Verification routes: 3. Payout and commission routes are in `finance/router.ts`.
- **OpenAPI.** Of the connector and portal paths in `openapi/openapi.yaml` (42), spot checks found each one in code. `GET /portal/v1/eligibility` is missing from the document (AUD-P3-01).
- **Errors.** Every refusal uses the `AppError` envelope with a code, a message and optional details. Permission refusals are `FORBIDDEN` with the permission named in the message.
- **Validation.** Request bodies are parsed with Zod and unknown fields are refused on the partner routes (`.strict()`).
- **Concurrency.** Connector mutations use `If-Match` with the lock version. A stale write returns `VERSION_CONFLICT`.
- **Idempotency.** Mutations require an `Idempotency-Key`.
- **Pagination.** Lists take `limit` (maximum 200) and a cursor.
- **Tenant isolation at the API.** Every query carries the tenant id, and row-level security enforces it in the database.

## 7. Database and migration audit

| Item | Result |
|---|---|
| Migration lock | 92 files, 92 lock entries, 0 hash mismatches, 0 files missing from the lock, 0 lock entries without a file, 0 duplicate version prefixes. Verified by script. |
| 0098 and 0099 (origin, sub-permission expand and role grants) | Migration tests: `migration-0098-0099.int.spec.ts`. Results in section 10. |
| 0100 (partner dispute category and upload flag) | Migration test: `migration-0100.int.spec.ts`. |
| 0101 (verification connector subject) | Composite foreign key to `connector (tenant_id, id)`, and a check that the connector id is present exactly when the subject is `CONNECTOR`, and that a connector subject's `subject_id` equals `connector_id`. Migration tests: `migration-upgrade-0100-0102.int.spec.ts`. |
| 0102 (partner dispute category required) | `NOT VALID`. Rows created before 0100 keep a NULL category until a backfill decision is made, then `VALIDATE CONSTRAINT` must be run. This is a business decision (section 12). |
| Hosted state of 0098–0102 | **Not verified.** The hosted database was not accessed. The runbook states these migrations are not applied to hosted, but that is a claim, not a check. |
| Row-level security, connector tables | `enable_tenant_rls` (ENABLE, FORCE, and a tenant policy) on `connector`, `connector_bank_account`, `connector_agreement`, `attribution_change_request`, `attribution_dispute`, `referral_consent_otp`, `verification`, and the payout and commission tables. |
| Row-level security scope | Tenant only. Connector scope is enforced in application code, not in the database. | 
| Grants | Migration 0097 role guards and the 0098/0099 grant tests were relied on. A full privilege review was not performed. |
| Rollback scripts | `tools/sql/batch/98.rollback.sql` and `99.rollback.sql` exist. Whether they refuse unsafe data loss was not checked line by line. Related tests are in `migration-batch-runbook.int.spec.ts`. |
| Indexes | `connector_mobile_idx` is not unique (AUD-P2-01). `verification_connector_idx` covers connector verification history. |

## 8. Security audit

| # | Area | Status | Evidence |
|---|---|---|---|
| 1 | Cross-tenant access | Pass | Tenant row-level security with FORCE on connector and finance tables. Isolation sweep (section 10). |
| 2 | Cross-connector access | Partial | Partner routes filter by the connector from the standing. Internal reads are limited by relationship manager (`connector-access` tests). Connector scope is not enforced in the database (AUD-P2-05). |
| 3 | Insecure direct object references | Pass | Partner referral, document and payout routes check ownership through joins (`ownedApplication`, payable ownership). |
| 4 | Portal and internal route separation | Pass | Identity gate on `/v1` and `/platform`. Staff refused on `/portal/v1` (`NOT_LINKED`). |
| 5 | Connector identity mapping | Pass | `user_type` and `status` come from `app_user`. |
| 6 | Invitation tokens | Partial | Tokens are handled by Supabase and the provisioning worker. The API does not store them. Not re-audited. |
| 7 | Session management | Not verified | Not audited in this pass. |
| 8 | MFA enforcement | Partial | Step-up on partner payouts and gateway disbursement. No step-up on connector approvals (AUD-P1-08). |
| 9 | Consent ownership | Fail | Consent subject is not matched to the verified subject (AUD-P1-03). |
| 10 | Verification subject integrity | Fail | The activation check is correct, but the status route bypasses it (AUD-P0-01). |
| 11 | Bank account security | Partial | Maskable, approval with SOD. Not linked to payouts (AUD-P1-02). |
| 12 | Payout authorization | Fail | Server-side amounts and step-up are correct. The gateway records fabricated payments (AUD-P0-02). |
| 13 | Document upload scanning | Pass | Fail-closed without a working scanner (tests DOC-01, DOC-02, DOC-07). Real ClamAV not exercised. |
| 14 | Signed URL validation | Partial | Canonical signature and exact segment count (F21, earlier phase). Bearer link; lifetime and reuse not reviewed. |
| 15 | Referral attribution | Partial | Partner connector is server-side and the conflict check is correct. Staff attribution to suspended connectors is not refused (AUD-P1-04). |
| 16 | Dispute resolution | Partial | Permission check present. No segregation-of-duties check (AUD-P1-05). |
| 17 | Audit log completeness | Partial | Most mutations are audited. Consent-OTP sends are not (AUD-P3-02). |
| 18 | RLS enforcement | Pass | Enable and force on the connector tables (section 7). |
| 19 | Sensitive data exposure | Fail | PAN masked, eligibility response clean. A signing key is written in the source (AUD-P0-03). |
| 20 | Rate limiting and abuse protection | Pass | `rateLimit()` on `/v1`, `/platform` and `/portal/v1`. Consent-OTP sends limited to 20 per hour per connector. Not load-tested. |

**Carry-over findings from earlier phases:**
- **F1 (credential rotation):** not fixed. It is an administrator action and is not verified here.
- **F7 (TLS in the status script):** fixed in the earlier phase. `check_status.cjs` verifies TLS and reads an optional CA file. Tests TEST-CHKSTAT-03 and -04 cover it.
- **F21 (signed link canonicalisation):** fixed in the earlier phase, with tests.
- **F22 (invitation claim on the database clock):** fixed in the earlier phase. Regression test TEST-WRK-11 passed in the isolation run (section 10).

## 9. Permission matrix

| Action | Permission | Enforced in | Notes |
|---|---|---|---|
| Create connector | `connector.manage` | `createConnector` | Partners cannot create. |
| Read connectors | `connector.read` | `listConnectors`, `getConnector` | Visibility by relationship manager. |
| Edit connector | `connector.manage` | `updateConnector` | Relationship-manager change needs a reason. |
| Activate connector | `connector.manage` and a VERIFIED connector verification | `activateConnector` | |
| Change status (including ACTIVE) | `connector.manage` | `updateConnectorStatus` | **ACTIVE bypass (AUD-P0-01).** |
| Create bank account | `connector.bank_account_manage` | `createBankAccount` | |
| Approve bank account | `connector.bank_change_approve`, creator cannot approve | `approveBankAccount` | No step-up. |
| Manage agreements | `connector.agreement_manage` | `createAgreement` | |
| Manage portal users | `connector.portal_user_manage` (legacy mapping) | portal user service methods | |
| Request attribution change | `connector.attribution_change` | `createAttributionChangeRequest` | |
| Approve attribution change | `connector.attribution_change`, requester cannot approve | `approveAttributionChangeRequest` | No step-up. |
| Resolve attribution dispute | `connector.dispute_resolve` | `resolveAttributionDispute` | No segregation-of-duties check (AUD-P1-05). |
| Read commission payables | `finance.view` | `listPayables` (`assertCommissionRead`) | |
| Request payout (partner) | Partner standing (ELIGIBLE) and step-up | `payout-requests` (portal) | No bank check (AUD-P1-02). |
| Approve, record, or gateway-disburse payout | `payout.approve`, `payout.record_payment`, `payout.disburse` | finance routes | Gateway also needs step-up (AUD-P0-02). |
| Create verification | `verification.perform` | `createVerification` | Connector subject refused. |
| Read verifications | `verification.read` | `listVerifications` | |
| Read referrals | `lead.read` | connector referrals route | |

## 10. Testing evidence

Current counts are the results of the sequential run listed below. Results are filled in from the run log.

| Step | Command | Result |
|---|---|---|
| Typecheck, root workspaces | `npm run typecheck` | **Failed once:** 1 error, `apps/api/src/modules/finance/connector-portal.ts` line 103 (`req.log`, which the root `tools` check does not type). This was introduced by the eligibility route in commit `cbc3114`. Fixed in the working tree (uncommitted, kept as a separate change). Re-run after the fix: exit 0. |
| Kernel unit | `npx vitest run` in `packages/kernel` | Pass: 5 files, 31 of 31 tests |
| Web unit | `npx vitest run` in `apps/web` | Pass: 112 files, 752 of 752 tests |
| Web production build | `npm run build` in `apps/web` | Pass (Vite, 31 s). Chunk-size warning only |
| API production build | `npm run build` in `apps/api` | Pass (tsup) |
| API unit | `npx vitest run` in `apps/api` | Pass: 98 files, 1411 of 1411 tests. One earlier run had a 30 s timeout under load in `grievances.spec.ts`; it passed alone and in this run |
| API integration, focused (connector, portal, verification, document, payout, dispute, attribution, invitation, audit, migration) | `npx vitest run --config vitest.int.config.ts <filters>` | 26 files: 23 pass, 184 tests. **3 fail at setup:** `migration-sequence`, `migration-batch-partial`, `migration-batch-runbook`. Each stops on a foreign-key error (`role_permission` → `permission`) inside a migration file applied to a fresh database. Their 34 tests were skipped. Not resolved in this audit; tracked as AUD-P1-09 (section 13) |
| Tenant isolation sweep | `npm run test:isolation` | Pass: 18 of 18 files, 549 of 549 tests, in one clean run. The five file-level failures in the earlier run (container HTTP 500 and one 120 s timeout) passed when rerun alone |
| Lint, root | `npm run lint` | 958 problems: 1 error and 957 warnings across the repository. The error is an empty block reported against `e2e/helpers/mock-session.ts`, which predates this audit. Warnings are mostly unused variables and `any` in test and e2e code. The connector files changed in this session pass ESLint when checked on their own |

**Reproductions (this audit):** `apps/api/test/connector-audit-defects.int.spec.ts`, guarded config. Both cases pass as `it.fails`, which means both defects are present:
- AUD-P0-01: `observed: http 200 connector status ACTIVE`
- AUD-P0-02: `observed: http 200 payout status PAYMENT_RECORDED reference CMS…IMPS…`

**Known flakes and infrastructure failures in the earlier isolation run:** four files failed at container setup with a Docker HTTP 500, and one ledger test timed out at 120 seconds. Rerun alone, all five files passed (41 of 41). These are infrastructure failures, not application failures.

**Final verification after the two approved fixes (AUD-P0-01 and AUD-P0-02), 2026-11-03/04, all uncommitted:**

| Check | Result |
|---|---|
| Typecheck, root workspaces | Pass (exit 0, no TypeScript errors) |
| Kernel unit | Pass: 5 files, 31 of 31 |
| Web unit | Pass: 112 files, 752 of 752 |
| API unit | Pass: 98 files, 1411 of 1411 |
| API integration, focused | 23 of 26 files pass: 187 tests pass and 34 are skipped. The three failing files are the migration rehearsals in AUD-P1-09, which failed before these fixes and are unchanged by them. The regression file `connector-audit-defects.int.spec.ts` passes 5 of 5, and the connector verification, access, portal and payout suites pass |
| Tenant isolation sweep | Pass: 18 of 18 files, 549 of 549 tests |
| Web production build | Pass |
| API production build | Pass |
| Lint, root | 958 problems: 1 error and 957 warnings. The error is the empty block in `e2e/helpers/mock-session.ts`, which predates these changes. The count is the same as before the fixes, so the changes add no lint problems |

**Manual checklist (browser not available):**
1. Open a connector in `DRAFT`, then open Verification and confirm the Activate dialog lists nothing and says so.
2. Open Overview, then Portal Access & Users. Confirm the user count matches and the page does not crash.
3. Sign in as an invited partner before setting a password. Confirm the invitation notice.
4. Sign in as an ACTIVE partner with a PENDING connector. Confirm the notice and that no data loads.
5. Open the status dialog and confirm the ACTIVE option (AUD-P0-01). Do not submit it outside a test database.

## 11. End-to-end scenarios

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | New connector | Pass | Created as DRAFT. Duplicate mobile not refused (AUD-P2-01). |
| 2 | Verification | Blocked | Connector verification cannot be recorded (compliance decision). Customer and lead verifications unaffected. |
| 3 | Activation | Fail | The legitimate activation path refuses correctly. The status route activates without verification (AUD-P0-01). |
| 4 | Portal invitation | Pass | Invitation, delivery, password sign-in activation (TEST-CPU and lifecycle tests). |
| 5 | Portal login | Pass for eligibility | Dashboard data loads only for an ACTIVE connector. The dashboard was tested with a fixture, not an approved activation. |
| 6 | Referral with consent | Fail in production | The OTP is never delivered (AUD-P1-01). Tests check the database row only. |
| 7 | Loan progress | Partial | Partner status mapping tested. End-to-end through lender decisions not run. |
| 8 | Documents | Pass | Upload, scan, quarantine and ownership tests. Real scanner not exercised. |
| 9 | Commission | Partial | Payables come from the finance engine. Connector agreements are not linked (AUD-P1-06). |
| 10 | Payout | Fail | No bank check (AUD-P1-02). Gateway disbursement fabricates payment (AUD-P0-02). |
| 11 | Dispute | Partial | Partner raise works. Staff resolution has no segregation check (AUD-P1-05). |
| 12 | Suspension | Pass for portal | Portal refused on suspension (TEST-CPU-08, portal test 3). Staff can still attribute new leads to the suspended connector (AUD-P1-04). |

Negative cases are covered in each scenario's tests (refusals, cross-tenant and cross-connector attempts, duplicates, rejected verifications).

## 12. Business-rule decisions

These decisions are not made. Each item shows what the code does today, and what stays disabled until someone approves a decision. Nothing here was decided on anyone's behalf.

| Decision | Current implementation | Business impact | Security impact | Recommendation | Disabled until approved |
|---|---|---|---|---|---|
| Connector-specific consent | No connector consent record can be written. Verification and activation of non-ACTIVE connectors are blocked. | No connector can be activated through the product. Partner onboarding stalls. | The block is correct. The status-route bypass (AUD-P0-01) is not. | Option A (connector consent), after compliance review. Documented in `CONNECTOR_VERIFICATION_DECISION.md`. | Connector consent capture and connector verification. |
| Verification approval | Any user with `verification.perform` records a verification. There is no approval step. | Verification is only as trustworthy as the person recording it. | No second person checks a verification. | Decide who may record connector verifications and whether a second approver is needed. | Connector verification recording. |
| Partner-upload document types | Types are marked with `partner_upload` (migration 0100). None is listed in this audit. | Partners can upload only what is approved. | A wrong type approval widens what partners can send. | Approve a short list with the business. | Upload for any type not on the list. |
| Partner dispute categories | Payouts and statement lines: COMMISSION_CALCULATION, PAYOUT, OTHER. Referral categories are not defined. | Partners can raise only these disputes. | None beyond the category check. | Confirm the list and define referral categories. | Referral disputes. |
| Historical dispute backfill | 0102 is `NOT VALID`. Old partner disputes can have a NULL category. | Reports may show uncategorised disputes. | Low. | Decide the backfill rule, then run `VALIDATE CONSTRAINT`. | Full validation of the category constraint. |
| Partner-visible status labels | `partner-progress.ts` maps internal states to labels. | Partners see only the coarse labels. | Label mapping must never reveal internal decisions. | Approve the label list. | Any new partner-visible status. |
| Staff visibility of customer names | Partners see masked names. Staff visibility was not verified. | Staff workflow depends on it. | Personal data exposure. | Confirm the rule for each staff role. | Changes to name visibility. |
| Dispute evidence attachments | Not implemented. | Disputes rely on text only. | Attachments add a new upload path that needs scanning and access control. | Decide whether evidence is needed. If yes, add a subject type and scan. | Evidence upload. |
| MFA step-up for payouts and approvals | Payouts and gateway: step-up. Bank, attribution and status approvals: no step-up. | Approvals made without re-authentication. | Stolen sessions can approve. | Require step-up for bank approval, attribution approval, status changes and dispute resolution. | Not applicable (policy change). |
| Gateway disbursement (new) | A simulated gateway records fabricated payments (AUD-P0-02). | Payment records do not match money movement. | Critical. | Remove the route, or integrate with a real bank under approval. | The route stays disabled. |
| Connector agreements and commission | The rate card and the commission rule are separate. | Partners may see one rate and be paid another. | Financial misstatement. | Decide the source of truth, then link agreements to rule sets. | Rate card display changes. |
| Suspended connector and new referrals | Staff can still attribute leads to a suspended connector. | Commission can accrue to a suspended partner. | Policy gap. | Decide the policy, then refuse non-ACTIVE connectors on lead creation. | Not applicable (policy change). |

## 13. Findings register

Priority: P0 critical security or integrity · P1 major functionality or business workflow · P2 important usability or operational · P3 enhancement or cleanup.

### P0

**AUD-P0-01: the status route activates a connector without verification.**
- *Status (after the approved fix, uncommitted):* the status route refuses `ACTIVE` with `VALIDATION_ERROR` and the detail `USE_ACTIVATION_ROUTE`, and the schema no longer accepts `ACTIVE`. The status dialog's Reinstate buttons open the activation dialog, which asks for a reason of at least five characters, and the activation route still needs a VERIFIED record. Regression tests: `connector-audit-defects.int.spec.ts`, `connectors.spec.ts`.
- *Evidence:* `apps/api/src/modules/origination/connectors/connector-service.ts` `updateConnectorStatus` (about line 720) writes `input.targetStatus` directly. `packages/contracts/src/connector.ts` lines 154–156 allow `ACTIVE`. The route is in `router.ts` lines 199–218. `assertConnectorVerification` (line 186) is called only from `activateConnector` (line 687).
- *Impact:* a user with `connector.manage` activates any connector. The partner portal then opens for an unverified connector, and commission accrues to it. This defeats the compliance gate.
- *Reproduction:* `connector-audit-defects.int.spec.ts`, AUD-P0-01. Observed HTTP 200 and status ACTIVE.
- *Fix:* remove `ACTIVE` from `UpdateConnectorStatusSchema`. Route activation only through `activateConnector`. Remove the ACTIVE option from the status dialog. Add a transition table.
- *Dependencies:* none for the fix. Business approval is needed to change which states the status route accepts.
- *Test needed:* the AUD-P0-01 case, with its `it.fails` marker removed. A test that the status route refuses ACTIVE for any connector. A test that a suspended connector cannot be set ACTIVE through the status route.
- *Check on hosted (owner, read-only):* list `connector.status_changed` audit rows where `newStatus = 'ACTIVE'`, and confirm each has a matching VERIFIED connector verification.

**AUD-P0-02: the gateway disbursement records a fabricated payment.**
- *Status (after the approved fix, uncommitted):* the gateway refuses every disbursement with `DEPENDENCY_UNAVAILABLE` and the detail `GATEWAY_NOT_CONFIGURED`, before any reference, signature or payment record is produced. The batch gateway route is refused the same way, and the batch is not marked processed. Input validation still runs first. The manual payment-recording path and the bank-file batch are unchanged. Regression tests: `connector-audit-defects.int.spec.ts`, `automated-payouts-and-reconciliation.spec.ts`.
- *Evidence:* `apps/api/src/modules/finance/payment-gateway.ts`, `disburse`, makes no network call. It generates a reference of the form `CMS` + date + mode + random hex, and returns `status: 'SUCCESS'`. `finance-service.ts` around lines 1120–1160 calls it, then `recordPayoutPayment`, which posts the settlement journal (fixed accounts 2100 and 1010). The route is `finance/router.ts` line 663, `POST /v1/payout-requests/:id/disburse-gateway`. It requires `payout.disburse` and step-up, and the record step requires `payout.record_payment`.
- *Impact:* a user with both permissions can mark any APPROVED payout as paid, with a reference the system invented, and the ledger shows a settlement that never happened. Partners are shown as paid for money that did not move.
- *Reproduction:* `connector-audit-defects.int.spec.ts`, AUD-P0-02. Observed HTTP 200, status PAYMENT_RECORDED, reference `CMS…IMPS…`.
- *Fix:* remove the route, or put it behind a disabled flag until a real bank integration exists. Do not record a payment without a bank acknowledgement.
- *Dependencies:* finance decision on existing records (section 16).
- *Test needed:* the AUD-P0-02 case, with the marker removed. A test that the route is unavailable by default.
- *Check on hosted (owner, read-only):* list `payout_request` rows with status PAYMENT_RECORDED whose payment reference starts with `CMS`. Any such row is a fabricated payment until a bank statement proves otherwise.

**AUD-P0-03: a signing key is written in the source.**
- *Status (after the approved fix, uncommitted):* partly fixed. The literal was in the gateway code that is now refused, and it has been removed from the source. **Not fixed:** the value remains in git history and may have been used by something outside this repository. Rotation is required before release (remediation plan, Step 1). The value is not printed or reused in any document.
- *Evidence:* `payment-gateway.ts`, the HMAC used for the bank acknowledgement, is keyed with a literal string in the source. The value is not reproduced in this report.
- *Impact:* anyone with repository access, including its history, can forge the acknowledgement signature. Treat the key as exposed.
- *Fix:* remove the literal. Load any key from the environment. Rotate the key wherever it was used, after the gateway is fixed.
- *Dependencies:* AUD-P0-02.
- *Test needed:* a test that the module refuses to start without the environment key.

### P1

**AUD-P1-01: the consent OTP is never delivered.**
- *Evidence:* `finance/connector-portal.ts` around line 176 writes `consent.otp_requested` to `outbox_event`. `crm/notifications/event-subscriber.ts` handles only `lead.assigned`, `task.created` and `application.assigned` (lines 21–31). No messaging code reads `outbox_event`. A search of the API found no consumer of `consent.otp_requested`.
- *Impact:* a partner can request a consent code, but the customer never receives it. Referral submission cannot complete for a real customer.
- *Reproduction:* static. The tests in `connector-portal.int.spec.ts` assert the outbox row, not delivery.
- *Fix:* add a consumer that sends the code through the messaging channel, with the code never stored in the event.
- *Test needed:* an end-to-end test with a messaging double that receives the code and the referral completes.

**AUD-P1-02: payouts are not tied to an approved bank account.**
- *Evidence:* the partner payout route (`connector-portal.ts`, around line 347) does not read `connector_bank_account`. A search of the finance code finds no reader of that table. The settlement journal uses fixed accounts.
- *Impact:* a payout can be requested for a connector with no approved bank account. There is no record of which account was paid.
- *Fix:* require an ACTIVE, approved account at request time, and store the account reference on the payout.
- *Dependencies:* the bank-account lifecycle (AUD-P2-02) and the payment decision (AUD-P0-02).
- *Test needed:* request refused without an approved account. Payout record carries the account reference.

**AUD-P1-03: the consent subject is not checked against the verified subject.**
- *Evidence:* `verification-service.ts` (around lines 60–100) reads the consent record by id, tenant, status, purpose and expiry. It does not compare `purpose_target` or any subject with `subject_id`. The decision document records this as a related finding.
- *Impact:* a verification of one person can cite the consent of another. This is a compliance defect for customers as well as connectors.
- *Fix:* require the consent record's subject to equal the verified subject.
- *Dependencies:* compliance review (section 12).
- *Test needed:* a verification citing another subject's consent is refused.

**AUD-P1-04: leads can be attributed to suspended, terminated or pending connectors.**
- *Evidence:* `crm/leads/lead-service.ts` line 365 stores `connector_id` as given. The foreign key `lead_connector_fk` checks only that the connector exists in the tenant.
- *Impact:* a new referral can be attributed to a suspended connector, and commission can accrue to it.
- *Fix:* refuse a connector that is not ACTIVE when the lead is created or reassigned.
- *Test needed:* lead creation with a suspended connector is refused.

**AUD-P1-05: attribution-dispute resolution has no segregation of duties.**
- *Evidence:* `resolveAttributionDispute` (service, around line 1832) checks `connector.dispute_resolve` only. The attribution-approval method has the requester check (line 1706). The dispute method has no comparison with the person who raised the dispute.
- *Impact:* the person who raised a dispute can resolve it.
- *Fix:* refuse resolution by the person who raised the dispute.
- *Test needed:* the raiser cannot resolve their own dispute. Confirm with a test first, since the raiser field is `created_by`.

**AUD-P1-06: connector agreements are not linked to commission rules.**
- *Evidence:* the rate card is read from `connector_agreement` (`connector-portal.ts` around line 326). `connector_agreement` has no reference to a rule set. Commission is calculated in `commission_calculation` from `rule_set_version`. No code reads `connector_agreement` for commission.
- *Impact:* the partner's rate card and the commission applied can differ.
- *Fix:* decide the source of truth, then link agreements to rule-set versions, or have the rate card show the rule set's rate.
- *Dependencies:* business decision (section 12).
- *Test needed:* the rate card matches the rate used for a sample commission.

**AUD-P1-07: connector verification cannot be recorded (business blocker, not a code defect).**
- *Evidence:* `verification-service.ts` refuses `CONNECTOR` as a subject, and `consent_record.subject_type` does not include `CONNECTOR`.
- *Impact:* no connector can be activated through the approved path.
- *Fix:* a compliance decision (section 12). Not a code change until it is made.

**AUD-P1-08: connector approvals do not require step-up authentication.**
- *Evidence:* `approveBankAccount`, `approveAttributionChangeRequest`, `resolveAttributionDispute` and `updateConnectorStatus` do not call `requireStepUp`. Payout routes do.
- *Impact:* a session that has not re-authenticated can approve bank changes and status changes.
- *Fix:* add step-up to those methods, after the policy decision.
- *Test needed:* each approval refused without a recent step-up.

**AUD-P1-09: three migration rehearsals fail on a fresh database.**
- *Evidence:* `apps/api/test/migration-sequence.int.spec.ts`, `migration-batch-partial.int.spec.ts`, `migration-batch-runbook.int.spec.ts`. Each stops while applying a migration file to a fresh database, on a foreign-key error from `role_permission` to `permission`. The 34 tests in the two batch files are skipped after that setup failure. The cause is not identified. It is not in the connector code changed in this audit.
- *Impact:* the fresh-database rebuild is not proven by these tests. The isolation harness applies the same files in order and passes, so the difference is in the rehearsal setup, not yet in a migration. It must be settled before any hosted migration is approved.
- *Fix:* find the statement that inserts the grant before its permission exists. Then correct the migration order or the rehearsal fixture. Do not weaken the test.

**AUD-P1-10: manual payment recording accepts a reference typed by staff.**
- *Evidence:* `finance/finance-service.ts`, `recordPayoutPayment`, is called from the manual payment route with a `paymentRef` that staff enter. Nothing checks it against a bank statement.
- *Impact:* after AUD-P0-02, this is the only way a payout becomes PAYMENT_RECORDED. A typed reference can be wrong or invented, and nothing reconciles it.
- *Fix:* decide the evidence that is required (for example a bank statement line matched by reconciliation) before a payout can be marked paid. Not changed in this audit.

### P2

**AUD-P2-01: mobile is not checked for duplicates on connector creation.** `connector_mobile_idx` is a non-unique index. PAN and e-mail are checked. Fix: add a mobile duplicate check on the same basis as PAN.

**AUD-P2-02: bank accounts have no rejection path, no primary account, and no separate change history.** Only approve and disable exist. Fix: add a reject state that is audited, a primary-account rule, and a change history table if the business needs one.

**AUD-P2-03: agreements have no overlap check.** The portal picks the latest `valid_from`. Fix: refuse overlapping validity for the same connector and product.

**AUD-P2-04: partners have no profile view or update.** The brief requires it. Fix after the profile decision.

**AUD-P2-05: connector scope is enforced in application code, not the database.** Row-level security checks the tenant only. Fix: add a connector-scoped policy for partner sessions, as defence in depth.

**AUD-P2-06: signed document links are bearer links.** A valid token serves the file without a login. Fix: review lifetime and single use, and log access.

### P3

**AUD-P3-01: `GET /portal/v1/eligibility` is missing from `openapi/openapi.yaml`.**

**AUD-P3-02: consent-OTP sends are not audited.** Fix: add an audit event with no code in it.

**AUD-P3-03: no partner-facing recent-activity feed.** Business decision.

**AUD-P3-04: no dispute evidence attachments.** Business decision (section 12).

**AUD-P3-05: documents that describe the connector lifecycle are wrong.** `CONNECTOR_VERIFICATION_DECISION.md` and `CONNECTOR_INVITATION_LIFECYCLE_FIX.md` state that activation of a non-ACTIVE connector is refused. That is true only for the activation route (section 14).

## 14. Existing defects fixed during this audit, and corrections to earlier documents

- **Fixed (this session):** `connector-portal-users` shared cache key with two response shapes. The Overview and Portal Access tabs now share `connectorPortalUsersQuery`. Regression spec: `connector-portal-users-query.spec.ts`.
- **Correction needed:** `docs/CONNECTOR_VERIFICATION_DECISION.md`, status section: "Connector activation for a connector that is not already ACTIVE is refused, and no connector verification can be recorded. … The feature is off." Activation is refused by the activation route. The status route accepts ACTIVE (AUD-P0-01), so the feature is not off. A correction note was added to that document alongside this report.
- **Correction needed:** `docs/CONNECTOR_INVITATION_LIFECYCLE_FIX.md`, end-to-end table, step 4: "Activation of a connector that is not ACTIVE is refused." The same qualification applies.
- **Not a defect:** the brief refers to Next.js and Prisma. Neither is used.

## 15. Missing features

- Partner profile view and update (AUD-P2-04).
- Partner recent-activity feed (AUD-P3-03).
- Bank-account rejection, primary account and change history (AUD-P2-02).
- Agreement overlap guard (AUD-P2-03).
- Referral dispute categories (section 12).
- Dispute evidence attachments (AUD-P3-04).
- Connector consent capture API (section 12, Option A).
- A real payment integration for payouts (AUD-P0-02 and section 12).

## 16. Deployment readiness

**Not ready for production release.**

- **Blocking:** AUD-P0-01, AUD-P0-02, AUD-P0-03. The status route and the gateway route must be disabled or fixed before any deployment that includes this code, including the Render API.
- **Blocking, finance:** existing PAYMENT_RECORDED payouts with service-generated references must be reviewed against bank statements. This needs the finance owner and read-only access to the hosted database. This audit did not access it.
- **Blocking, compliance:** the connector-verification decision (section 12). Connector activation stays impossible until it is made.
- **Hosted migrations 0098–0102:** the state on hosted is not verified. Each must be checked read-only before any hosted action.
- **Carry-over:** F1 credential rotation (administrator). The gateway key (AUD-P0-03) must be rotated.
- **Frontend:** the Vercel deployment must be rebuilt from the fixed code. The eligibility endpoint and the page changes are not live until then.

## 17. Git status

- **Branch:** `beta`. **Last commit:** `cbc3114` (pushed to `origin/beta`).
- **Uncommitted (working tree, all of it):**
  - Approved fix, AUD-P0-01: `packages/contracts/src/connector.ts`, `apps/api/src/modules/origination/connectors/router.ts`, `apps/web/src/features/connectors/ConnectorPage.tsx`, `openapi/openapi.yaml`, `apps/api/test/connectors.spec.ts`.
  - Approved fix, AUD-P0-02: `apps/api/src/modules/finance/payment-gateway.ts`, `apps/api/src/modules/finance/finance-service.ts` (comment only), `apps/api/test/automated-payouts-and-reconciliation.spec.ts`.
  - Separate root typecheck fix: `apps/api/src/modules/finance/connector-portal.ts` (the `req.log` line removed).
  - Earlier session work, not yet committed: `apps/web/src/features/connectors/ConnectorOverviewTab.tsx`, `ConnectorPortalUsers.tsx` (shared portal-users query), `activation-verification.ts` and its spec, `connector-portal-users-query.spec.ts`.
  - Regression tests: `apps/api/test/connector-audit-defects.int.spec.ts` (new).
  - Documents: `docs/CONNECTOR_COMPREHENSIVE_AUDIT.md` and `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md` (new), `docs/CONNECTOR_VERIFICATION_DECISION.md` and `docs/CONNECTOR_INVITATION_LIFECYCLE_FIX.md` (correction notes).
- **Not committed or pushed.** Commit and push require approval, and the root typecheck fix should be committed as its own change.

## 18. Final recommendation

Fix in this order:
1. **Today:** disable the ACTIVE target on the status route and the ACTIVE option in the dialog (AUD-P0-01). Disable the gateway route (AUD-P0-02). Remove the signing-key literal and plan its rotation (AUD-P0-03). These are safety changes, but they change behaviour, so they need owner approval.
2. **Then:** the finance review of fabricated payments, read-only on hosted.
3. **Then:** the P1 items in the order given in the remediation plan.
4. **Only after the above:** decide the compliance options in section 12, then build the chosen one.

The first thing to fix is AUD-P0-01. It is the only route that activates a connector without the compliance gate, and it is reachable by any user with `connector.manage`.
