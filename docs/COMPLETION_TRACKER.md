# DSA CRM completion tracker

Status date: 2026-10-16. Branch `beta`. This is the one place that lists every module, defect, migration, security concern and persistence gap, with an outcome and the evidence behind it. Companion documents: `docs/MIGRATION_MATRIX.md`, `docs/CREDENTIAL_REMEDIATION.md`, `docs/HOSTED_TEST_RESIDUE.md`, `tools/sql/0054/README.md`, `DEFERRED_MODULES_TRACKING.md`, `docs/PENDING_APPROVALS.md`.

## 1. How to read it

**Outcomes** (every row has exactly one):

- **DONE**: implemented and verified against its acceptance behaviour, with evidence below. DONE never means "applied to hosted" unless it says so.
- **READY FOR HOSTED APPROVAL**: implemented and rehearsed on throwaway PostgreSQL 16 and 17; the exact hosted steps exist; nothing has been written to hosted.
- **BLOCKED ON DECISION**: all safe work is finished; the question and its impact are in section 7.
- **DEFERRED (SCOPE)**: the approved release decision is kept (Release 2 or 3). No partial promotion.

**Evidence levels** used in the table:

- **E1**: the owner's unit and route tests pass in this round's full run (not re-derived from the Notion acceptance criteria by me).
- **E2**: integration tests against a throwaway PostgreSQL 16 and 17 container (real migrations, the real `dsa_api` role, real row-level security).
- **E3**: a restart test: the real server process is started, killed and started again against one database.
- **E4**: verified on the hosted project (read-only checks, or a live sign-in).

The module list, owners and the statuses in the Notion ownership page (fetched 2026-10-15) are the source of the first columns. Where Notion says "Completed" and the release plan says "Deferred", both are shown.

## 2. What changed in this round (summary)

Security and test isolation: `DISABLE_MFA` can no longer silently switch MFA off (refused at startup unless the Supabase URL is local and the environment is not production; ignored at request time otherwise); every embedded credential removed (section 5); integration and isolation suites fail closed (cannot reach hosted, prove their database is the throwaway container). Defects fixed: role removal, role edit and delete, last-administrator and platform-permission guards, audit for privileged actions, step-up on role edit (API-ACL-004), production wiring of `lenderPort`, the incident audit action names, the health report that said "UP" when the database was down, the release register that showed unchecked gates as passed, and a date bomb in the sanction spec. Persistence added: API clients, feature flags, master data, release register, with restart tests. New: the data-correction executor (off by default). Migrations added: 0057 to 0062 (none applied to hosted).

## 3. The 41 modules

