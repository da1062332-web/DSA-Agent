# Day 1 security hardening report (2026-11-06)

**Status:** local verification complete. Nothing has been committed or pushed in this round (the earlier containment commits `682d581`, `3886469`, `b9b655e`, `10adf46`, `ac656cf` were pushed before this round). The hosted database was not queried or written, and nothing was deployed.

Written for: the developer lead, the security owner, the finance owner and the compliance owner.

## 1. Executive summary

Investigated the connector identity boundary, the commission plan approval flow, the financial step-up gate and connector activation, against the current code and a local, guarded test database. Verified each finding in the code before changing anything.

Fixed in this round:

- **Commission plans could be activated without approval.** `PATCH` and create accepted `status: ACTIVE`, and an ACTIVE plan could be edited. Approval could also act on a plan in any state. Edit and approval were not audited.
- **Connector activation accepted an expired verification.** A `VERIFIED` record whose validity had run out still activated the connector.

Fixed earlier this session, and pushed: a connector portal login no longer carries internal grants or shows role codes.

Confirmed correct and pinned by tests: the internal-API gate for connector logins, the refusal of any role for a connector login, activation only through a matching `VERIFIED` record, the step-up gate on the 19 financial approval and payment routes, and tenant isolation on the commission routes.

Not changed, and needing an owner decision before any build: the financial routes that the containment report (section 5.7) classes as P1 or P2 (section 5.2 below).

## 2. Security findings

| ID | Finding | Severity | Root cause | Fix | Status |
|---|---|---|---|---|---|
| F-01 | A connector login could carry the grants of an open internal role, and `GET /v1/me` showed its role codes | High | The permission loader read role rows for every user type. `/v1/me` queried roles without a user-type check | Connector logins get no grants; `/v1/me` returns no roles for them | Fixed (`682d581`, pushed). `TEST-CONCONTAIN-001` to `004`, `TEST-CONCONTAIN-INT-01`, `-02` |
| F-02 | Hosted residual RM assignment on a connector login (the incident) | High | Written before the guard existed; source is not recorded | Application-side containment in place. Hosted row is an owner action | **Open: owner action.** See section 7 |
| F-03 | `PATCH /v1/commission-plans/:id` accepts `status: ACTIVE` and writes it | Critical | Schema accepted `status`; service and repository wrote it with `COALESCE` and no state check | `status` refused on PATCH and on create (422, `USE_APPROVAL_ROUTE`). Repository no longer writes `status` | Fixed. `TEST-COMSTATE-003`, `-004`, `-006`; `TEST-COMAPPR-INT-01` |
| F-04 | An ACTIVE plan's terms could be changed with no re-approval | High | No state check on update | Edit allowed only for `DRAFT` (409 `INVALID_STATE`); repository write conditioned on `status = 'DRAFT'` | Fixed. `TEST-COMSTATE-005`; `TEST-COMAPPR-INT-05` |
| F-05 | Approval acted on a plan in any state, including ACTIVE and RETIRED | High | Repository set `ACTIVE` unconditionally | Approval only from `DRAFT` or `PENDING_APPROVAL`; repository condition added | Fixed. `TEST-COMSTATE-009` |
| F-06 | Commission plan edits and approvals wrote no audit record | Medium | No `audit.record` call on update or approve | `commission_plan.updated` (before and after the status, basis and qualifying event) and `commission_plan.approved` (permission used) | Fixed. `TEST-COMSTATE-002`, `-007`; `TEST-COMAPPR-INT-02`, `-04` |
| F-07 | Connector activation accepted a `VERIFIED` record whose `validity_expires_at` had passed | Medium | The check ignored `validity_expires_at` | Expired records refused (422 `VERIFICATION_EXPIRED`). Applies to connector bank-account verifications too, which take the same check | Fixed, fail-closed. `TEST-CVER-09` (fails on the old code). **Compliance to confirm the rule** |
| F-08 | Financial routes with no step-up that the containment report rates P0 to P2 | High to Medium | Not gated at the time of the containment review | None in this round | **Open: needs owner approval.** Section 5.2 |
| F-09 | The kernel's step-up check skips when the raw `DISABLE_MFA` variable is `true`, without the local-only check | Low (residual) | `requireStepUp` reads the environment directly. The configuration loader refuses `DISABLE_MFA` outside a local stack | None | Documented. **Security owner to decide** whether the kernel should use the same guard |
| F-10 | A second ACTIVE plan for the same lender is refused by the database (`uq_active_lender_plan`), and the approval route reports it as `INVALID_STATE` with `UNIQUE_VIOLATION` | Low | There is no retire-and-replace path | None | **Owner decision** (finance). Section 7 |

Not a finding: cross-tenant access to commission plans. The old code already filtered every query by tenant, so a foreign plan returned a version conflict and no data. The new code returns `NOT_FOUND`, and the tests pin that.

## 3. Connector security

**3.1 Identity boundary.** A connector portal login is an `app_user` with `user_type = 'CONNECTOR'` and a `connector_id`. The principal resolver puts the user type on the principal, so a request cannot choose it. The portal derives the connector on the server from the login row (`portal-standing.ts`, `standing()`): it must be `ACTIVE`, linked to an `ACTIVE` connector in the same tenant. Nothing in the request selects the connector.

**3.2 Role restrictions.** A connector login cannot receive any role, internal or otherwise:
- The API refuses it on role assignment, role replacement and invitation (`role-guards.ts`, `assertRoleAllowedForUserType`, called from `platform/router.ts` and `user-lifecycle.ts`). Unit tests cover `ROLE-RM`, `ROLE-TENANT-ADMIN` and `ROLE-FINANCE-EXEC` (`connector-role-guard.spec.ts`). Database tests in `connector-role-guard.int.spec.ts` (14 tests) pass.
- Migration 0097 refuses it in the database for every writer. No migration was added or changed in this round. The hosted apply of 0097 is an open owner item (section 7).
- No API path changes a user's type after creation.

**3.3 Portal and internal separation.** The internal API (`/v1`, `/platform/v1`) refuses any connector login, except `GET /me` and `GET /v1/me`, which return only the caller's own profile. Verified over HTTP against the real database (`connector-identity.int.spec.ts`):
- `TEST-CONIDENT-INT-06`: the portal login is refused `/v1/leads`, `/v1/applications`, `/v1/commission-plans` and `/platform/v1/users`, each with `CONNECTOR_IDENTITY_NOT_ALLOWED`.
- `TEST-CONCONTAIN-INT-03`: refused `/v1/connectors` even when an open RM row exists.
- `TEST-CONIDENT-INT-04`: the same login reaches its own `/portal/v1/referrals`.

**3.4 Activation and verification.** A connector becomes `ACTIVE` only through `POST /v1/connectors/:id/activation`. That route accepts a verification only if all of these hold (`assertConnectorVerification`):
- the record exists in the same tenant;
- its subject is a `CONNECTOR`, and it is this connector;
- its result is `VERIFIED`;
- it has not expired (new in this round).

Generic status changes refuse `ACTIVE` in the router (`USE_ACTIVATION_ROUTE`) and in the schema (`UpdateConnectorStatusSchema` accepts only `SUSPENDED` and `TERMINATED`). The connector update schema has no `status` field.

Tests (`connector-verification.int.spec.ts`, 10 of 10 pass):
- correct connector and `VERIFIED` → activated (`CVER-01`);
- a verification of another connector → refused (`CVER-02`);
- a verification of a customer → refused (`CVER-03`);
- `REJECTED` → refused (`CVER-04`);
- no verification → refused (`CVER-05`);
- a `VERIFIED` record that has expired → refused (`CVER-09`);
- a generic `ACTIVE` status change → refused (`CVER-10`).

**3.5 Isolation test results (Day 1 run):**