| # | Code | Module | Owner (Notion) | Release / scope | Outcome | Evidence and notes |
|---|---|---|---|---|---|---|
| 1 | MOD-TEN | Tenant | Vaibhav | R1; platform realm | **DONE** (hosted: E4) | Migration 0050 applied. Hosted: `verify.sql` 32/32, `verify-behaviour.sql` 57/57, `enforcement-check.mjs` 33/33; live sign-in with MFA (aal1 refused, aal2 allowed) and platform vs tenant access checked in the API and browser. E2: 19 enforcement tests + 22 realm/runbook tests. `--with-writes` check not run on hosted (by choice). |
| 2 | MOD-ORG | Organisation | Vaibhav | R1; INTAKE/UNASSIGNED/TEAM queues partial (Notion) | **DONE** | E1/E2: `platform-config` 18, `platform` 5, `platform.int` 7; isolation cases. A duplicate branch code is a 422 field error (TEST-CFG-005); `TEST-ORG-INT-01` expected 409 and was updated. Queue list API and admin API are TASK-435/412 in Notion. |
| 3 | MOD-AUTH | Authentication | Vaibhav | R1 | **DONE** (partly E4) | E1/E2: `mfa-enforcement` 6, `mfa-switch` 10 (new), `supabase-auth` 4, `mfa.int` 3, web auth specs. Live: platform superadmin and a tenant admin signed in on hosted. `/v1/me` cache and sign-out covered by web specs. |
| 4 | MOD-USR | Users | Akash | R1 | **READY FOR HOSTED APPROVAL** | E1/E2: `platform-users` 9, `role-assignment-end` 8, `role-management` 10. Fixed: removing a role from a user (409 for everyone: `dsa_app` could not DELETE) now ends the assignment (0057); status change refuses to suspend the last administrator; audit `user.status_changed`. Needs 0057 on hosted. |
| 5 | MOD-ACL | Access control | Akash | R1; access reviews R3 (SUB-ACL.04) | **READY FOR HOSTED APPROVAL** | E1/E2: `platform-access-control` 26 + `role-management` 10 + `permission-catalogue` 4. Role edit and delete fixed (0059): system roles immutable, assigned roles kept, an editor can only grant what they hold, platform permissions refused for customer roles, last-administrator guard, audit, step-up on edit (spec API-ACL-004), web uses the step-up client. Needs 0054, 0057, 0059, 0060. |
| 6 | MOD-CFG | Configuration | Akash | R1 | **DONE** | E1/E2: `platform-config` 18; web `configuration`. No change this round. |
| 7 | MOD-LEAD | Leads | Samarth | R1 | **DONE** | E1/E2: `leads` 33, `leads.pg.int` 5 (now on the throwaway database); isolation. `lead.reopen` is now a defined permission (0060; falls back to `lead.update` when nobody holds it). |
| 8 | MOD-CUST | Customers | Samarth | R1 | **DONE** | E1/E2: `customers` 33, `customers.pg.int` 5. `customer.create` and `customer.update` defined before 0051 grants them. `customer.reveal_sensitive` is defined only (S3 reveal is outside the MVP). |
| 9 | MOD-TASK | Tasks and SLA | Samarth | R1 | **DONE** | E1/E2: `tasks` 34, `tasks.pg.int` 3. Date-probe (system clock set to 2027 and 2032): passes. |
| 10 | MOD-ACT | Activity | Piyush | R1 | **DONE** | E1/E2: `activities` 15, `activities-live-pg` 8 (synthetic lead created by the spec; no hosted row needed). |
| 11 | MOD-MSG | Messaging | Piyush | R2 deferred in Notion (TASK-415); built | **DONE** (scope note) | E1/E2: `messaging` 15, `messaging-live-pg` 11 (demo tenants and roles come from `tests/guard/fixtures`). |
| 12 | MOD-NTF | Notifications | Piyush | R1 | **DONE** | E1/E2: `notifications` 14, `notifications-live-pg` 7. |
| 13 | MOD-GRV | Grievances | Vaibhav | R1; live portal intake R2 | **DONE** | E1/E2: `grievances` 11, `grievances.int` 15. 30-day due-date default (Option B) implemented. **Fixed:** production `server.ts` never wired `lenderPort`, so every lender referral failed with 503 in a real deployment (tests injected it); now wired and covered by `server-wiring.spec.ts`. |
| 14 | MOD-LND | Lenders | Vaibhav | R1 | **DONE** | E1/E2: catalogue integration (`catalogue*.int` 26), web `lenders`. `lender.read` and `lender.manage` defined (0060, no auto-grant). |
| 15 | MOD-PRD | Products | Vaibhav | R1 | **DONE** | E1/E2: `products` 10, `products-patch` 6 + 7 int, catalogue int. `product.read` and `product.manage` defined (0060). |
| 16 | MOD-APP | Loan applications | Vaibhav | R1; withdraw/reopen R2 (TASK-433) | **DONE**; withdraw/reopen **DEFERRED (SCOPE)** | E1/E2: `applications` 7 + 11 int, `transitions` 9 + 11 int (hold behaviour included). The deferral is documented in `docs/PENDING_APPROVALS.md` and unchanged. |
| 17 | MOD-ELG | Eligibility | Vaibhav | R1 seeded, R2 authored (TASK-416) | **BLOCKED ON DECISION** (override roles) | E1/E2: `eligibility` 6 + 6 int. Migration 0048 applied on hosted. 0054 and 0055 (default rules, override grants) not applied. Decision D1. |
| 18 | MOD-LCS | Lender cases | Samarth | R1 | **DONE** | E1/E2: `lender-cases` 22, `lender-cases.pg.int` 7. |
| 19 | MOD-SND | Sanction and disbursement | Samarth | R1 | **DONE** | E1/E2: `sanctions` 15, `sanctions.pg.int` 7. **Fixed:** the spec hard-coded `validUntil: 2027-01-01` and failed from 2027; dates are now relative. Grants (now 0064; it was 0050, then 0056 until the ledger migration took 0056) have their effects on hosted (E4). |
| 20 | MOD-DOC | Documents | Vaibhav (checklist slice) | R1 checklist slice (Notion: Dev 3, checklist slice only); upload, storage, scanning, versioning, access log deferred to TASK-401; retention R3; OCR R4 | **DONE for the approved slice**; the rest **DEFERRED (SCOPE)** | SUB-DOC.02 checklist: new `GET /v1/applications/{id}/checklist` (API-APP-007, application.read, scoped like the application, completeness summary), `checklist.spec` 4, isolation `checklist.spec` 2 (404 across tenants, 403 without permission). SUB-DOC.05 interim attestation (verifier review) was already done (`verification` 27). New Documents screen at `/documents` and a Documents card on every application page; the sidebar entry is a real link; `documents.spec` 6. **Not built, by the approved scope:** document master (SUB-DOC.01), direct-to-storage upload and versions (.03/.06), malware scan (.04), view/download URLs and access log (.07). They need object storage and a scanner that do not exist (TASK-401), and the data model (`document`, `document_version`, `document_access_log`) is a Release-gated design. Customer upload today is Document sharing (module 21). |
| 21 | MOD-DSH | Document sharing | Piyush | R1 | **DONE** | E1/E2: `document-sharing` 7, live 2. |
| 22 | MOD-VER | Verification | Piyush, Akash | R1 | **DONE** | E1/E2: `verification` 27, `verifications` 4, `verification-security-live-pg` 6 (synthetic customer, application and consent created by the spec). |
| 23 | MOD-BRE | Business rule engine | Akash | R1 | **READY FOR HOSTED APPROVAL** | E1/E2: `rules` 32, `bre-core` 19, `rules-rule-index.int` 8. Rule ordering fixed in 0055 and the submit path: exactly one of `order_no` or `priority` is stored, by hit policy. Needs 0054 and 0055 on hosted. |
| 24 | MOD-WFA | Workflow automation | Akash | R1 | **DONE** | E1: `automation-*` 77. Date-probe passes for 2026 to 2032, so `TEST-WFA-TMR-001` is not date-sensitive. |
| 25 | MOD-PERF | Performance | Samarth | R1 | **DONE** | E1/E2: `targets` 17, `targets.pg.int` 6. |
| 26 | MOD-WRK | Workforce | Samarth | R1 | **DONE** | E1: `workforce` 19. Migration 0052 applied (tables present on hosted). |
| 27 | MOD-CON | Connectors | Piyush | R1 | **DONE** | E1/E2: `connectors` 12, live 3. |
| 28 | MOD-CPT | Connector portal | Samarth | R3 (SUB-CPT.01 to 04) | **DEFERRED (SCOPE)** | Navigation shows it as deferred; no partial build. `DEFERRED_MODULES_TRACKING.md`. |
| 29 | MOD-COM | Commission | Akash | R3 (TASK-418); built | **DEFERRED (SCOPE)** + defect fixed | E1: `finance` 34. **Fixed:** `commission.plan.edit` and `.approve` were checked but defined nowhere, so no one could ever hold them; defined in 0060 and **granted to no role** (R3). |
| 30 | MOD-LED | Ledger | Akash (built by Piyush on `piyush`/`beta`) | R3 | **DEFERRED (SCOPE)** | Code, UI and tests arrived with the 2026-10-16 merge (`ledger.spec`); its migration `0056_ledger_management.sql` is **not applied on hosted** (read-only check) and is not in the suggested batch. Not promoted to Release 1 or 2. **Defect found in the merge and fixed:** `0056` created `ledger_entry`, which migration 0053 (invoices, applied on hosted) already owns with a different shape, so a fresh database build failed; the ledger lines table is now `ledger_journal_line` (migration, repository, contract comment, manifest), and `tests/isolation/cases/ledger.spec.ts` proves tenant isolation for all eight ledger operations and for the tables under the real `dsa_api` role. Piyush should confirm the name. |
| 31 | MOD-PAY | Payouts | Piyush | R3 per tracking doc; built | **DEFERRED (SCOPE)** | E1/E2: payouts live 4 and finance tests. Not promoted. |
| 32 | MOD-REC | Reconciliation | Piyush | R3 per tracking doc; built | **DEFERRED (SCOPE)** | E1/E2: `reconciliation` 15, live 4. Not promoted. |
| 33 | MOD-INV | Invoices | Samarth | R1 | **DONE** | E1: `invoices` 12. Migration 0053 applied (tables present on hosted). |
| 34 | MOD-RPT | Reporting | Samarth | R1 | **DONE** | E1/E2: `reporting` 43, `reporting.pg.int` 9. |
| 35 | MOD-INT | Integrations | Piyush | R1 | **DONE** | E1: `integrations` 10. |
| 36 | MOD-API | API management | Akash | R1 | **READY FOR HOSTED APPROVAL** | E1/E2/E3: `partner-api` 36, `api-clients-persistence` 2 (real restarts), isolation 11. API clients are stored in `app.api_client`, audited (create, update, rotate, revoke; never a secret or hash), tenant-isolated. Needs 0054 on hosted: until then `/v1/api-clients` errors there. **Open (D6):** client credentials are issued and rotated but nothing authenticates with them (partner calls use API keys). |
| 37 | MOD-AUD | Audit | Akash | R1 | **DONE** | E1: `audit` 15, `audit-canonical` 4; migration 0042 applied (table present). Audit actions are now written for roles, assignments, user status, API clients, releases, executor. |
| 38 | MOD-PRV | Privacy and consent | Piyush | R1 | **DONE** | E1: `compliance` 7; web `privacy`. |
| 39 | MOD-SEC | Security | Akash (Pending in Notion) | R1 | **READY FOR HOSTED APPROVAL** | E1/E2: `security` 29, isolation; **new screen `/security`** (events and incidents tabs, filters, load more, record incident, status steps with If-Match, authority-notice recording, permission gate, error and empty states; sidebar entry for `security.incident`, hidden from platform operators): `features/security` specs 14 (model, API calls with If-Match and Idempotency-Key, page access). **Fixed earlier:** incidents wrote audit actions `CREATE`/`UPDATE`, which the audit constraint refuses; now `incident.created` / `incident.updated`. **Hosted:** neither table exists until migration 0063 (was a duplicate 0043) is applied; the screen shows the API error until then. `security.vuln` is defined and granted but nothing uses it (vulnerability management is not built). |
| 40 | MOD-ADM | Administration | Piyush | R2 (SUB-ADM.01 to 07) | **DEFERRED (SCOPE)** for the console; Module-1 parts **READY FOR HOSTED APPROVAL** | E1/E2/E3: `platform-admin` 25, flags 3, registers 4 (real restarts), executor 11. Persisted now: flags, master data, release register (gates start unverified; step-up and audit on change), health report (probes the database for real). **Still sample data, now labelled in the API and the console:** queues and dead letters (D4). Needs 0058, 0061, 0062 on hosted. |
| 41 | MOD-IMP | Import and export | Samarth | R1 | **DONE** + open defect | E1/E2: `imports` 15, `imports.pg.int` 5. **Open (D7):** the background worker polls as a fixed tenant `ten_default` that does not exist, so queued jobs for real tenants would never be claimed (nothing enqueues today). |