| Requirement | Result | Test |
|---|---|---|
| Connector → own portal data | Allowed | `CONIDENT-INT-04`; `connector-portal.int.spec.ts` |
| Connector → another connector's portal data | Denied | `TEST-ACC-PORTAL-03`, `-05`; `TEST-CPT-DSP-03` (in the 14-file run, pass) |
| Connector → internal staff route | Denied | `CONIDENT-INT-06`; `CONCONTAIN-INT-03` |
| Internal employee → permitted internal route | Allowed | `CONIDENT-INT-07` (`GET /v1/leads`, `lead.read`) |
| Tenant A portal login presented with a tenant B token | Denied (401) | `CONIDENT-INT-08` |
| Tenant B user → tenant A's commission plan (read, edit, approve) | Denied (404), plan unchanged | `COMAPPR-INT-06` |

## 4. Commission security

**4.1 Lifecycle after this round**

| From | Action | Who | Result |
|---|---|---|---|
| (none) | create | `commission.plan.edit` | `DRAFT` only. Any other `status` → 422 |
| `DRAFT` | edit terms | `commission.plan.edit` | Allowed, audited. `status` in the body → 422 |
| not `DRAFT` | edit terms | any | 409 `INVALID_STATE` |
| `DRAFT` or `PENDING_APPROVAL` | approve | `commission.plan.approve`, not the creator (SOD-02), fresh second factor | `ACTIVE`, audited |
| `ACTIVE` or `RETIRED` | approve | any | 409 `INVALID_STATE` |
| any | stale `If-Match` | any | 409 `VERSION_CONFLICT` |

`RETIRED` has no route now. Before, a `PATCH` could set it with no control. Retirement needs a decision (section 7).

**4.2 Step-up.** The approval route requires a fresh second factor (`requireFinancialStepUp`, which runs before any state change). Create and edit do not require step-up. They do not move money, and the containment report does not list them for step-up. This was not added.

**4.3 Audit.** Create (existing), edit (`commission_plan.updated`, new) and approval (`commission_plan.approved`, new). Audit rows carry only status, basis and qualifying event, and no personal data.

**4.4 Tests:**
- `commission-plan-state.spec.ts`: 12 of 12 pass. Eight of them fail on the old service and repository (`002` to `007`, `009`, `011`). The other four cover behaviour that was already correct.
- `commission-plan-approval.int.spec.ts` (database, HTTP): 6 of 6 pass.

**4.5 API contract.** The request schema is unchanged, so the OpenAPI document is unchanged by this round. `status` is still listed as an accepted field, and the service now refuses it. The web app never sends `status` on a plan write (checked: `apps/web/src/features/commission/api.ts`, and the approve button appears only for `DRAFT` plans). The `@deprecated` marker and the contracts change log are not done (section 7).

## 5. Financial step-up

**5.1 Mechanism (reviewed, unchanged).** `requireFinancialStepUp` refuses whenever the project has no second factor (`SUPABASE_MFA_ENABLED=false`), with `PROJECT_SECOND_FACTOR_OFF`. Otherwise the kernel requires a token MFA time within 900 seconds (`TEST-ACL-104-05`). The check reads only the server-built principal, so no request parameter can satisfy it. `TEST-FSU-01` to `-03` cover the project-off refusal and the fall-through. `TEST-COMAPPR-INT-03` and `-04` cover the approval route with and without a fresh second factor.

**5.2 Route coverage matrix.** Method used: every route declaration in every `router.ts` and the connector portal, with each `requireFinancialStepUp` call attributed to the route it sits in. Each gated route was checked to run the gate before its transaction or service call.

Gated (19):