## 4. Defect register

**Fixed this round (with the test that proves it)**

| Defect | Where | Test |
|---|---|---|
| `DISABLE_MFA=true` could disable MFA anywhere | `http/mfa-switch.ts`, `config.ts`, web `AppLayout` | `mfa-switch.spec` 10 |
| Hard-coded database passwords, a service-role key and keys in tracked files | 14 files + 2 scripts | `no-embedded-secrets.spec` 2 (shown to fail on a planted secret) |
| Integration specs could reach hosted | guard, global setup, 9 live-pg specs | `no-hosted-db-guard.int` 8 |
| Role removal always 409 | `platform/router.ts`, migration 0057 | `role-assignment-end.int` 8 |
| Role edit and delete always 409 | migration 0059, router | `role-management.int` 10; web `api.spec` 3 |
| No last-administrator protection; platform permissions could be put in a tenant role | `role-guards.ts` | `role-management.int` 03, 08 |
| No step-up on role edit although the spec requires it | router, web | `role-management.int` 02; `access-control/api.spec` |
| A role editor could give a role permissions they did not hold (privilege escalation) | `role-guards.ts`, router | `role-management.int` 11 |
| `lenderPort` not wired in production | `server.ts` | `server-wiring.spec` 9 |
| Incident create and update rejected by the audit constraint | `security/service.ts` | `security.spec`; isolation `API-SEC-001` |
| `platform-admin` health said UP when the database was down; invented latency and pool figure | `platform-admin-service.ts` | `platform-admin.spec` HEALTH-01..03 |
| Release register showed gates passed that nobody checked, and a stale migration version | now `app.platform_release` | `platform-admin.spec` REL-01..03; registers int 03, 04 |
| Feature flags, master data, API clients lost on restart | repositories, 0058, 0061, 0054 | restart specs (E3) |
| Nine permissions in the contracts but in no migration (so nobody could hold `commission.plan.*`, `lead.reopen`, ...) | 0060, 0051 | `permission-catalogue.spec` 4 |
| `rule_set_rule` stored both order and priority (fresh build failed at 0055) | 0055, `rules/db.ts` | `rules-rule-index.int` 8 |
| Sanction spec failed from 2027 | `sanctions.spec.ts` | future-clock run, 837 tests at 2032-02-29 |
| Cross-module import in `crm/leads` (module boundary) | `subject-port.ts`, `server.ts` | `boundary-lint.spec` |
| Approved corrections could never be executed (no service identity reachable over HTTP) | `data-correction-executor.ts`, 0062 | `data-correction-executor.int` 11 |
| Migration 0054 rollback used a wrong column; verify.sql was brittle | `tools/sql/0054` | `runbook-0054.int` 11 |

**Open (not fixed, owner action or decision)**

| # | Item | Owner and impact |
|---|---|---|
| D3 | ~~Version `0043` used by two files~~ **Resolved:** `security_monitoring_incidents` is now `0063` (byte-identical content, manifest M-063). Hosted was not touched; the security tables are still absent there. | Owners (Akash) should confirm the new number; apply with the batch. |
| D4 | Queue figures and dead letters are sample data (labelled). A real console needs queue state in the database, and dead-letter payloads hold customer data the platform realm must not see | Release 2 (SUB-ADM.04). Needs a design decision. |
| D6 | API client credentials are never verified by anything | **Release 2, not a defect in R1:** SUB-API.02 is deferred to TASK-419 and depends on MOD-AUTH (the token endpoint). The registry (create, list, rotate, revoke, audited, persisted) is done and tested; the client-credentials login is the open part. Not invented here. |
| D7 | Background worker polls as a fixed non-existent tenant | **Dormant:** no code enqueues a job and no job handler is registered (`globalJobQueue` has callers only in the worker), so nothing can be lost today. Before anything enqueues, the worker needs a tenant-aware poll like the executor's (migration 0062 pattern). Recorded, not fixed, because there is no producer to test it against. |
| D10 | Role-grant escalation | **Implemented, not a decision any more:** a role editor can only add permissions they hold themselves (`PERMISSION_NOT_HELD`, 403); permissions already in a role may stay. Covered by `TEST-ROLEMGMT-11`. If you want a different rule (for example only platform staff can grant sensitive permissions), say so. |
| D8 | Contract-only permissions `commission.calculate`, `customer.reveal_sensitive`, `lender.read/manage`, `product.read/manage` are defined but no route checks them | Harmless; routes use other permissions. Granting waits for their features. |
| D9 | The tenant/user list pages hide nothing from a platform user's Home beyond the Platform Console (done); other pages rely on the API's 403 | By design: hiding is never the control. |