| Route | Financial impact | Current protection | Expected protection | Gap | Action |
|---|---|---|---|---|---|
| `POST /commission-plans/:id/approval` | Activates a commission plan | Permission, fresh step-up, SOD | Same, plus state check | None | Tested (this round) |
| `POST /clawbacks/:id/approval`, `/rejection` | Decides a clawback | Step-up | Step-up | None | None |
| `POST /recalculation-proposals/:id/approval` | Decides recalculated payables | Step-up | Step-up | None | None |
| `POST /payout-requests/:id/approval` | Approves a payout | Step-up | Step-up | None | None |
| `POST /payout-requests/:id/payment`, `/payment-failure` | Records payment | Step-up | Step-up | None | None |
| `POST /payout-batches`, `GET /payout-batches/:id/bank-file` | Creates a batch and releases a bank file | Step-up | Step-up | None | None |
| `POST /payout-requests/:id/disburse-gateway`, `POST /payout-batches/:id/dispatch-gateway` | Sends money | Step-up | Step-up (gateway disabled per AUD-P0-02) | None | None |
| `POST /reconciliation-exceptions/:id/resolution` | Resolves a reconciliation exception | Step-up | Step-up | None | None |
| `POST /adjustments/:id/approval` | Approves a ledger adjustment | Step-up | Step-up | None | None |
| `PATCH /disputes/:id` | Changes a payout dispute | Step-up | Step-up | None | None |
| `POST /reconciliation/payouts/:id/bank-reconcile` | Marks a payout reconciled | Step-up | Step-up | None | None |
| `POST /connectors/:id/bank-accounts/:accountId/approval` | Approves where a connector's payout goes | Permission, step-up | Step-up | None | None |
| `POST /attribution-change-requests/:id/approval` | Changes which RM owns a connector | Permission, step-up | Step-up | None | None |
| `POST /attribution-disputes/:id/resolution` | Resolves an attribution dispute | Permission, step-up | Step-up | None | None |
| `POST /payout-requests` (connector portal) | Connector requests a payout | Step-up | Step-up | None | None |

Note: the containment report (section 5.2) counts 19. This matrix lists 19 as well, once the connector bank-account POST is read correctly (it has no gate, see below).

Ungated, money-related (not changed; each needs owner approval before it is built, per the containment report, section 5.7):

| Route | Impact | Containment priority | Gap | Action |
|---|---|---|---|---|
| `POST /commission/calculate` | Creates commission calculations and payables | P1 | Permission includes `finance.view` | Owner approval (A-FIN): remove `finance.view` |
| `POST /ledger/accounts` | Creates chart-of-accounts entries | P1 | Read permission creates accounts | Owner approval (A-FIN, A-SEC) |
| `POST /ledger/periods/:period/close` | Closes an accounting period | P1 | One holder, no step-up, no second approver | Owner approval (A-FIN, A-SEC) |
| `POST /invoices/:id/status` (pay, void) | Changes money state | P1 | No step-up, no separation of duties | Owner approval (A-FIN) |
| `POST /connectors/:id/activation` | Activates a connector | P1 | No step-up; activator not compared with verifier | Owner approval (A-COMP, A-SEC) |
| `POST /connectors/:id/status` (suspend, terminate) | Stops referrals and earnings | P1 | No step-up | Owner approval (A-SEC) |
| `POST /ledger/exports` | Record-level export | P2 | No step-up | Owner approval (A-SEC) |
| `POST /connectors/:id/agreements` | Decides which referrals a connector may send | P2 | No step-up or separation of duties | Owner approval (A-COMP) |
| `POST /connectors/:id/users/:userId/access` | Grants a partner user access | P2 | No step-up | Owner approval (A-SEC) |
| `POST /lender-statements/:id/match` | Matches statement lines | P2 | Whether it settles payables is unverified | Verify, then decide (A-FIN) |
| `POST /clawbacks`, `POST /recalculation-proposals` | Creates requests (approval is gated) | P2 | Separation of duties at approval not re-verified | Verify (A-FIN) |
| `POST /payout-requests` (staff), `POST /payout-requests/:id/cancel` | Creates or cancels a request (payment is gated) | — | Not in the containment list | None |

Also ungated and not money-moving, so not in the matrix: product and lender-case status changes, branch and user deactivation, config exports, lender-statement upload.

**5.3 Changes to gating in this round:** none. No route gained or lost a gate.

## 6. Testing evidence

Commands run from the repository root unless noted. Integration and isolation suites use Testcontainers through the guarded configs (`vitest.int.config.ts`, `tests/isolation`). Docker Desktop was started for the run.