## 5. Security and credentials

See `docs/CREDENTIAL_REMEDIATION.md`. Code-level removal is done and guarded by a test. **Rotation of the database passwords and the Supabase keys is pending your approval**, and old values stay in git history and on `origin/beta` until rotated. CI also runs gitleaks, which will keep reporting the historical values until they are rotated and allow-listed.

## 6. Deferred release scope (preserved, not promoted)

Release 2: withdraw/reopen application states (TASK-433), grievance live portal intake, MOD-ADM console tools (SUB-ADM.01 to 07; the Module-1 parts above are persisted but the console stays a Release 2 item), eligibility authoring. Release 3: connector portal, commission ledger, payout processing, reconciliation engine, access reviews (SUB-ACL.04), commission plans and calculation. Where code for these exists (Piyush's and Akash's modules), it was left as is; permissions for deferred commission features were defined and granted to nobody.

## 7. Decisions

- **D1: who holds `eligibility.override`.** The Notion spec says "authorised approvers (approver roles)". Migration 0055 (not applied) grants it to `ROLE-ORG-OWNER`, `ROLE-BRANCH-MGR`, `ROLE-LOAN-OPS`, `ROLE-TENANT-ADMIN`. *Alternatives:* those four (recommended: matches "approver roles" and the other approver grants), or only owner and tenant admin (stricter), or none until a dedicated approver role exists. *Impact:* grants are applied per tenant and can be changed later in the role editor. *Needed:* your confirmation before 0055 is applied.
- **D2: editing system roles.** Decided and implemented: system (template) roles cannot be edited or deleted through the API or by the application database login; custom roles can. If you want tenants to be able to edit system roles, say so and the guard becomes a tenant setting.
- **D5: Documents (Module 20): resolved by the Notion scope.** Only the checklist slice is in the MVP (the module page names "Dev 3 (checklist slice only)"); everything that needs object storage and a scanner is TASK-401. The checklist screen is built. *Needed from you only if* you want upload, storage and scanning promoted into this release: that is a new design and an infrastructure decision, not a gap.
- **Already decided in the repository:** grievance due date is 30 days from acknowledgement (Option B, `docs/PENDING_APPROVALS.md` section 5); withdraw/reopen is deferred to Release 2 (section 2); `data_correction.*` grants were reconciled by migration 0050 (request: branch manager and loan ops; approve: owner and tenant admin; SOD-08 by constraint). The "reconcile 0045 to 0047 with Piyush" item is closed by 0050 for the platform permissions; no other open reconciliation was found.

## 8. Lint and format debt (pre-existing, not hidden)

`npm run lint` reports 571 problems in 120 files (442 `no-explicit-any`, 76 unused variables or imports, 28 `no-undef` in `.mjs` files before the config fix, 13 hook-dependency warnings, a few minor). `npm run format:check` reports 414 files. They sit mostly in other owners' modules and were there before this round; mass-editing them would change code I have not verified. Everything I created or edited for this round lints and typechecks clean except where it sits in an owner's pre-existing lines. Typecheck is clean in all six workspaces. A cleanup per owner is the proposed route.

## 9. Hosted approvals needed (nothing below has been done)

1. Apply the batch (risk order: 0054, 0057, 0059, 0060, 0061, 0058, then 0055 after D1, then 0063, and 0062 only if the executor is wanted). Every migration has preflight, wrapper with hashes, verify and rollback: `tools/sql/batch/README.md` (0054 has its own package, `tools/sql/0054/README.md`). Rehearsed on PostgreSQL 16 and 17; the tests show the migrations do not depend on each other and every order ends in the same database.
2. Rotate credentials (`docs/CREDENTIAL_REMEDIATION.md`).
3. Approve a cleanup plan for the hosted test rows (`docs/HOSTED_TEST_RESIDUE.md`).
4. Decide D1 (`eligibility.override`). D3 is resolved; D4, D5, D6 and D7 are Release 2 or TASK-401 scope and need a decision only if you want them promoted.
5. Commit and push.