| Check | Command | Result |
|---|---|---|
| Typecheck, all workspaces | `npm run typecheck` | **Pass** (exit 0) |
| API unit, whole suite | `npm run test -w @dsa/api` | **Pass**: 102 files, 1,500 tests |
| Commission lifecycle (unit) | `npx vitest run test/commission-plan-state.spec.ts` (in `apps/api`) | **Pass**: 12 of 12 |
| Commission approval (database, HTTP) | `npm run test:int -- test/commission-plan-approval.int.spec.ts` | **Pass**: 6 of 6 |
| Connector identity (database, HTTP) | `npm run test:int -- test/connector-identity.int.spec.ts` | **Pass**: 8 of 8 |
| Connector verification (database) | `npm run test:int -- test/connector-verification.int.spec.ts` | **Pass**: 10 of 10 |
| Connector, commission and permission integration (14 files) | `npm run test:int -- <14 files>` in `apps/api` | **Pass**: 138 tests |
| Tenant isolation sweep | `npm run test:isolation` | **Pass**: 18 files, 549 tests |
| Kernel unit | `npm run test -w @dsa/kernel` | **Pass**: 5 files, 35 tests (no kernel change in this round) |
| API build | `npm run build -w @dsa/api` | **Pass** (exit 0) |
| Web build | `npm run build:web` | **Pass** (exit 0) |
| Lint, changed files | `npx eslint <changed files>` | **0 errors.** 46 warnings, the same count per file as at HEAD |
| Lint, repository | `npm run lint` | 958 problems (1 error, 957 warnings). Unchanged from baseline. The error is `no-empty` in `e2e/helpers/mock-session.ts`, which predates this round |
| Format, changed files | `npx prettier --check <changed files>` | Passes, except `packages/kernel/src/auth/resolve-principal.ts` and its spec, which were already unformatted at HEAD. Not reformatted, to avoid unrelated churn |
| Migration immutability | `npm run check:migrations -w @dsa/tools` | **Pass**: 92 files unchanged (no migration changed) |
| OpenAPI | `npm run gen:openapi` then diff | Differs from the committed file in two known ways: date defaults that change on each run, and the missing `/portal/v1/eligibility` path. Both predate this round (plan items CI-03 and CI-04). The regenerated file was discarded; no schema changed |
| Regression tests fail on the old code | Old `finance-service.ts`/`repository.ts` restored temporarily | `COMSTATE`: 8 of 12 fail. Old `connector-service.ts` restored temporarily: `CVER-09` fails (activated with an expired record) |
| E2E | Not run | See the reason below |

**E2E: NOT RUN.** Reason: the Playwright config starts only the web dev server and expects an API on `localhost:3000` that someone must start by hand. Nothing in the e2e setup proves which database that API would use, and the e2e suite has no database guard. The prompt requires that E2E run only when its environment is proven safe, so it was not run.

Dependency audit (`npm audit --omit=dev`): 8 advisories (4 high, 4 moderate), the same as the baseline. No dependency changed in this round.

## 7. Remaining owner decisions

These are the items that need a decision or a hosted action. Nothing else in Day 1 is open.

1. **Hosted connector containment (F-02), security and operations owners.** Run the read-only post-check (`tools/sql/remediation/connector-containment.post-check.sql`) and `tools/sql/batch/97.verify.sql`, and record the output. The records disagree on whether the RM row was ended and whether 0097 is applied. Open question C4 (are `Farhan Finance` and `Farhan Finance (Partner)` the same person?) is not recorded anywhere in the repository.
2. **Financial routes in section 5.2 (F-08), finance, security and compliance owners.** Each needs written approval before it is built. Recommended order: the containment report's order, P1 first. Nothing was built without approval.
3. **Retirement of a commission plan (section 4.1), finance owner.** There is no controlled route to `RETIRED` now. Decide the route and who may use it.
4. **Replacing an active plan for a lender (F-10), finance owner.** The database allows one ACTIVE plan per lender. Decide whether approval should retire the current plan, or whether replacement stays a separate step.
5. **Verification expiry (F-07), compliance owner.** The fix refuses expired `VERIFIED` records for connector activation and connector bank accounts. The field was stored but never enforced anywhere. Confirm this is the intended rule. If not, revert the check in `connector-service.ts` and its test `CVER-09`.
6. **Deprecating the commission `status` field (SEC-01 steps 1 and 5), contracts owners.** The field is still in the schema and the OpenAPI document, and the service refuses it. Marking it `@deprecated`, regenerating the OpenAPI document and recording the change in the contracts change log needs approval (A-CON).
7. **Kernel `DISABLE_MFA` path (F-09), security owner.** Decide whether the kernel should use the same local-only guard as the API.
8. **OpenAPI determinism and the missing eligibility path (CI-03, CI-04).** Pre-existing; planned in the fix plan.

## 8. Review of changed files (bypass check)

- **Other writers of commission plan status:** none outside `finance/repository.ts` (searched `apps/api/src` and `tools`). The only route that reaches approval is `POST /commission-plans/:id/approval`.
- **Other routes that could make a connector ACTIVE:** none. The status schema refuses `ACTIVE`. The other `ACTIVE` writes in `connector-service.ts` are for bank accounts and agreements.
- **Tenant isolation:** the tenant comes from the token. Every commission query filters by `tenant_id`, and the database enforces row-level security.
- **Audit:** preserved, and extended to edit and approval. No secret or personal value is written to a log or an audit row.
- **Migrations:** none required.
- **API contract:** the same request schema. `PATCH` and create now refuse `status` with 422. The web app does not send it. Connector bank-account verifications are also refused when expired (a behaviour change, noted in section 7).

## 9. Acceptance criteria (Day 1)

| Criterion | Status | Evidence |
|---|---|---|
| Connector portal identities cannot hold internal roles | Met in code and in the local database. Hosted state not verified | §3.2; `connector-role-guard` tests; 0097 |
| Internal staff routes reject connector principals | Met | §3.3 |
| Cross-tenant access denied | Met | `CONIDENT-INT-08`; `COMAPPR-INT-06`; isolation sweep |
| Cross-connector access denied | Met (existing tests, passing) | §3.5 |
| Connector activation cannot bypass verification | Met | §3.4; `CVER-01` to `-10` |
| Verification must belong to the exact connector | Met | `CVER-02`, `-03`, `-09` |
| Direct `status=ACTIVE` cannot bypass approval | Met | `COMSTATE-003`, `-006`; `COMAPPR-INT-01` |
| Correct approval workflow still works | Met | `COMSTATE-007`; `COMAPPR-INT-04` |
| Unauthorised state transitions rejected | Met | `COMSTATE-005`, `-009`, `-010` |
| Financial step-up enforced where required | Met for the 19 gated routes. P1 and P2 routes in §5.2 remain ungated pending approval | §5 |
| Commission cross-tenant access rejected | Met | `COMSTATE-011`; `COMAPPR-INT-06` |
| Audit behaviour preserved | Met, and extended | §4.3 |
| Existing step-up implementation reviewed | Met | §5.1 |
| No unsafe MFA or step-up bypass in the affected flows | Met, with F-09 documented as a residual | §2, §5 |
| Intentional exemptions documented | Met | §5.2 |
| Typecheck, relevant tests, isolation | Met | §6 |
| No new unexplained failures | Met. Lint and OpenAPI differences are pre-existing | §6 |
| E2E run only when safe | Not run, as required | §6 |

## 10. Files changed in this round (uncommitted)

- `apps/api/src/modules/finance/finance-service.ts`: commission state rules, `status` refusal, audit on edit and approval.
- `apps/api/src/modules/finance/repository.ts`: `status` removed from the edit write; conditions on the edit and approval writes.
- `apps/api/src/modules/origination/connectors/connector-service.ts`: expiry check on verification.
- `apps/api/test/commission-plan-state.spec.ts` (new): 12 unit tests.
- `apps/api/test/commission-plan-approval.int.spec.ts` (new): 6 database tests.
- `apps/api/test/connector-identity.int.spec.ts`: three more tests (`INT-06` to `-08`).
- `apps/api/test/connector-verification.int.spec.ts`: two more tests (`CVER-09`, `-10`).
- `docs/DAY1_SECURITY_REPORT_2026-11-06.md` (this file).

No migration was added or changed. No `openapi/` file is changed.

## 11. Final status

**DAY 1: COMPLETE against the acceptance criteria in §9, with two items outside this round:** the hosted connector state (F-02) and the owner decisions in §7. The P1 and P2 financial routes in §5.2 are reported, not built, as the containment report requires owner approval first.
