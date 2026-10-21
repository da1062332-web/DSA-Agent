# Permission and UI visibility audit

Date: 2026-10-19. Branch `beta` at `94176f9`. **Read-only audit: no code, database, grant or user was changed, nothing was pushed or deployed.** Machine-readable inventory: `docs/permission-ui-visibility-audit.json`.

## 1. Executive summary

| Question                                                                  | Answer                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web feature folders / API routers                                         | 39 / 32                                                                                                                                                                                    |
| Web routes (feature routes + shell routes)                                | 74 + 9 (login, mfa, forgot/reset password, public upload, home, account security, not-found)                                                                                               |
| API routes registered (real route tree)                                   | 378: 353 under /v1, 19 platform, 4 public, 2 infrastructure                                                                                                                                |
| UI components inventoried                                                 | 50 sidebar items (48 with a screen), 18 Home cards, 643 action controls in 76 files                                                                                                        |
| Roles                                                                     | 16 role codes on hosted (14 in the live Qloax tenant, 2 platform roles); permission codes: 100 in the contracts, 99 in the hosted catalogue                                                |
| API routes with a verified permission gate                                | 320 of 378 (222 proven by refusing a zero-permission user, 79 by reading the code) plus 19 platform routes that refuse tenant users                                                        |
| API routes with no permission check that need a fix                       | 15 (F-01 to F-06), plus 8 catalogue reads that need a decision (F-21)                                                                                                                      |
| API routes open to every signed-in user by design or pending a decision   | 14 self-service, 12 directory reads, 3 deferred stubs, 0 unverified                                                                                                                        |
| Sidebar items: correctly protected / UI-only guard / no rule / wrong rule | 34 / 7 / 6 / 1 (placeholders: 2)                                                                                                                                                           |
| Components visible to every signed-in user                                | 6 sidebar items with a screen have no rule; all 18 Home cards (minus Platform Console) show to every customer-tenant user; 583 of 643 action controls show no permission guard (heuristic) |
| Findings by severity                                                      | HIGH: 4, MEDIUM: 7, LOW: 8, INFO: 3                                                                                                                                                        |

**Highest severity: HIGH, no CRITICAL.** Four groups of endpoints (F-01 to F-04: commission reads, sanction and disbursement reads, manual journal posting, security event writes) let a signed-in user with no permissions read or write finance and security data. The UI hides those screens, but the API does not, so the hiding is the only protection. Everything else that was probed either refuses a zero-permission user or is a deliberate self-service or directory read.

Method in one paragraph: the real Express route tree was enumerated from `createApp`; every route was called as a signed-in user with zero permissions (403 = gated); every gated route was then called once per permission code to learn which single permission opens it; the routes that did not answer 403 were traced to their service code and, for the doubtful ones, called again against a throwaway PostgreSQL. The hosted catalogue and role grants were read with read-only queries. Limits are in section 14.

## 2. Repository and environment inspected

- Repository `DSA-Agent`, branch `beta` (`94176f9`); `apps/web/src` (React 18, MUI), `apps/api/src` (Express 5, Kysely), `packages/contracts`, `supabase/migrations` (RLS, grants), existing tests.
- Hosted development project `mlpkwwhnagxzinaohdxg` (PostgreSQL 17): read-only `SELECT` on `app.permission`, `app.role`, `app.role_permission`, `app.user_role_assignment` (counts only, no user data). Nothing was written.
- Throwaway PostgreSQL 16 (Testcontainers, guarded) for the zero-permission probes. No hosted database was used for any request.
- Evidence artefacts were produced by scripts kept outside the repository; section 14 lists what each proved.

## 3. Roles

Live roles of tenant `qloax-dsa` (the tenant of the Qloax test accounts) from hosted:

| Role code                | Name                           | Grants | Active users | Notes                                     |
| ------------------------ | ------------------------------ | ------ | ------------ | ----------------------------------------- |
| ROLE-BRANCH-MGR          | Branch manager                 | 45     | 1            |                                           |
| ROLE-COMMISSION-APPROVER | Commission and Payout Approver | 4      | 1            |                                           |
| ROLE-COMPLIANCE          | Compliance                     | 8      | 1            |                                           |
| ROLE-DOC-VERIFIER        | Document verifier              | 7      | 1            |                                           |
| ROLE-FINANCE-EXEC        | Finance Executive              | 5      | 1            |                                           |
| ROLE-LOAN-OPS            | Loan operations                | 25     | 1            |                                           |
| ROLE-ORG-OWNER           | DSA owner                      | 72     | 2            | role.manage without user.manage (F-13)    |
| ROLE-RM                  | Relationship manager           | 18     | 1            |                                           |
| ROLE-RULE-APPROVER       | Rule approver                  | 4      | 1            |                                           |
| ROLE-RULE-AUTHOR         | Rule author                    | 2      | 1            |                                           |
| ROLE-SALES-EXEC          | Sales executive                | 10     | 1            |                                           |
| ROLE-TEAM-MGR            | Team manager                   | 14     | 1            |                                           |
| ROLE-TENANT-ADMIN        | Tenant administrator           | 65     | 1            | holds the 6 platform.* permissions (F-09) |
| ROLE-VERIFIER            | Verification Specialist        | 7      | 0            | no active users                           |

Platform tenant roles: `ROLE-PLATFORM-SUPERADMIN`, `ROLE-PLATFORM-SUPPORT` (platform realm only).

Grant differences for the same role code across tenants are listed in F-17. Role code to responsibility, as found in the seeds and role names: SALES-EXEC (own leads), RM (qualify, convert), TEAM-MGR / BRANCH-MGR (assign, supervise), LOAN-OPS (documents, lender cases, sanctions), DOC-VERIFIER / VERIFIER (verification), COMPLIANCE (audit, privacy), FINANCE-EXEC / COMMISSION-APPROVER (finance), RULE-AUTHOR / RULE-APPROVER (rules), ORG-OWNER, TENANT-ADMIN (admin).

## 4. Permission codes

| Code                           | Contracts | Hosted | Qloax roles holding it                                                                          | API gates it opens | Sidebar items                                                                                                        | Flags                                                                |
| ------------------------------ | --------- | ------ | ----------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| activity.create                | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                                   | 0                  | Activity                                                                                                             |                                                                      |
| activity.update                | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 1                  |                                                                                                                      |                                                                      |
| adjustment.approve             | yes       | yes    | COMMISSION-APPROVER, ORG-OWNER                                                                  | 2                  |                                                                                                                      |                                                                      |
| adjustment.create              | yes       | yes    | FINANCE-EXEC                                                                                    | 0                  |                                                                                                                      |                                                                      |
| api.manage                     | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 5                  | API management                                                                                                       |                                                                      |
| api.read                       | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 5                  | API management                                                                                                       |                                                                      |
| application.cancel             | yes       | yes    | RM                                                                                              | 0                  |                                                                                                                      |                                                                      |
| application.create             | yes       | yes    | ORG-OWNER, RM, TENANT-ADMIN                                                                     | 0                  |                                                                                                                      | never referenced by web                                              |
| application.read               | yes       | yes    | BRANCH-MGR, COMPLIANCE, DOC-VERIFIER, LOAN-OPS, ORG-OWNER, RM, TEAM-MGR, TENANT-ADMIN, VERIFIER | 10                 | Activity; Applications; Lender cases; Documents                                                                      |                                                                      |
| application.review             | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  |                                                                                                                      |                                                                      |
| application.update             | yes       | yes    | LOAN-OPS, ORG-OWNER, RM, TENANT-ADMIN                                                           | 2                  |                                                                                                                      |                                                                      |
| attendance.manage              | yes       | yes    | BRANCH-MGR, ORG-OWNER, TEAM-MGR, TENANT-ADMIN                                                   | 0                  |                                                                                                                      |                                                                      |
| audit.export_evidence          | yes       | yes    | COMPLIANCE, ORG-OWNER, TENANT-ADMIN                                                             | 4                  | Audit                                                                                                                |                                                                      |
| audit.read                     | yes       | yes    | COMPLIANCE, ORG-OWNER, TENANT-ADMIN                                                             | 9                  | Audit; Privacy and consent                                                                                           |                                                                      |
| automation.approve             | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 1                  | Automation rules                                                                                                     |                                                                      |
| automation.author              | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 3                  | Automation rules                                                                                                     |                                                                      |
| automation.execute             | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 1                  | Automation rules                                                                                                     |                                                                      |
| automation.operator            | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 4                  | Automation rules                                                                                                     |                                                                      |
| automation.read                | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 9                  | Automation rules                                                                                                     |                                                                      |
| commission.calculate           | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| commission.plan.approve        | yes       | yes    | (none)                                                                                          | 1                  | Commission                                                                                                           | granted to NO role                                                   |
| commission.plan.edit           | yes       | yes    | (none)                                                                                          | 1                  | Commission                                                                                                           | granted to NO role                                                   |
| complaint.create               | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 1                  | Grievances                                                                                                           |                                                                      |
| complaint.manage               | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 4                  | Grievances                                                                                                           |                                                                      |
| config.manage                  | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 53                 | Messaging; Integrations; API management; Audit; Approvals; Organisation; Branches; Teams; Work queues; Configuration |                                                                      |
| connector.attribution_change   | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 2                  |                                                                                                                      | never referenced by web                                              |
| connector.bank_change_approve  | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 1                  |                                                                                                                      | never referenced by web                                              |
| connector.dispute_resolve      | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 1                  |                                                                                                                      | never referenced by web                                              |
| connector.manage               | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  | Connectors                                                                                                           |                                                                      |
| connector.read                 | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 4                  | Connectors                                                                                                           |                                                                      |
| consent.record                 | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| customer.create                | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, TENANT-ADMIN                                                         | 0                  |                                                                                                                      | never referenced by web                                              |
| customer.read                  | yes       | yes    | BRANCH-MGR, COMPLIANCE, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                       | 8                  | Customers; Activity; Privacy and consent                                                                             |                                                                      |
| customer.reveal_sensitive      | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| customer.update                | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, TENANT-ADMIN                                                         | 1                  |                                                                                                                      | never referenced by web                                              |
| data_correction.approve        | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 1                  | Approvals                                                                                                            |                                                                      |
| data_correction.request        | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 2                  | Approvals                                                                                                            |                                                                      |
| disbursement.exception_approve | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| disbursement.record            | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  | Sanction and disbursement                                                                                            |                                                                      |
| disbursement.verify            | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  | Sanction and disbursement                                                                                            |                                                                      |
| document.review                | yes       | yes    | DOC-VERIFIER, LOAN-OPS, VERIFIER                                                                | 1                  |                                                                                                                      |                                                                      |
| document.upload                | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 3                  | Document sharing                                                                                                     |                                                                      |
| eligibility.override           | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 1                  |                                                                                                                      |                                                                      |
| export.run                     | yes       | yes    | BRANCH-MGR, ORG-OWNER, TENANT-ADMIN                                                             | 3                  | Import and export                                                                                                    |                                                                      |
| finance.dispute                | yes       | yes    | FINANCE-EXEC, ORG-OWNER                                                                         | 0                  |                                                                                                                      |                                                                      |
| finance.period_close           | yes       | NO     | (none)                                                                                          | 0                  |                                                                                                                      | not in hosted catalogue                                              |
| finance.reconcile              | yes       | yes    | FINANCE-EXEC, ORG-OWNER                                                                         | 1                  | Reconciliation                                                                                                       |                                                                      |
| finance.view                   | yes       | yes    | BRANCH-MGR, COMMISSION-APPROVER, FINANCE-EXEC, ORG-OWNER                                        | 18                 | Commission; Ledger; Payouts; Reconciliation; Invoices                                                                |                                                                      |
| import.run                     | yes       | yes    | BRANCH-MGR, ORG-OWNER, TENANT-ADMIN                                                             | 0                  | Import and export                                                                                                    |                                                                      |
| integration.manage             | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  | Integrations                                                                                                         |                                                                      |
| integration.read               | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  | Integrations                                                                                                         |                                                                      |
| invoice.manage                 | yes       | yes    | FINANCE-EXEC, ORG-OWNER, TENANT-ADMIN                                                           | 4                  | Invoices                                                                                                             |                                                                      |
| lead.assign                    | yes       | yes    | BRANCH-MGR, ORG-OWNER, TEAM-MGR, TENANT-ADMIN                                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| lead.create                    | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| lead.qualify                   | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| lead.read                      | yes       | yes    | BRANCH-MGR, COMPLIANCE, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                       | 3                  | Leads; Activity                                                                                                      |                                                                      |
| lead.reopen                    | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by web                          |
| lead.update                    | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                                   | 0                  |                                                                                                                      | never referenced by web                                              |
| lender.manage                  | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| lender.read                    | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| lender_case.submit             | yes       | yes    | LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                               | 1                  | Lender cases                                                                                                         |                                                                      |
| lender_case.update_status      | yes       | yes    | LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                               | 0                  |                                                                                                                      |                                                                      |
| message.send                   | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                         | 2                  | Messaging                                                                                                            |                                                                      |
| partner.application_read       | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  |                                                                                                                      |                                                                      |
| partner.lead_ingest            | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  |                                                                                                                      |                                                                      |
| payout.approve                 | yes       | yes    | COMMISSION-APPROVER, ORG-OWNER                                                                  | 1                  | Payouts                                                                                                              |                                                                      |
| payout.record_payment          | yes       | yes    | COMMISSION-APPROVER, ORG-OWNER                                                                  | 6                  | Payouts                                                                                                              |                                                                      |
| payout.request                 | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  | Payouts                                                                                                              |                                                                      |
| platform.console               | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  | Platform Console                                                                                                     |                                                                      |
| platform.flags                 | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  |                                                                                                                      |                                                                      |
| platform.jobs                  | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  |                                                                                                                      |                                                                      |
| platform.master_data           | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  |                                                                                                                      |                                                                      |
| platform.release               | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  |                                                                                                                      |                                                                      |
| platform.support_access        | yes       | yes    | TENANT-ADMIN                                                                                    | 0                  |                                                                                                                      |                                                                      |
| product.manage                 | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| product.read                   | yes       | yes    | (none)                                                                                          | 0                  |                                                                                                                      | granted to NO role; never referenced by API; never referenced by web |
| report.manage                  | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 12                 | Reports & Catalogue                                                                                                  |                                                                      |
| report.read                    | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 13                 | Performance Dashboard; Targets; Leaderboard; Reports & Catalogue; Performance Dashboards                             |                                                                      |
| report.schedule                | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 2                  |                                                                                                                      | never referenced by web                                              |
| role.manage                    | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 10                 |                                                                                                                      |                                                                      |
| rule.approve                   | yes       | yes    | RULE-APPROVER                                                                                   | 1                  | Rule sets; Decisions                                                                                                 |                                                                      |
| rule.author                    | yes       | yes    | RULE-AUTHOR                                                                                     | 14                 | Rule sets; Decisions                                                                                                 |                                                                      |
| rule.publish                   | yes       | yes    | RULE-APPROVER                                                                                   | 3                  | Rule sets; Decisions                                                                                                 |                                                                      |
| rule.simulate                  | yes       | yes    | RULE-APPROVER, RULE-AUTHOR                                                                      | 13                 | Rule sets; Decisions                                                                                                 |                                                                      |
| rule.suspend                   | yes       | yes    | RULE-APPROVER                                                                                   | 2                  | Rule sets; Decisions                                                                                                 |                                                                      |
| sanction.record                | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 0                  | Sanction and disbursement                                                                                            |                                                                      |
| security.incident              | yes       | yes    | COMPLIANCE, ORG-OWNER, TENANT-ADMIN                                                             | 5                  | Security events and incidents                                                                                        |                                                                      |
| security.vuln                  | yes       | yes    | COMPLIANCE, ORG-OWNER, TENANT-ADMIN                                                             | 0                  |                                                                                                                      | never referenced by API; never referenced by web                     |
| share.create                   | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, TENANT-ADMIN                                                   | 2                  | Document sharing                                                                                                     |                                                                      |
| target.manage                  | yes       | yes    | ORG-OWNER, TENANT-ADMIN                                                                         | 0                  | Targets                                                                                                              |                                                                      |
| task.create                    | yes       | yes    | BRANCH-MGR, ORG-OWNER, RM, TEAM-MGR, TENANT-ADMIN                                               | 0                  |                                                                                                                      | never referenced by web                                              |
| task.read                      | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                         | 1                  | Tasks                                                                                                                |                                                                      |
| task.update                    | yes       | yes    | BRANCH-MGR, LOAN-OPS, ORG-OWNER, RM, SALES-EXEC, TEAM-MGR, TENANT-ADMIN                         | 0                  |                                                                                                                      | never referenced by web                                              |
| user.manage                    | yes       | yes    | BRANCH-MGR, TENANT-ADMIN                                                                        | 16                 | Users; Access control                                                                                                |                                                                      |
| verification.complete          | yes       | yes    | DOC-VERIFIER, VERIFIER                                                                          | 1                  |                                                                                                                      | never referenced by web                                              |
| verification.create            | yes       | yes    | DOC-VERIFIER, VERIFIER                                                                          | 1                  |                                                                                                                      | never referenced by web                                              |
| verification.perform           | yes       | yes    | BRANCH-MGR, DOC-VERIFIER, LOAN-OPS, ORG-OWNER, TENANT-ADMIN, VERIFIER                           | 1                  | Verification; Verification workbench                                                                                 |                                                                      |
| verification.read              | yes       | yes    | BRANCH-MGR, COMPLIANCE, DOC-VERIFIER, LOAN-OPS, ORG-OWNER, RM, TENANT-ADMIN, VERIFIER           | 4                  | Verification; Verification workbench                                                                                 |                                                                      |
| verification.update            | yes       | yes    | DOC-VERIFIER, VERIFIER                                                                          | 1                  |                                                                                                                      | never referenced by web                                              |
| webhook.manage                 | yes       | yes    | BRANCH-MGR, ORG-OWNER                                                                           | 2                  |                                                                                                                      |                                                                      |

"API gates it opens" counts routes where that single permission is enough to pass the first gate in the sweep. Routes whose permission check happens after request validation do not show up here, so a low number does not mean the code is unused (see the "never referenced by API" flag for that).

## 5. Findings, ranked

Categories refer to the audit brief: A intentionally public, B authenticated but permissionless, C visible to every role by default, D permission exists but is not connected, E backend-protected but frontend-unprotected, F frontend-protected but backend-unprotected, G unknown policy.

### F-01 (HIGH, category F): Commission read APIs have no permission check

- **What:** GET /v1/commission-plans, /commission-plans/:id, /commission-calculations(/:id), /commission-payables answer any signed-in user of the tenant. The sidebar hides Commission unless the user holds finance.view, commission.plan.edit or commission.plan.approve.
- **Evidence:** finance/finance-service.ts:195 listCommissionPlans reads by tenant with no assertPermission, while updateCommissionPlan (line 211) does assert; real-database probe as a zero-permission user: 200 on all three lists, 404 (lookup first) on the by-id routes.
- **Recommended fix:** Add assertPermission(ctx, "finance.view") (or a dedicated commission.read) to the read methods; add 403 tests for a zero-grant user and a sales role.

### F-02 (HIGH, category F): Sanction and disbursement read APIs have no permission check

- **What:** GET /v1/sanctions, /sanctions/:id, /sanctions/:id/tranches, /tranches/:id, /disbursements and /lender-cases/:id/sanctions answer any signed-in user. The sidebar shows Sanction and disbursement only to sanction.record, disbursement.record or disbursement.verify holders.
- **Evidence:** origination/sanctions/repository.ts:113 listAllSanctions filters by tenant only; real-database probe: 200 on /sanctions and /disbursements, 404 on by-id routes (lookup before any check).
- **Recommended fix:** Require the sanction/disbursement read permission used by the screen (or application.read for the case-scoped list) in the service; add zero-grant and sales-role tests.

### F-03 (HIGH, category F): Manual ledger journal posting has no permission check, and the ledger audit actions are invalid

- **What:** POST /v1/ledger/journals has no authorization (the read GET /v1/ledger/journals needs finance.view). Separately, the audit actions ledger.journal.post, ledger.period.close and ledger.export.run have two dots and violate the audit_event CHECK (action ~ ^[a-z_]+\.[a-z_]+$), so those three operations fail on a database built from the migrations.
- **Evidence:** ledger/ledger-service.ts:122 postJournal goes straight to the period check; probe on a throwaway database: a zero-permission user reached the audit insert and was stopped by audit_event_action_check (422, nothing committed). Severity becomes CRITICAL the moment the audit action is fixed without adding the check.
- **Recommended fix:** Add a finance posting permission check to postJournal; rename the three audit actions to the allowed shape (for example ledger.journal_posted); add tests for both.

### F-04 (HIGH, category F): Any signed-in user can write forged security events

- **What:** POST /v1/security/events records an event with caller-chosen type, principal, IP and severity. The list endpoints need security.incident.
- **Evidence:** security/service.ts:81 recordSecurityEvent has no check; probe on a throwaway database: zero-permission user got 201 and a security_event row was written.
- **Recommended fix:** Restrict the endpoint to a service identity or security.incident; derive principal and IP from the request instead of the body.

### F-05 (MEDIUM, category G): Decision evaluation endpoint has no authorization found

- **What:** POST /v1/decisions/:decisionKey/evaluations calls the decision engine without a permission check in the router or the engine; simulation routes in the same file require rule.simulate.
- **Evidence:** rules/api/router.ts:673 and rules/engine/decision-engine.ts:30 (decide). Static trace only: not exercised with a valid payload.
- **Recommended fix:** Confirm the intended callers; require rule.simulate (or a service identity) and test.

### F-06 (MEDIUM, category F): Import batch list has no permission check

- **What:** GET /v1/imports lists every import batch of the tenant to any signed-in user, while report download and commit are gated by requireTargetPermission.
- **Evidence:** platform/imports/service.ts:452 listBatches; probe: 200 for a zero-permission user.
- **Recommended fix:** Apply the same import.run / config.manage / target-create check to the list and detail reads.

### F-07 (MEDIUM, category C): Home page offers 18 module cards to every customer-tenant user

- **What:** The cards (Leads, Decision Rules, User Management, Access Control, Commissions, Payouts, Tenant Configuration and others) are filtered only by realm, not by permission. A Sales Executive sees links that lead to refusals or, for Commissions and Sanctions, to open data.
- **Evidence:** web shell/HomePage.tsx:7-111 (cards) and :121 (filter).
- **Recommended fix:** Filter cards with the same anyOf rules as the sidebar (reuse NAV_GROUPS).

### F-08 (MEDIUM, category E): No route-level permission guard anywhere in the web app

- **What:** AppLayout checks the session and MFA only. A user who types /commission, /roles or /payouts gets the page shell and then API errors; 52 of 76 feature files contain no permission check at all.
- **Evidence:** web shell/AppLayout.tsx:60,89; routes.tsx:34-40; fe inventory (52/76).
- **Recommended fix:** Add a route wrapper that takes the matching anyOf from NAV_GROUPS and renders a "not permitted" page.

### F-09 (MEDIUM, category D): Qloax tenant admin role holds the six platform operator permissions

- **What:** ROLE-TENANT-ADMIN of qloax-dsa holds platform.console, flags, jobs, master_data, release and support_access, as demo-alpha does. The platform realm refuses tenant users and the menu is hidden, but the grants should not exist (Module 1 check 16).
- **Evidence:** read-only hosted query of app.role_permission on 2026-10-19: demo-alpha and qloax-dsa each have the six; no other customer tenant has any.
- **Recommended fix:** Same prepared removal as demo-alpha (tools/sql/fixes), after approval; make the provisioning script stop copying them.

### F-10 (MEDIUM, category D): Nine permissions are defined but granted to no role

- **What:** commission.calculate, commission.plan.edit, commission.plan.approve, customer.reveal_sensitive, lead.reopen, lender.read, lender.manage, product.read, product.manage. Features that need them cannot be used by any role: commission plan edit/approval, revealing sensitive customer data, reopening a lead.
- **Evidence:** hosted catalogue and role_permission (99 permissions); migration 0060 defines them and grants none; docs/PERMISSION_RECONCILIATION.md.
- **Recommended fix:** Business decision on which roles hold each; then a grant migration (needs approval).

### F-11 (MEDIUM, category C): Staff email and workload visible to every signed-in user

- **What:** GET /v1/workforce/agents returns displayName, email, availability, capacity and live lead/application counts to any signed-in user. Workforce has no permission rule in the sidebar by design.
- **Evidence:** probe on a throwaway database: fields id, displayName, email, primaryBranchId, availability, capacity, activeLeadCount, activeApplicationCount.
- **Recommended fix:** Decide whether all staff should see this; if not, require workforce.read or restrict to managers.

### F-12 (LOW, category E): Lead action buttons ignore permissions

- **What:** Qualify, Disqualify, Convert and Assign appear by lead state only. A user with lead.read but without lead.qualify, lead.assign or application.create sees them and gets a refusal.
- **Evidence:** web features/leads/LeadDetail.tsx:192-255 (no permission test); API checks per action (lead-service.ts:232,518,814,957).
- **Recommended fix:** Hide or disable each button with the permission its endpoint requires.

### F-13 (LOW, category B): Access control menu omits role.manage

- **What:** The sidebar item needs user.manage; the API accepts user.manage or role.manage. ROLE-ORG-OWNER holds role.manage but not user.manage and cannot see the screen.
- **Evidence:** web shell/Sidebar.tsx (Access control anyOf) versus sweep: GET /v1/roles opens with user.manage | role.manage.
- **Recommended fix:** Use anyOf [user.manage, role.manage] (the dead navigation.ts already does).

### F-14 (LOW, category C): Dead duplicate navigation config

- **What:** shell/navigation.ts defines a second, different set of visibility rules that nothing in the app imports (only its spec does).
- **Evidence:** grep: imported only by navigation.spec.ts.
- **Recommended fix:** Delete it and its spec or make it the single source for sidebar, Home and route guards.

### F-15 (LOW, category C): Duplicate sidebar entry

- **What:** "Performance Dashboard" (Team and performance) and "Performance Dashboards" (Reporting) both link to /performance.
- **Evidence:** web shell/Sidebar.tsx.
- **Recommended fix:** Remove one.

### F-16 (LOW, category C): Tenant directory reads are open to every signed-in user

- **What:** GET /v1/users (id, display name, branch, status, availability), /branches, /teams, /work-queues, /delegations and /tenant answer any signed-in user. Needed for pickers, but the sidebar lists the matching admin screens as admin-only.
- **Evidence:** probe on a throwaway database.
- **Recommended fix:** Decision: keep reads open and say so, or require config.manage/user.manage for the admin screens' data.

### F-17 (LOW, category D): Same role code, different grants in different tenants

- **What:** ROLE-COMPLIANCE lacks audit.read, customer.read, lead.read, application.read, audit.export_evidence in demo-dsa and the three test tenants; ROLE-RM in demo-dsa lacks application.* and lead.qualify; BRANCH-MGR and RM in demo-beta lack customer.create/update.
- **Evidence:** hosted role_permission comparison against qloax-dsa.
- **Recommended fix:** Align or document; test tenants are fixtures.

### F-18 (LOW, category D): Catalogue mismatches

- **What:** finance.period_close exists in the contracts but not in the hosted catalogue; eligibility.override is listed twice in PERMISSION_CODES; security.vuln is granted but never used by API or web.
- **Evidence:** packages/contracts/src/permissions.ts; hosted app.permission.
- **Recommended fix:** Remove the duplicate; decide on finance.period_close and security.vuln.

### F-19 (INFO, category B): Role navigation tests cover 9 of 14 roles

- **What:** shell/role-navigation.spec.ts covers Commission Approver, Compliance, Doc Verifier, Finance Exec, Loan Ops, RM, Rule Approver, Rule Author, Sales Exec. Missing: Org Owner, Tenant Admin, Branch Manager, Team Manager, Verifier.
- **Evidence:** file read.
- **Recommended fix:** Add the five roles using the live grant sets.

### F-20 (INFO, category A): Deferred endpoints answer 409 to everyone

- **What:** POST /v1/tasks/:id/snooze, /tasks/bulk-reassignment and PUT /v1/customers/:id/preferences always throw INVALID_STATE (deferred to later releases).
- **Evidence:** crm/tasks/router.ts:208,216; crm/customers/router.ts:208.
- **Recommended fix:** None until built; add the permission check when implemented.

### F-21 (LOW, category D): Lender and product catalogue reads are open; their permissions are unused

- **What:** GET /v1/lenders and /v1/products (and sub-resources) have no check; lender.read/lender.manage/product.read/product.manage exist, are granted to no role and are not referenced by the API.
- **Evidence:** probe: 200 for zero-permission user; permission reconciliation.
- **Recommended fix:** Decision: keep catalogue read open to all staff (and drop the unused codes) or wire the codes and grant them.

### F-22 (INFO, category A): Platform routes are correctly realm-gated

- **What:** All 19 /platform/v1 routes refused a tenant user with every permission (the new tenant flag routes included).
- **Evidence:** permission sweep and platform tests.
- **Recommended fix:** None.

## 6. Sidebar and navigation audit

Rule in code (`apps/web/src/shell/Sidebar.tsx`, `visibleGroups`): an item shows when it has a screen, the group is not admin-only (or the user holds config.manage or user.manage), the item has no `anyOf` or the user holds one of them, and the item is not the Platform Console (platform realm only). **Hiding is not enforcement**: the "API" columns come from the probes.

| Group                                          | Item                          | Route                    | UI rule (anyOf)                                                                                         | Primary API call                                | API gate                                      | Class                                | Note                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                                       | Home                          | /                        | none                                                                                                    | -                                               | -                                             | PUBLIC_OR_INTENTIONALLY_UNRESTRICTED | Home. Its 18 cards are not filtered by permission (F-07).                                                                                                  |
| Leads and customers (DOM-B)                    | Leads                         | /leads                   | lead.read                                                                                               | GET /v1/leads                                   | lead.read                                     | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Leads and customers (DOM-B)                    | Customers                     | /customers               | customer.read                                                                                           | GET /v1/customers                               | customer.read                                 | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Follow-ups and communication (DOM-C)           | Tasks                         | /tasks                   | task.read                                                                                               | GET /v1/tasks                                   | task.read                                     | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Follow-ups and communication (DOM-C)           | Activity                      | /activities              | lead.read \| customer.read \| application.read \| activity.create                                       | free:own feed (GET /v1/activities)              | none                                          | CORRECTLY_PROTECTED                  | List is the caller's own feed; subject timelines check the subject's read permission.                                                                      |
| Follow-ups and communication (DOM-C)           | Messaging                     | /messaging               | message.send \| config.manage                                                                           | GET /v1/messages                                | config.manage \| message.send                 | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Follow-ups and communication (DOM-C)           | Notifications                 | /notifications           | none                                                                                                    | free:own                                        | none                                          | PUBLIC_OR_INTENTIONALLY_UNRESTRICTED | Own notifications only.                                                                                                                                    |
| Follow-ups and communication (DOM-C)           | Grievances                    | /complaints              | complaint.create \| complaint.manage                                                                    | GET /v1/complaints                              | complaint.manage                              | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Lenders and products (DOM-D)                   | Lenders                       | /lenders                 | none                                                                                                    | free:GET /v1/lenders                            | none                                          | UNKNOWN_REQUIRES_DECISION            | No permission rule in UI or API; lender.read/lender.manage exist but are granted to no role and unused (F-21).                                             |
| Lenders and products (DOM-D)                   | Products                      | /products                | none                                                                                                    | free:GET /v1/products                           | none                                          | UNKNOWN_REQUIRES_DECISION            | No permission rule in UI or API; product.read/product.manage exist but are granted to no role and unused (F-21).                                           |
| Origination (DOM-E)                            | Applications                  | /applications            | application.read                                                                                        | GET /v1/applications                            | application.read                              | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Origination (DOM-E)                            | Lender cases                  | /lender-cases            | application.read \| lender_case.submit                                                                  | GET /v1/lender-cases                            | application.read                              | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Origination (DOM-E)                            | Eligibility                   | (not built)              | none                                                                                                    | not built                                       | -                                             | NOT_BUILT_PLACEHOLDER                |                                                                                                                                                            |
| Origination (DOM-E)                            | Sanction and disbursement     | /sanctions               | sanction.record \| disbursement.record \| disbursement.verify                                           | free:GET /v1/sanctions                          | none                                          | MISSING_PERMISSION_GUARD             | UI hides it; sanction and disbursement reads have no permission check (F-02).                                                                              |
| KYC, documents and verification (DOM-F)        | Documents                     | /documents               | application.read                                                                                        | GET /v1/applications/:id/checklist              | application.read                              | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| KYC, documents and verification (DOM-F)        | Document sharing              | /document-sharing        | document.upload \| share.create                                                                         | GET /v1/upload-links                            | document.upload                               | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| KYC, documents and verification (DOM-F)        | Verification                  | /verifications           | verification.read \| verification.perform                                                               | GET /v1/verification-requests                   | verification.read                             | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| KYC, documents and verification (DOM-F)        | Verification workbench        | /verifications/workbench | verification.read \| verification.perform                                                               | GET /v1/verification-requests                   | verification.read                             | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Business rules (DOM-G)                         | Rule sets                     | /rules                   | rule.author \| rule.simulate \| rule.approve \| rule.publish \| rule.suspend                            | GET /v1/rule-sets                               | rule.author \| rule.simulate                  | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Business rules (DOM-G)                         | Decisions                     | /decisions               | rule.author \| rule.simulate \| rule.approve \| rule.publish \| rule.suspend                            | GET /v1/decision-records                        | rule.simulate                                 | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Workflow automation (DOM-H)                    | Automation rules              | /automations             | automation.read \| automation.author \| automation.approve \| automation.execute \| automation.operator | GET /v1/automations                             | automation.read                               | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Team and performance (DOM-I)                   | Performance Dashboard         | /performance             | report.read                                                                                             | GET /v1/dashboards/:code                        | config.manage \| report.read \| report.manage | CORRECTLY_PROTECTED                  | Listed twice in the sidebar ("Performance Dashboard" and "Performance Dashboards"), same route (F-15).                                                     |
| Team and performance (DOM-I)                   | Targets                       | /targets                 | report.read \| target.manage                                                                            | GET /v1/targets                                 | report.read                                   | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Team and performance (DOM-I)                   | Leaderboard                   | /performance/leaderboard | report.read                                                                                             | GET /v1/dashboards/:code                        | config.manage \| report.read \| report.manage | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Team and performance (DOM-I)                   | Workforce                     | /workforce               | none                                                                                                    | free:GET /v1/workforce/agents                   | none                                          | UNKNOWN_REQUIRES_DECISION            | Shown to everyone by design; the API returns staff email and workload to any signed-in user (F-11).                                                        |
| Connectors (DOM-J)                             | Connectors                    | /connectors              | connector.read \| connector.manage                                                                      | GET /v1/connectors                              | connector.read                                | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Connectors (DOM-J)                             | Connector portal              | (not built)              | none                                                                                                    | not built                                       | -                                             | NOT_BUILT_PLACEHOLDER                |                                                                                                                                                            |
| Commission, payouts and reconciliation (DOM-K) | Commission                    | /commission              | finance.view \| commission.plan.edit \| commission.plan.approve                                         | free:GET /v1/commission-plans                   | none                                          | MISSING_PERMISSION_GUARD             | UI hides it; every commission read API has no permission check (F-01).                                                                                     |
| Commission, payouts and reconciliation (DOM-K) | Ledger                        | /ledger                  | finance.view                                                                                            | GET /v1/ledger/journals                         | finance.view                                  | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Commission, payouts and reconciliation (DOM-K) | Payouts                       | /payouts                 | finance.view \| payout.request \| payout.approve \| payout.record_payment                               | GET /v1/payout-requests                         | finance.view                                  | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Commission, payouts and reconciliation (DOM-K) | Reconciliation                | /reconciliation          | finance.view \| finance.reconcile                                                                       | GET /v1/reconciliation-exceptions               | finance.view                                  | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Commission, payouts and reconciliation (DOM-K) | Invoices                      | /invoices                | finance.view \| invoice.manage                                                                          | GET /v1/invoices                                | finance.view \| invoice.manage                | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Reporting (DOM-L)                              | Reports & Catalogue           | /reports                 | report.read \| report.manage                                                                            | GET /v1/reports                                 | config.manage \| report.read \| report.manage | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Reporting (DOM-L)                              | Performance Dashboards        | /performance             | report.read                                                                                             | GET /v1/dashboards/:code                        | config.manage \| report.read \| report.manage | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Integrations and API (DOM-M)                   | Integrations                  | /integrations            | integration.read \| integration.manage \| config.manage                                                 | GET /v1/integrations                            | config.manage \| integration.read             | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Integrations and API (DOM-M)                   | API management                | /api-management          | api.read \| api.manage \| config.manage                                                                 | GET /v1/api-clients                             | config.manage \| api.read \| api.manage       | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Security and compliance (DOM-N)                | Audit                         | /audit                   | audit.read \| audit.export_evidence \| config.manage                                                    | GET /v1/audit-events                            | audit.read                                    | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Security and compliance (DOM-N)                | Privacy and consent           | /privacy                 | audit.read \| customer.read                                                                             | GET /v1/privacy/stats                           | customer.read \| audit.read                   | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Security and compliance (DOM-N)                | Approvals                     | /approvals               | config.manage \| data_correction.request \| data_correction.approve                                     | GET /v1/data-corrections                        | data_correction.request                       | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Security and compliance (DOM-N)                | Security events and incidents | /security                | security.incident                                                                                       | GET /v1/incidents                               | security.incident                             | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Security and compliance (DOM-N)                | Security                      | /account/security        | none                                                                                                    | free:own                                        | none                                          | PUBLIC_OR_INTENTIONALLY_UNRESTRICTED | Own sign-in security settings.                                                                                                                             |
| Administration (DOM-O)                         | Organisation                  | /admin/organisation      | config.manage                                                                                           | GET /v1/organisations                           | config.manage                                 | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Administration (DOM-O)                         | Branches                      | /admin/branches          | config.manage                                                                                           | free:GET /v1/branches                           | none                                          | MISSING_PERMISSION_GUARD             | UI needs config.manage; GET /v1/branches answers any signed-in user (F-16, directory).                                                                     |
| Administration (DOM-O)                         | Teams                         | /admin/teams             | config.manage                                                                                           | free:GET /v1/teams                              | none                                          | MISSING_PERMISSION_GUARD             | UI needs config.manage; GET /v1/teams answers any signed-in user (F-16, directory).                                                                        |
| Administration (DOM-O)                         | Work queues                   | /admin/queues            | config.manage                                                                                           | free:GET /v1/work-queues                        | none                                          | MISSING_PERMISSION_GUARD             | UI needs config.manage; GET /v1/work-queues answers any signed-in user (F-16, directory).                                                                  |
| Administration (DOM-O)                         | Users                         | /users                   | user.manage                                                                                             | free:GET /v1/users                              | none                                          | MISSING_PERMISSION_GUARD             | UI needs user.manage; GET /v1/users (directory) answers any signed-in user (F-16).                                                                         |
| Administration (DOM-O)                         | Access control                | /roles                   | user.manage                                                                                             | GET /v1/roles                                   | user.manage \| role.manage                    | WRONG_PERMISSION                     | Sidebar needs user.manage; the API also accepts role.manage. ROLE-ORG-OWNER holds role.manage but not user.manage, so the screen is hidden from it (F-13). |
| Administration (DOM-O)                         | Configuration                 | /config                  | config.manage                                                                                           | GET /v1/config                                  | config.manage                                 | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Administration (DOM-O)                         | Platform Console              | /platform-admin          | platform.console                                                                                        | platform realm                                  | -                                             | CORRECTLY_PROTECTED                  |                                                                                                                                                            |
| Administration (DOM-O)                         | Import and export             | /admin/import-export     | import.run \| export.run                                                                                | free:GET /v1/imports (exports: GET /v1/exports) | none                                          | MISSING_PERMISSION_GUARD             | UI needs import.run\|export.run; GET /v1/imports has no permission check (F-06).                                                                           |

Counts: PUBLIC_OR_INTENTIONALLY_UNRESTRICTED 3, CORRECTLY_PROTECTED 34, UNKNOWN_REQUIRES_DECISION 3, NOT_BUILT_PLACEHOLDER 2, MISSING_PERMISSION_GUARD 7, WRONG_PERMISSION 1.

## 7. Role-wise visibility matrix (sidebar)

`V` = the item is visible to that role in tenant `qloax-dsa` under its live grants. `v!` = visible but the API gate would refuse (none found). `h!` = hidden although the API allows it. `o` = hidden in the UI but the API read is open to every signed-in user (F-01, F-02, F-06, F-16). Columns: BRANCH-MGR, COMMISSION-APPROVER, COMPLIANCE, DOC-VERIFIER, FINANCE-EXEC, LOAN-OPS, ORG-OWNER, RM, RULE-APPROVER, RULE-AUTHOR, SALES-EXEC, TEAM-MGR, TENANT-ADMIN, VERIFIER.

| Item                          | BRANCH-MGR | COMMISSION-APPROVER | COMPLIANCE | DOC-VERIFIER | FINANCE-EXEC | LOAN-OPS | ORG-OWNER | RM  | RULE-APPROVER | RULE-AUTHOR | SALES-EXEC | TEAM-MGR | TENANT-ADMIN | VERIFIER |
| ----------------------------- | ---------- | ------------------- | ---------- | ------------ | ------------ | -------- | --------- | --- | ------------- | ----------- | ---------- | -------- | ------------ | -------- |
| Home                          | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Leads                         | V          | ·                   | V          | ·            | ·            | ·        | V         | V   | ·             | ·           | V          | V        | V            | ·        |
| Customers                     | V          | ·                   | V          | ·            | ·            | ·        | V         | V   | ·             | ·           | V          | V        | V            | ·        |
| Tasks                         | V          | ·                   | ·          | ·            | ·            | V        | V         | V   | ·             | ·           | V          | V        | V            | ·        |
| Activity                      | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | V          | V        | V            | V        |
| Messaging                     | V          | ·                   | ·          | ·            | ·            | V        | V         | V   | ·             | ·           | V          | V        | V            | ·        |
| Notifications                 | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Grievances                    | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Lenders                       | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Products                      | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Applications                  | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | ·          | V        | V            | V        |
| Lender cases                  | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | ·          | V        | V            | V        |
| Sanction and disbursement     | V          | o                   | o          | o            | o            | V        | V         | o   | o             | o           | o          | o        | V            | o        |
| Documents                     | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | ·          | V        | V            | V        |
| Document sharing              | V          | ·                   | ·          | ·            | ·            | V        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Verification                  | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | ·          | ·        | V            | V        |
| Verification workbench        | V          | ·                   | V          | V            | ·            | V        | V         | V   | ·             | ·           | ·          | ·        | V            | V        |
| Rule sets                     | ·          | ·                   | ·          | ·            | ·            | ·        | ·         | ·   | V             | V           | ·          | ·        | ·            | ·        |
| Decisions                     | ·          | ·                   | ·          | ·            | ·            | ·        | ·         | ·   | V             | V           | ·          | ·        | ·            | ·        |
| Automation rules              | V          | ·                   | ·          | ·            | ·            | V        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Performance Dashboard         | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Targets                       | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Leaderboard                   | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Workforce                     | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Connectors                    | V          | ·                   | ·          | ·            | ·            | V        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Commission                    | V          | V                   | o          | o            | V            | o        | V         | o   | o             | o           | o          | o        | o            | o        |
| Ledger                        | V          | V                   | ·          | ·            | V            | ·        | V         | ·   | ·             | ·           | ·          | ·        | ·            | ·        |
| Payouts                       | V          | V                   | ·          | ·            | V            | ·        | V         | ·   | ·             | ·           | ·          | ·        | ·            | ·        |
| Reconciliation                | V          | V                   | ·          | ·            | V            | ·        | V         | ·   | ·             | ·           | ·          | ·        | ·            | ·        |
| Invoices                      | V          | V                   | ·          | ·            | V            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Reports & Catalogue           | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Performance Dashboards        | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Integrations                  | V          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| API management                | V          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Audit                         | ·          | ·                   | V          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Privacy and consent           | V          | ·                   | V          | ·            | ·            | ·        | V         | V   | ·             | ·           | V          | V        | V            | ·        |
| Approvals                     | V          | ·                   | ·          | ·            | ·            | V        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Security events and incidents | ·          | ·                   | V          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Security                      | V          | V                   | V          | V            | V            | V        | V         | V   | V             | V           | V          | V        | V            | V        |
| Organisation                  | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Branches                      | o          | o                   | o          | o            | o            | o        | V         | o   | o             | o           | o          | o        | V            | o        |
| Teams                         | o          | o                   | o          | o            | o            | o        | V         | o   | o             | o           | o          | o        | V            | o        |
| Work queues                   | o          | o                   | o          | o            | o            | o        | V         | o   | o             | o           | o          | o        | V            | o        |
| Users                         | V          | o                   | o          | o            | o            | o        | o         | o   | o             | o           | o          | o        | V            | o        |
| Access control                | V          | ·                   | ·          | ·            | ·            | ·        | h!        | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Configuration                 | ·          | ·                   | ·          | ·            | ·            | ·        | V         | ·   | ·             | ·           | ·          | ·        | V            | ·        |
| Platform Console              | ·          | ·                   | ·          | ·            | ·            | ·        | ·         | ·   | ·             | ·           | ·          | ·        | ·            | ·        |
| Import and export             | V          | o                   | o          | o            | o            | o        | V         | o   | o             | o           | o          | o        | V            | o        |

Cell totals over 14 roles and 48 screens: {"OK":620,"HIDDEN_BUT_API_OPEN":79,"HIDDEN_BUT_API_ALLOWS":1}. `OK` is the sum of visible-and-allowed, hidden-and-denied and open-by-design cells.

## 8. API route inventory (all 378 routes)

Classes: `GATED_RUNTIME` a zero-permission user was refused (403); `GATED_STATIC` the code checks a permission (service or guard) but the probe could not reach it first; `PLATFORM_REALM_GATED`; `PUBLIC_TOKEN` / `PUBLIC_INFRA`; `SELF_SERVICE_OPEN` own data; `DIRECTORY_OPEN` tenant directory; `DEFERRED_STUB`; `NO_GATE_FOUND` needs a fix; `OPEN_CATALOGUE_READ` needs a decision; `UNVERIFIED_NO_GATE_FOUND` static trace found no check and nothing else was proved. Zero-grant columns: status with the stubbed database (no data layer) and, where run, with the real throwaway database.

Totals: PUBLIC_INFRA 2, PLATFORM_REALM_GATED 19, PUBLIC_TOKEN 4, GATED_STATIC 79, GATED_RUNTIME 222, SELF_SERVICE_OPEN 14, DIRECTORY_OPEN 12, NO_GATE_FOUND 15, DEFERRED_STUB 3, OPEN_CATALOGUE_READ 8.

### (no router match) (49)

| Method | Path                                         | Source | Stub | DB  | Class                | Gate                                                                                                                                     | Finding |
| ------ | -------------------------------------------- | ------ | ---- | --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| GET    | /health                                      |        | 200  |     | PUBLIC_INFRA         |                                                                                                                                          |         |
| GET    | /openapi.json                                |        | 200  |     | PUBLIC_INFRA         |                                                                                                                                          |         |
| GET    | /platform/v1/support-access-requests         |        | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused)                                                                     |         |
| GET    | /v1/applications/:id/checklist               |        | 403  |     | GATED_RUNTIME        | application.read                                                                                                                         |         |
| GET    | /v1/applications/:id/eligibility-assessments |        | 403  |     | GATED_RUNTIME        | application.read                                                                                                                         |         |
| POST   | /v1/applications/:id/eligibility-assessments |        | 403  |     | GATED_RUNTIME        | application.read                                                                                                                         |         |
| PUT    | /v1/applications/:id/hold                    |        | 403  |     | GATED_RUNTIME        | application.update                                                                                                                       |         |
| POST   | /v1/applications/:id/transitions             |        | 400  | 400 | GATED_STATIC         | application.update \| application.review \| application.cancel, chosen by the transition (origination/applications/transitions.ts:27-43) |         |
| GET    | /v1/applications/:id                         |        | 403  |     | GATED_RUNTIME        | application.read                                                                                                                         |         |
| PATCH  | /v1/applications/:id                         |        | 403  |     | GATED_RUNTIME        | application.update                                                                                                                       |         |
| GET    | /v1/applications                             |        | 403  |     | GATED_RUNTIME        | application.read                                                                                                                         |         |
| POST   | /v1/complaints/:id/resolution                |        | 403  |     | GATED_RUNTIME        | complaint.manage                                                                                                                         |         |
| GET    | /v1/complaints/:id                           |        | 403  |     | GATED_RUNTIME        | complaint.manage                                                                                                                         |         |
| PATCH  | /v1/complaints/:id                           |        | 403  |     | GATED_RUNTIME        | complaint.manage                                                                                                                         |         |
| GET    | /v1/complaints                               |        | 403  |     | GATED_RUNTIME        | complaint.manage                                                                                                                         |         |
| POST   | /v1/complaints                               |        | 403  |     | GATED_RUNTIME        | complaint.create                                                                                                                         |         |
| POST   | /v1/eligibility-assessments/:id/overrides    |        | 403  |     | GATED_RUNTIME        | eligibility.override                                                                                                                     |         |
| PATCH  | /v1/empanelments/:id                         |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| DELETE | /v1/lenders/:id/contacts/:contactId          |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/lenders/:id/contacts                     |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| PUT    | /v1/lenders/:id/contacts                     |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/lenders/:id/empanelments                 |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| POST   | /v1/lenders/:id/empanelments                 |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/lenders/:id                              |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| PATCH  | /v1/lenders/:id                              |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/lenders                                  |        | 500  | 200 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| POST   | /v1/lenders                                  |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/organisations/:id                        |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| PATCH  | /v1/organisations/:id                        |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/organisations                            |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/product-versions/:id                     |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| POST   | /v1/products/:id/status                      |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/products/:id/versions                    |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| POST   | /v1/products/:id/versions                    |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/products/:id                             |        | 500  | 404 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| PATCH  | /v1/products/:id                             |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/products                                 |        | 500  | 200 | OPEN_CATALOGUE_READ  | none                                                                                                                                     | F-21    |
| POST   | /v1/products                                 |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/support-access-requests                  |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| PUT    | /v1/teams/:id/members                        |        | 403  |     | GATED_RUNTIME        | user.manage                                                                                                                              |         |
| GET    | /v1/teams/:id                                |        | 500  | 404 | DIRECTORY_OPEN       | any signed-in user (tenant directory)                                                                                                    | F-16    |
| PATCH  | /v1/teams/:id                                |        | 403  |     | GATED_RUNTIME        | config.manage \| user.manage                                                                                                             |         |
| GET    | /v1/teams                                    |        | 500  | 200 | DIRECTORY_OPEN       | any signed-in user (tenant directory)                                                                                                    | F-16    |
| POST   | /v1/teams                                    |        | 422  | 422 | DIRECTORY_OPEN       | any signed-in user (tenant directory)                                                                                                    | F-16    |
| PUT    | /v1/work-queues/:id/members                  |        | 403  |     | GATED_RUNTIME        | user.manage                                                                                                                              |         |
| GET    | /v1/work-queues/:id                          |        | 500  | 404 | DIRECTORY_OPEN       | any signed-in user (tenant directory)                                                                                                    | F-16    |
| PATCH  | /v1/work-queues/:id                          |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |
| GET    | /v1/work-queues                              |        | 500  | 200 | DIRECTORY_OPEN       | any signed-in user (tenant directory)                                                                                                    | F-16    |
| POST   | /v1/work-queues                              |        | 403  |     | GATED_RUNTIME        | config.manage                                                                                                                            |         |

### audit (9)

| Method | Path                                 | Source              | Stub | DB  | Class         | Gate                  | Finding |
| ------ | ------------------------------------ | ------------------- | ---- | --- | ------------- | --------------------- | ------- |
| POST   | /v1/audit-chain/seal                 | audit/router.ts:111 | 403  |     | GATED_RUNTIME | audit.read            |         |
| GET    | /v1/audit-chain/verification         | audit/router.ts:97  | 403  |     | GATED_RUNTIME | audit.read            |         |
| GET    | /v1/audit-events/:id/decision-record | audit/router.ts:68  | 403  |     | GATED_RUNTIME | audit.read            |         |
| GET    | /v1/audit-events/:id                 | audit/router.ts:46  | 403  |     | GATED_RUNTIME | audit.read            |         |
| GET    | /v1/audit-events                     | audit/router.ts:30  | 403  |     | GATED_RUNTIME | audit.read            |         |
| GET    | /v1/evidence-packs/:id/download      | audit/router.ts:218 | 403  |     | GATED_RUNTIME | audit.export_evidence |         |
| GET    | /v1/evidence-packs/:id               | audit/router.ts:177 | 403  |     | GATED_RUNTIME | audit.export_evidence |         |
| GET    | /v1/evidence-packs                   | audit/router.ts:270 | 403  |     | GATED_RUNTIME | audit.export_evidence |         |
| POST   | /v1/evidence-packs                   | audit/router.ts:125 | 403  |     | GATED_RUNTIME | audit.export_evidence |         |

### automation (18)

| Method | Path                                                          | Source                   | Stub | DB  | Class         | Gate                | Finding |
| ------ | ------------------------------------------------------------- | ------------------------ | ---- | --- | ------------- | ------------------- | ------- |
| POST   | /v1/automations/:id/execute                                   | automation/router.ts:659 | 403  |     | GATED_RUNTIME | automation.execute  |         |
| POST   | /v1/automations/:id/versions/:versionId/review                | automation/router.ts:569 | 403  |     | GATED_RUNTIME | automation.approve  |         |
| GET    | /v1/automations/:id/versions/:versionId                       | automation/router.ts:554 | 403  |     | GATED_RUNTIME | automation.read     |         |
| GET    | /v1/automations/:id/versions                                  | automation/router.ts:468 | 403  |     | GATED_RUNTIME | automation.read     |         |
| POST   | /v1/automations/:id/versions                                  | automation/router.ts:485 | 403  |     | GATED_RUNTIME | automation.author   |         |
| GET    | /v1/automations/:id                                           | automation/router.ts:398 | 403  |     | GATED_RUNTIME | automation.read     |         |
| PATCH  | /v1/automations/:id                                           | automation/router.ts:414 | 403  |     | GATED_RUNTIME | automation.author   |         |
| POST   | /v1/automations/dead-letters/:id/resolve                      | automation/router.ts:378 | 403  |     | GATED_RUNTIME | automation.operator |         |
| GET    | /v1/automations/dead-letters/:id                              | automation/router.ts:363 | 403  |     | GATED_RUNTIME | automation.read     |         |
| GET    | /v1/automations/dead-letters                                  | automation/router.ts:346 | 403  |     | GATED_RUNTIME | automation.read     |         |
| POST   | /v1/automations/executions/:executionId/cancel                | automation/router.ts:255 | 403  |     | GATED_RUNTIME | automation.operator |         |
| POST   | /v1/automations/executions/:executionId/resume                | automation/router.ts:269 | 403  |     | GATED_RUNTIME | automation.operator |         |
| POST   | /v1/automations/executions/:executionId/steps/:stepIndex/skip | automation/router.ts:283 | 403  |     | GATED_RUNTIME | automation.operator |         |
| GET    | /v1/automations/executions/:executionId/steps                 | automation/router.ts:238 | 403  |     | GATED_RUNTIME | automation.read     |         |
| GET    | /v1/automations/executions/:executionId                       | automation/router.ts:223 | 403  |     | GATED_RUNTIME | automation.read     |         |
| GET    | /v1/automations/executions                                    | automation/router.ts:199 | 403  |     | GATED_RUNTIME | automation.read     |         |
| GET    | /v1/automations                                               | automation/router.ts:91  | 403  |     | GATED_RUNTIME | automation.read     |         |
| POST   | /v1/automations                                               | automation/router.ts:108 | 403  |     | GATED_RUNTIME | automation.author   |         |

### compliance (6)

| Method | Path                                | Source                  | Stub | DB  | Class         | Gate                                                              | Finding |
| ------ | ----------------------------------- | ----------------------- | ---- | --- | ------------- | ----------------------------------------------------------------- | ------- |
| POST   | /v1/compliance/consent-check        | compliance/router.ts:81 | 422  | 422 | GATED_STATIC  | audit.read \| customer.read (compliance-service.ts:19 checkAuthz) |         |
| GET    | /v1/compliance/data-sharing-records | compliance/router.ts:46 | 403  |     | GATED_RUNTIME | customer.read \| audit.read                                       |         |
| GET    | /v1/compliance/stats                | compliance/router.ts:63 | 403  |     | GATED_RUNTIME | customer.read \| audit.read                                       |         |
| POST   | /v1/privacy/consent-check           | compliance/router.ts:82 | 422  | 422 | GATED_STATIC  | audit.read \| customer.read (compliance-service.ts:19 checkAuthz) |         |
| GET    | /v1/privacy/data-sharing-records    | compliance/router.ts:47 | 403  |     | GATED_RUNTIME | customer.read \| audit.read                                       |         |
| GET    | /v1/privacy/stats                   | compliance/router.ts:64 | 403  |     | GATED_RUNTIME | customer.read \| audit.read                                       |         |

### crm/activities (5)

| Method | Path               | Source                       | Stub | DB  | Class         | Gate                                                                                        | Finding |
| ------ | ------------------ | ---------------------------- | ---- | --- | ------------- | ------------------------------------------------------------------------------------------- | ------- |
| GET    | /v1/activities/:id | crm/activities/router.ts:97  | 500  | 404 | GATED_STATIC  | subject permission via subjectFor (activity-service.ts)                                     |         |
| PATCH  | /v1/activities/:id | crm/activities/router.ts:69  | 403  |     | GATED_RUNTIME | activity.update                                                                             |         |
| GET    | /v1/activities     | crm/activities/router.ts:136 | 500  | 200 | GATED_STATIC  | own feed only; subject reads need the subject read permission (activity-service.ts:367-395) |         |
| POST   | /v1/activities     | crm/activities/router.ts:30  | 422  | 422 | GATED_STATIC  | activity.create                                                                             |         |
| GET    | /v1/timeline       | crm/activities/router.ts:151 | 422  | 422 | GATED_STATIC  | subject permission via subjectFor (activity-service.ts)                                     |         |

### crm/customers (9)

| Method | Path                          | Source                      | Stub | DB  | Class         | Gate                                         | Finding |
| ------ | ----------------------------- | --------------------------- | ---- | --- | ------------- | -------------------------------------------- | ------- |
| POST   | /v1/consents/:id/withdrawal   | crm/customers/router.ts:187 | 422  | 422 | GATED_STATIC  | consent.record                               |         |
| GET    | /v1/customers/:id/consents    | crm/customers/router.ts:154 | 403  |     | GATED_RUNTIME | customer.read                                |         |
| POST   | /v1/customers/:id/consents    | crm/customers/router.ts:166 | 422  | 422 | GATED_STATIC  | consent.record \| customer.read              |         |
| PUT    | /v1/customers/:id/preferences | crm/customers/router.ts:208 | 409  | 409 | DEFERRED_STUB | always answers 409 INVALID_STATE (deferred)  |         |
| POST   | /v1/customers/:id/reveal      | crm/customers/router.ts:146 | 403  |     | GATED_RUNTIME | composite (permission + step-up / ownership) |         |
| GET    | /v1/customers/:id             | crm/customers/router.ts:114 | 403  |     | GATED_RUNTIME | customer.read                                |         |
| PATCH  | /v1/customers/:id             | crm/customers/router.ts:127 | 403  |     | GATED_RUNTIME | customer.update                              |         |
| GET    | /v1/customers                 | crm/customers/router.ts:98  | 403  |     | GATED_RUNTIME | customer.read                                |         |
| POST   | /v1/customers                 | crm/customers/router.ts:77  | 422  | 422 | GATED_STATIC  | customer.create                              |         |

### crm/leads (8)

| Method | Path                      | Source                  | Stub | DB  | Class         | Gate                                                                       | Finding |
| ------ | ------------------------- | ----------------------- | ---- | --- | ------------- | -------------------------------------------------------------------------- | ------- |
| POST   | /v1/leads/:id/assignments | crm/leads/router.ts:171 | 422  | 422 | GATED_STATIC  | lead.assign \| lead.reopen \| lead.update                                  |         |
| POST   | /v1/leads/:id/conversion  | crm/leads/router.ts:194 | 422  | 422 | GATED_STATIC  | application.create \| lead.reopen \| lead.update                           |         |
| POST   | /v1/leads/:id/conversions | crm/leads/router.ts:194 | 422  | 422 | GATED_STATIC  | application.create \| lead.reopen \| lead.update                           |         |
| POST   | /v1/leads/:id/transitions | crm/leads/router.ts:148 | 422  | 422 | GATED_STATIC  | lead.reopen \| lead.update                                                 |         |
| GET    | /v1/leads/:id             | crm/leads/router.ts:116 | 500  | 403 | GATED_STATIC  | lead.read \| lead.reopen \| lead.update \| partner.lead_ingest \| api.read |         |
| PATCH  | /v1/leads/:id             | crm/leads/router.ts:129 | 500  | 422 | GATED_STATIC  | lead.update \| lead.reopen                                                 |         |
| GET    | /v1/leads                 | crm/leads/router.ts:100 | 403  |     | GATED_RUNTIME | lead.read                                                                  |         |
| POST   | /v1/leads                 | crm/leads/router.ts:79  | 422  | 422 | GATED_STATIC  | lead.create                                                                |         |

### crm/messaging (5)

| Method | Path                                                      | Source                      | Stub | DB  | Class         | Gate                                                            | Finding |
| ------ | --------------------------------------------------------- | --------------------------- | ---- | --- | ------------- | --------------------------------------------------------------- | ------- |
| POST   | /public/v1/webhooks/messaging/:provider/:connectionPathId | crm/messaging/router.ts:156 | 404  |     | PUBLIC_TOKEN  | one-time token / webhook secret, not a user session             |         |
| GET    | /v1/message-templates                                     | crm/messaging/router.ts:67  | 403  |     | GATED_RUNTIME | config.manage \| message.send                                   |         |
| POST   | /v1/message-templates                                     | crm/messaging/router.ts:29  | 422  | 422 | GATED_STATIC  | config.manage                                                   |         |
| GET    | /v1/messages                                              | crm/messaging/router.ts:125 | 403  |     | GATED_RUNTIME | config.manage \| message.send                                   |         |
| POST   | /v1/messages                                              | crm/messaging/router.ts:87  | 422  | 422 | GATED_STATIC  | message.send \| config.manage (crm/messaging/send-guard.ts:162) |         |

### crm/notifications (4)

| Method | Path                     | Source                          | Stub | DB  | Class             | Gate                                         | Finding |
| ------ | ------------------------ | ------------------------------- | ---- | --- | ----------------- | -------------------------------------------- | ------- |
| PATCH  | /v1/me                   | crm/notifications/router.ts:112 | 422  | 422 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| POST   | /v1/notifications/read   | crm/notifications/router.ts:54  | 422  | 422 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/notifications/stream | crm/notifications/router.ts:77  | -1   |     | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/notifications        | crm/notifications/router.ts:34  | 500  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |

### crm/targets (5)

| Method | Path                     | Source                    | Stub | DB  | Class         | Gate          | Finding |
| ------ | ------------------------ | ------------------------- | ---- | --- | ------------- | ------------- | ------- |
| POST   | /v1/targets/:id/approval | crm/targets/router.ts:100 | 422  | 400 | GATED_STATIC  | target.manage |         |
| GET    | /v1/targets/:id/history  | crm/targets/router.ts:133 | 403  |     | GATED_RUNTIME | report.read   |         |
| GET    | /v1/targets/:id          | crm/targets/router.ts:122 | 403  |     | GATED_RUNTIME | report.read   |         |
| GET    | /v1/targets              | crm/targets/router.ts:83  | 403  |     | GATED_RUNTIME | report.read   |         |
| POST   | /v1/targets              | crm/targets/router.ts:40  | 400  | 400 | GATED_STATIC  | target.manage |         |

### crm/tasks (7)

| Method | Path                        | Source                  | Stub | DB  | Class         | Gate                                        | Finding |
| ------ | --------------------------- | ----------------------- | ---- | --- | ------------- | ------------------------------------------- | ------- |
| POST   | /v1/tasks/:id/completion    | crm/tasks/router.ts:178 | 500  | 422 | GATED_STATIC  | task.update                                 |         |
| POST   | /v1/tasks/:id/snooze        | crm/tasks/router.ts:208 | 409  | 409 | DEFERRED_STUB | always answers 409 INVALID_STATE (deferred) |         |
| GET    | /v1/tasks/:id               | crm/tasks/router.ts:139 | 500  | 403 | GATED_STATIC  | task.read                                   |         |
| PATCH  | /v1/tasks/:id               | crm/tasks/router.ts:155 | 500  | 422 | GATED_STATIC  | task.update                                 |         |
| POST   | /v1/tasks/bulk-reassignment | crm/tasks/router.ts:216 | 409  | 409 | DEFERRED_STUB | always answers 409 INVALID_STATE (deferred) |         |
| GET    | /v1/tasks                   | crm/tasks/router.ts:115 | 403  |     | GATED_RUNTIME | task.read                                   |         |
| POST   | /v1/tasks                   | crm/tasks/router.ts:90  | 422  | 422 | GATED_STATIC  | task.create                                 |         |

### crm/workforce (10)

| Method | Path                              | Source                      | Stub | DB  | Class             | Gate                                         | Finding |
| ------ | --------------------------------- | --------------------------- | ---- | --- | ----------------- | -------------------------------------------- | ------- |
| POST   | /v1/attendance/check-in           | crm/workforce/router.ts:149 | 500  | 201 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| POST   | /v1/attendance/check-out          | crm/workforce/router.ts:168 | 500  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/attendance/me/today           | crm/workforce/router.ts:187 | 500  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/attendance                    | crm/workforce/router.ts:201 | 500  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| POST   | /v1/delegations/:id/end           | crm/workforce/router.ts:114 | 500  | 404 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| GET    | /v1/delegations                   | crm/workforce/router.ts:131 | 500  | 200 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| POST   | /v1/delegations                   | crm/workforce/router.ts:94  | 422  | 422 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| PATCH  | /v1/me/availability               | crm/workforce/router.ts:49  | 422  | 422 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| PATCH  | /v1/workforce/agents/:id/capacity | crm/workforce/router.ts:69  | 422  | 422 | GATED_STATIC      | user.manage \| config.manage                 |         |
| GET    | /v1/workforce/agents              | crm/workforce/router.ts:53  | 500  | 200 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-11    |

### finance (27)

| Method | Path                                     | Source                | Stub | DB  | Class         | Gate                    | Finding |
| ------ | ---------------------------------------- | --------------------- | ---- | --- | ------------- | ----------------------- | ------- |
| POST   | /v1/clawbacks/:id/approval               | finance/router.ts:260 | 403  |     | GATED_RUNTIME | adjustment.approve      |         |
| POST   | /v1/clawbacks/:id/rejection              | finance/router.ts:274 | 422  | 422 | GATED_STATIC  | adjustment.approve      |         |
| POST   | /v1/clawbacks                            | finance/router.ts:244 | 422  | 422 | GATED_STATIC  | adjustment.create       |         |
| GET    | /v1/commission-calculations/:id          | finance/router.ts:192 | 500  | 404 | NO_GATE_FOUND | none                    | F-01    |
| GET    | /v1/commission-calculations              | finance/router.ts:206 | 500  | 200 | NO_GATE_FOUND | none                    | F-01    |
| GET    | /v1/commission-payables                  | finance/router.ts:224 | 500  | 200 | NO_GATE_FOUND | none                    | F-01    |
| POST   | /v1/commission-plans/:id/approval        | finance/router.ts:155 | 403  |     | GATED_RUNTIME | commission.plan.approve |         |
| GET    | /v1/commission-plans/:id                 | finance/router.ts:121 | 500  | 404 | NO_GATE_FOUND | none                    | F-01    |
| PATCH  | /v1/commission-plans/:id                 | finance/router.ts:136 | 403  |     | GATED_RUNTIME | commission.plan.edit    |         |
| GET    | /v1/commission-plans                     | finance/router.ts:107 | 500  | 200 | NO_GATE_FOUND | none                    | F-01    |
| POST   | /v1/commission-plans                     | finance/router.ts:90  | 422  | 422 | GATED_STATIC  | commission.plan.edit    |         |
| POST   | /v1/commission/calculate                 | finance/router.ts:176 | 422  | 422 | GATED_STATIC  | finance.view            |         |
| GET    | /v1/payout-batches/:id/bank-file         | finance/router.ts:640 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| POST   | /v1/payout-batches/:id/dispatch-gateway  | finance/router.ts:703 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| POST   | /v1/payout-batches                       | finance/router.ts:601 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| POST   | /v1/payout-requests/:id/approval         | finance/router.ts:433 | 403  |     | GATED_RUNTIME | payout.approve          |         |
| POST   | /v1/payout-requests/:id/cancel           | finance/router.ts:474 | 403  |     | GATED_RUNTIME | payout.request          |         |
| POST   | /v1/payout-requests/:id/disburse-gateway | finance/router.ts:662 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| POST   | /v1/payout-requests/:id/payment-failure  | finance/router.ts:557 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| POST   | /v1/payout-requests/:id/payment          | finance/router.ts:514 | 403  |     | GATED_RUNTIME | payout.record_payment   |         |
| GET    | /v1/payout-requests/:id                  | finance/router.ts:417 | 403  |     | GATED_RUNTIME | finance.view            |         |
| GET    | /v1/payout-requests                      | finance/router.ts:398 | 403  |     | GATED_RUNTIME | finance.view            |         |
| POST   | /v1/payout-requests                      | finance/router.ts:357 | 403  |     | GATED_RUNTIME | payout.request          |         |
| POST   | /v1/recalculation-proposals/:id/approval | finance/router.ts:338 | 403  |     | GATED_RUNTIME | adjustment.approve      |         |
| GET    | /v1/recalculation-proposals/:id          | finance/router.ts:323 | 403  |     | GATED_RUNTIME | finance.view            |         |
| GET    | /v1/recalculation-proposals              | finance/router.ts:310 | 403  |     | GATED_RUNTIME | finance.view            |         |
| POST   | /v1/recalculation-proposals              | finance/router.ts:293 | 422  | 422 | GATED_STATIC  | commission.plan.edit    |         |

### integrations (5)

| Method | Path                            | Source                     | Stub | DB  | Class             | Gate                                         | Finding |
| ------ | ------------------------------- | -------------------------- | ---- | --- | ----------------- | -------------------------------------------- | ------- |
| POST   | /v1/integrations/:provider/ping | integrations/router.ts:113 | 403  |     | GATED_RUNTIME     | config.manage \| integration.manage          |         |
| GET    | /v1/integrations/:provider      | integrations/router.ts:69  | 403  |     | GATED_RUNTIME     | config.manage \| integration.read            |         |
| PUT    | /v1/integrations/:provider      | integrations/router.ts:93  | 403  |     | GATED_RUNTIME     | config.manage \| integration.manage          |         |
| GET    | /v1/integrations/capabilities   | integrations/router.ts:40  | 200  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/integrations                | integrations/router.ts:53  | 403  |     | GATED_RUNTIME     | config.manage \| integration.read            |         |

### invoices (6)

| Method | Path                                  | Source                 | Stub | DB  | Class         | Gate                           | Finding |
| ------ | ------------------------------------- | ---------------------- | ---- | --- | ------------- | ------------------------------ | ------- |
| GET    | /v1/connectors/:id/invoice-statements | invoices/router.ts:134 | 403  |     | GATED_RUNTIME | finance.view \| invoice.manage |         |
| POST   | /v1/invoices/:id/status               | invoices/router.ts:102 | 422  | 422 | GATED_STATIC  | invoice.manage                 |         |
| GET    | /v1/invoices/:id                      | invoices/router.ts:83  | 403  |     | GATED_RUNTIME | finance.view \| invoice.manage |         |
| GET    | /v1/invoices                          | invoices/router.ts:64  | 403  |     | GATED_RUNTIME | finance.view \| invoice.manage |         |
| POST   | /v1/invoices                          | invoices/router.ts:44  | 422  | 422 | GATED_STATIC  | invoice.manage                 |         |
| GET    | /v1/portal/connectors/:id/statements  | invoices/router.ts:154 | 403  |     | GATED_RUNTIME | finance.view \| invoice.manage |         |

### ledger (9)

| Method | Path                             | Source               | Stub | DB  | Class         | Gate                                            | Finding |
| ------ | -------------------------------- | -------------------- | ---- | --- | ------------- | ----------------------------------------------- | ------- |
| GET    | /v1/connectors/:id/statements    | ledger/router.ts:208 | 403  |     | GATED_RUNTIME | finance.view                                    |         |
| GET    | /v1/ledger/accounts/:id/balance  | ledger/router.ts:189 | 403  |     | GATED_RUNTIME | finance.view                                    |         |
| GET    | /v1/ledger/accounts              | ledger/router.ts:47  | 403  |     | GATED_RUNTIME | finance.view                                    |         |
| POST   | /v1/ledger/accounts              | ledger/router.ts:66  | 422  | 422 | GATED_STATIC  | finance.view                                    |         |
| POST   | /v1/ledger/exports               | ledger/router.ts:230 | 403  |     | GATED_RUNTIME | composite (permission + step-up / ownership)    |         |
| GET    | /v1/ledger/journals              | ledger/router.ts:82  | 403  |     | GATED_RUNTIME | finance.view                                    |         |
| POST   | /v1/ledger/journals              | ledger/router.ts:101 | 422  | 422 | NO_GATE_FOUND | none                                            | F-03    |
| POST   | /v1/ledger/periods/:period/close | ledger/router.ts:144 | 422  | 422 | GATED_STATIC  | authorization helper with a computed permission |         |
| GET    | /v1/ledger/trial-balance         | ledger/router.ts:246 | 403  |     | GATED_RUNTIME | finance.view                                    |         |

### origination/connectors (17)

| Method | Path                                                 | Source                               | Stub | DB  | Class         | Gate                                         | Finding |
| ------ | ---------------------------------------------------- | ------------------------------------ | ---- | --- | ------------- | -------------------------------------------- | ------- |
| POST   | /v1/attribution-change-requests/:id/approval         | origination/connectors/router.ts:297 | 403  |     | GATED_RUNTIME | connector.attribution_change                 |         |
| GET    | /v1/attribution-change-requests                      | origination/connectors/router.ts:264 | 403  |     | GATED_RUNTIME | connector.attribution_change                 |         |
| POST   | /v1/attribution-change-requests                      | origination/connectors/router.ts:278 | 422  | 422 | GATED_STATIC  | connector.attribution_change                 |         |
| POST   | /v1/attribution-disputes/:id/resolution              | origination/connectors/router.ts:329 | 422  | 400 | GATED_STATIC  | connector.dispute_resolve                    |         |
| GET    | /v1/attribution-disputes                             | origination/connectors/router.ts:315 | 403  |     | GATED_RUNTIME | connector.dispute_resolve                    |         |
| POST   | /v1/connectors/:id/activation                        | origination/connectors/router.ts:118 | 422  | 400 | GATED_STATIC  | connector.manage                             |         |
| GET    | /v1/connectors/:id/agreements                        | origination/connectors/router.ts:215 | 403  |     | GATED_RUNTIME | connector.read                               |         |
| POST   | /v1/connectors/:id/agreements                        | origination/connectors/router.ts:229 | 422  | 422 | GATED_STATIC  | connector.manage                             |         |
| POST   | /v1/connectors/:id/bank-accounts/:accountId/approval | origination/connectors/router.ts:194 | 403  |     | GATED_RUNTIME | connector.bank_change_approve                |         |
| GET    | /v1/connectors/:id/bank-accounts                     | origination/connectors/router.ts:160 | 403  |     | GATED_RUNTIME | connector.read                               |         |
| POST   | /v1/connectors/:id/bank-accounts                     | origination/connectors/router.ts:174 | 422  | 422 | GATED_STATIC  | connector.manage                             |         |
| POST   | /v1/connectors/:id/status                            | origination/connectors/router.ts:139 | 422  | 400 | GATED_STATIC  | connector.manage                             |         |
| POST   | /v1/connectors/:id/users                             | origination/connectors/router.ts:249 | 422  | 422 | GATED_STATIC  | connector.manage                             |         |
| GET    | /v1/connectors/:id                                   | origination/connectors/router.ts:85  | 403  |     | GATED_RUNTIME | connector.read                               |         |
| PATCH  | /v1/connectors/:id                                   | origination/connectors/router.ts:100 | 403  |     | GATED_RUNTIME | composite (permission + step-up / ownership) |         |
| GET    | /v1/connectors                                       | origination/connectors/router.ts:71  | 403  |     | GATED_RUNTIME | connector.read                               |         |
| POST   | /v1/connectors                                       | origination/connectors/router.ts:52  | 422  | 422 | GATED_STATIC  | connector.manage                             |         |

### origination/document-sharing (9)

| Method | Path                                      | Source                                     | Stub | DB  | Class         | Gate                                                | Finding |
| ------ | ----------------------------------------- | ------------------------------------------ | ---- | --- | ------------- | --------------------------------------------------- | ------- |
| POST   | /public/v1/upload/:token/files            | origination/document-sharing/router.ts:201 | 401  |     | PUBLIC_TOKEN  | one-time token / webhook secret, not a user session |         |
| POST   | /public/v1/upload/:token/otp-verification | origination/document-sharing/router.ts:185 | 422  |     | PUBLIC_TOKEN  | one-time token / webhook secret, not a user session |         |
| GET    | /public/v1/upload/:token                  | origination/document-sharing/router.ts:170 | 404  |     | PUBLIC_TOKEN  | one-time token / webhook secret, not a user session |         |
| POST   | /v1/shares/:id/revocation                 | origination/document-sharing/router.ts:124 | 403  |     | GATED_RUNTIME | share.create                                        |         |
| GET    | /v1/shares                                | origination/document-sharing/router.ts:141 | 403  |     | GATED_RUNTIME | customer.read                                       |         |
| POST   | /v1/shares                                | origination/document-sharing/router.ts:90  | 403  |     | GATED_RUNTIME | share.create                                        |         |
| POST   | /v1/upload-links/:id/revocation           | origination/document-sharing/router.ts:73  | 403  |     | GATED_RUNTIME | document.upload                                     |         |
| GET    | /v1/upload-links                          | origination/document-sharing/router.ts:57  | 403  |     | GATED_RUNTIME | document.upload                                     |         |
| POST   | /v1/upload-links                          | origination/document-sharing/router.ts:23  | 403  |     | GATED_RUNTIME | document.upload                                     |         |

### origination/lender-cases (9)

| Method | Path                                | Source                                 | Stub | DB  | Class         | Gate                      | Finding |
| ------ | ----------------------------------- | -------------------------------------- | ---- | --- | ------------- | ------------------------- | ------- |
| GET    | /v1/applications/:id/lender-cases   | origination/lender-cases/router.ts:106 | 403  |     | GATED_RUNTIME | application.read          |         |
| POST   | /v1/applications/:id/lender-cases   | origination/lender-cases/router.ts:83  | 422  | 422 | GATED_STATIC  | lender_case.submit        |         |
| POST   | /v1/lender-cases/:id/package        | origination/lender-cases/router.ts:157 | 403  |     | GATED_RUNTIME | lender_case.submit        |         |
| POST   | /v1/lender-cases/:id/queries        | origination/lender-cases/router.ts:232 | 422  | 422 | GATED_STATIC  | lender_case.update_status |         |
| POST   | /v1/lender-cases/:id/status-updates | origination/lender-cases/router.ts:203 | 422  | 422 | GATED_STATIC  | lender_case.update_status |         |
| POST   | /v1/lender-cases/:id/submission     | origination/lender-cases/router.ts:180 | 422  | 422 | GATED_STATIC  | lender_case.submit        |         |
| GET    | /v1/lender-cases/:id                | origination/lender-cases/router.ts:141 | 403  |     | GATED_RUNTIME | application.read          |         |
| GET    | /v1/lender-cases                    | origination/lender-cases/router.ts:121 | 403  |     | GATED_RUNTIME | application.read          |         |
| POST   | /v1/lender-queries/:id/responses    | origination/lender-cases/router.ts:255 | 422  | 422 | GATED_STATIC  | lender_case.update_status |         |

### origination/sanctions (12)

| Method | Path                                | Source                              | Stub | DB  | Class         | Gate                           | Finding |
| ------ | ----------------------------------- | ----------------------------------- | ---- | --- | ------------- | ------------------------------ | ------- |
| GET    | /v1/disbursements                   | origination/sanctions/router.ts:95  | 500  | 200 | NO_GATE_FOUND | none                           | F-02    |
| GET    | /v1/lender-cases/:id/sanctions      | origination/sanctions/router.ts:68  | 500  | 404 | NO_GATE_FOUND | none                           | F-02    |
| POST   | /v1/lender-cases/:id/sanctions      | origination/sanctions/router.ts:46  | 422  | 422 | GATED_STATIC  | sanction.record                |         |
| POST   | /v1/sanctions/:id/cancellation      | origination/sanctions/router.ts:123 | 422  | 422 | GATED_STATIC  | sanction.record                |         |
| GET    | /v1/sanctions/:id/tranches          | origination/sanctions/router.ts:167 | 500  | 404 | NO_GATE_FOUND | none                           | F-02    |
| POST   | /v1/sanctions/:id/tranches          | origination/sanctions/router.ts:145 | 422  | 422 | GATED_STATIC  | disbursement.record            |         |
| GET    | /v1/sanctions/:id                   | origination/sanctions/router.ts:110 | 500  | 404 | NO_GATE_FOUND | none                           | F-02    |
| GET    | /v1/sanctions                       | origination/sanctions/router.ts:80  | 500  | 200 | NO_GATE_FOUND | none                           | F-02    |
| POST   | /v1/tranches/:id/exception-approval | origination/sanctions/router.ts:214 | 422  | 422 | GATED_STATIC  | disbursement.exception_approve |         |
| POST   | /v1/tranches/:id/verification       | origination/sanctions/router.ts:192 | 422  | 422 | GATED_STATIC  | disbursement.verify            |         |
| POST   | /v1/tranches/:id/void               | origination/sanctions/router.ts:236 | 422  | 422 | GATED_STATIC  | disbursement.record            |         |
| GET    | /v1/tranches/:id                    | origination/sanctions/router.ts:179 | 500  | 404 | NO_GATE_FOUND | none                           | F-02    |

### origination/verifications (3)

| Method | Path                  | Source                                 | Stub | DB  | Class         | Gate                 | Finding |
| ------ | --------------------- | -------------------------------------- | ---- | --- | ------------- | -------------------- | ------- |
| GET    | /v1/verifications/:id | origination/verifications/router.ts:71 | 403  |     | GATED_RUNTIME | verification.read    |         |
| GET    | /v1/verifications     | origination/verifications/router.ts:54 | 403  |     | GATED_RUNTIME | verification.read    |         |
| POST   | /v1/verifications     | origination/verifications/router.ts:20 | 403  |     | GATED_RUNTIME | verification.perform |         |

### partner-api (19)

| Method | Path                                                  | Source                    | Stub | DB  | Class             | Gate                                         | Finding |
| ------ | ----------------------------------------------------- | ------------------------- | ---- | --- | ----------------- | -------------------------------------------- | ------- |
| POST   | /v1/api-clients/:id/rotate-secret                     | partner-api/router.ts:319 | 403  |     | GATED_RUNTIME     | config.manage \| api.manage                  |         |
| DELETE | /v1/api-clients/:id                                   | partner-api/router.ts:309 | 403  |     | GATED_RUNTIME     | config.manage \| api.manage                  |         |
| GET    | /v1/api-clients/:id                                   | partner-api/router.ts:288 | 403  |     | GATED_RUNTIME     | config.manage \| api.read \| api.manage      |         |
| PATCH  | /v1/api-clients/:id                                   | partner-api/router.ts:298 | 403  |     | GATED_RUNTIME     | config.manage \| api.manage                  |         |
| GET    | /v1/api-clients                                       | partner-api/router.ts:267 | 403  |     | GATED_RUNTIME     | config.manage \| api.read \| api.manage      |         |
| POST   | /v1/api-clients                                       | partner-api/router.ts:277 | 422  | 422 | GATED_STATIC      | api.manage \| config.manage                  |         |
| POST   | /v1/partner/api-keys                                  | partner-api/router.ts:82  | 422  | 422 | GATED_STATIC      | api.manage \| config.manage                  |         |
| POST   | /v1/partner/applications/:id/documents/upload-session | partner-api/router.ts:176 | 422  | 422 | GATED_STATIC      | partner.lead_ingest \| document.upload       |         |
| GET    | /v1/partner/applications/:id/offers                   | partner-api/router.ts:162 | 403  |     | GATED_RUNTIME     | application.read \| partner.application_read |         |
| GET    | /v1/partner/applications/:id                          | partner-api/router.ts:152 | 403  |     | GATED_RUNTIME     | application.read \| partner.application_read |         |
| POST   | /v1/partner/applications                              | partner-api/router.ts:137 | 422  | 422 | GATED_STATIC      | partner.lead_ingest \| application.create    |         |
| GET    | /v1/partner/leads/:id                                 | partner-api/router.ts:112 | 403  |     | GATED_RUNTIME     | lead.read \| api.read \| partner.lead_ingest |         |
| GET    | /v1/partner/leads                                     | partner-api/router.ts:122 | 403  |     | GATED_RUNTIME     | lead.read \| api.read \| partner.lead_ingest |         |
| POST   | /v1/partner/leads                                     | partner-api/router.ts:97  | 422  | 422 | GATED_STATIC      | partner.lead_ingest \| lead.create           |         |
| POST   | /v1/partner/sandbox/echo                              | partner-api/router.ts:234 | 200  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| POST   | /v1/partner/sandbox/simulate-event                    | partner-api/router.ts:252 | 422  | 422 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| DELETE | /v1/partner/webhooks/subscriptions/:id                | partner-api/router.ts:220 | 403  |     | GATED_RUNTIME     | config.manage \| webhook.manage              |         |
| GET    | /v1/partner/webhooks/subscriptions                    | partner-api/router.ts:210 | 403  |     | GATED_RUNTIME     | config.manage \| api.read \| webhook.manage  |         |
| POST   | /v1/partner/webhooks/subscriptions                    | partner-api/router.ts:199 | 422  | 422 | GATED_STATIC      | webhook.manage \| config.manage              |         |

### platform (23)

| Method | Path                          | Source                  | Stub | DB  | Class             | Gate                                         | Finding |
| ------ | ----------------------------- | ----------------------- | ---- | --- | ----------------- | -------------------------------------------- | ------- |
| POST   | /v1/branches/:id/deactivation | platform/router.ts:453  | 403  |     | GATED_RUNTIME     | config.manage                                |         |
| GET    | /v1/branches/:id              | platform/router.ts:286  | 500  | 404 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| PATCH  | /v1/branches/:id              | platform/router.ts:548  | 403  |     | GATED_RUNTIME     | config.manage                                |         |
| GET    | /v1/branches                  | platform/router.ts:241  | 500  | 200 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| POST   | /v1/branches                  | platform/router.ts:332  | 403  |     | GATED_RUNTIME     | config.manage                                |         |
| GET    | /v1/config                    | platform/router.ts:658  | 403  |     | GATED_RUNTIME     | config.manage                                |         |
| PATCH  | /v1/config                    | platform/router.ts:741  | 403  |     | GATED_RUNTIME     | config.manage                                |         |
| GET    | /v1/me                        | platform/router.ts:125  | 200  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/permissions               | platform/router.ts:927  | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| DELETE | /v1/roles/:id                 | platform/router.ts:1244 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| GET    | /v1/roles/:id                 | platform/router.ts:957  | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| PATCH  | /v1/roles/:id                 | platform/router.ts:1087 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| GET    | /v1/roles                     | platform/router.ts:882  | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| POST   | /v1/roles                     | platform/router.ts:1008 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| GET    | /v1/tenant                    | platform/router.ts:205  | 500  | 200 | SELF_SERVICE_OPEN | any signed-in user (own data / tenant facts) |         |
| GET    | /v1/users/:id/permissions     | platform/router.ts:1874 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| DELETE | /v1/users/:id/roles/:roleId   | platform/router.ts:1771 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| GET    | /v1/users/:id/roles           | platform/router.ts:1817 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| POST   | /v1/users/:id/roles           | platform/router.ts:1698 | 403  |     | GATED_RUNTIME     | user.manage \| role.manage                   |         |
| GET    | /v1/users/:id                 | platform/router.ts:1403 | 403  |     | GATED_RUNTIME     | user.manage                                  |         |
| PATCH  | /v1/users/:id                 | platform/router.ts:1551 | 403  |     | GATED_RUNTIME     | user.manage                                  |         |
| GET    | /v1/users                     | platform/router.ts:1326 | 500  | 200 | DIRECTORY_OPEN    | any signed-in user (tenant directory)        | F-16    |
| POST   | /v1/users                     | platform/router.ts:1446 | 403  |     | GATED_RUNTIME     | user.manage                                  |         |

### platform-admin (24)

| Method | Path                                       | Source                       | Stub | DB  | Class                | Gate                                                                 | Finding |
| ------ | ------------------------------------------ | ---------------------------- | ---- | --- | -------------------- | -------------------------------------------------------------------- | ------- |
| POST   | /platform/v1/dead-letters/:id/discard      | platform-admin/router.ts:321 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /platform/v1/dead-letters/:id/replay       | platform-admin/router.ts:306 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/flags/:key                    | platform-admin/router.ts:175 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| PUT    | /platform/v1/flags/:key                    | platform-admin/router.ts:186 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/flags                         | platform-admin/router.ts:167 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/health                        | platform-admin/router.ts:339 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/jobs                          | platform-admin/router.ts:264 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /platform/v1/master-data/imports           | platform-admin/router.ts:242 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/master-data                   | platform-admin/router.ts:234 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /platform/v1/queues/:queue/pause           | platform-admin/router.ts:272 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /platform/v1/queues/:queue/resume          | platform-admin/router.ts:289 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| PUT    | /platform/v1/releases/:version             | platform-admin/router.ts:445 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/releases                      | platform-admin/router.ts:437 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /platform/v1/support-access-requests       | platform-admin/router.ts:369 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| PUT    | /platform/v1/tenants/:tenantId/flags/:key  | platform-admin/router.ts:214 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/tenants/:tenantId/flags       | platform-admin/router.ts:206 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/tenants/:tenantId             | platform-admin/router.ts:149 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| GET    | /platform/v1/tenants                       | platform-admin/router.ts:139 | 403  |     | PLATFORM_REALM_GATED | platform.* permission AND platform-realm user (tenant users refused) |         |
| POST   | /v1/data-corrections/:id/approval          | platform-admin/router.ts:416 | 403  |     | GATED_RUNTIME        | data_correction.approve                                              |         |
| POST   | /v1/data-corrections/:id/execute           | platform-admin/router.ts:426 | 403  |     | GATED_RUNTIME        | composite (permission + step-up / ownership)                         |         |
| GET    | /v1/data-corrections                       | platform-admin/router.ts:399 | 403  |     | GATED_RUNTIME        | data_correction.request                                              |         |
| POST   | /v1/data-corrections                       | platform-admin/router.ts:407 | 403  |     | GATED_RUNTIME        | data_correction.request                                              |         |
| POST   | /v1/support-access-requests/:id/approval   | platform-admin/router.ts:378 | 403  |     | GATED_RUNTIME        | config.manage                                                        |         |
| POST   | /v1/support-access-requests/:id/revocation | platform-admin/router.ts:387 | 403  |     | GATED_RUNTIME        | config.manage                                                        |         |

### platform/imports (7)

| Method | Path                     | Source                         | Stub | DB  | Class         | Gate                                                          | Finding |
| ------ | ------------------------ | ------------------------------ | ---- | --- | ------------- | ------------------------------------------------------------- | ------- |
| POST   | /v1/imports/:id/commit   | platform/imports/router.ts:86  | 500  | 404 | GATED_STATIC  | import.run \| customer.create \| lead.create \| config.manage |         |
| POST   | /v1/imports/:id/mapping  | platform/imports/router.ts:66  | 422  | 422 | GATED_STATIC  | import.run \| customer.create \| lead.create \| config.manage |         |
| GET    | /v1/imports/:id/report   | platform/imports/router.ts:138 | 500  | 404 | GATED_STATIC  | customer.create \| lead.create \| import.run \| config.manage |         |
| POST   | /v1/imports/:id/rollback | platform/imports/router.ts:106 | 422  | 422 | GATED_STATIC  | import.run \| customer.create \| lead.create \| config.manage |         |
| GET    | /v1/imports/:id          | platform/imports/router.ts:126 | 500  | 404 | GATED_STATIC  | customer.create \| lead.create \| import.run \| config.manage |         |
| GET    | /v1/imports              | platform/imports/router.ts:152 | 500  | 200 | NO_GATE_FOUND | none                                                          | F-06    |
| POST   | /v1/imports              | platform/imports/router.ts:41  | 422  | 422 | GATED_STATIC  | import.run \| customer.create \| lead.create \| config.manage |         |

### reconciliation (15)

| Method | Path                                          | Source                       | Stub | DB  | Class         | Gate               | Finding |
| ------ | --------------------------------------------- | ---------------------------- | ---- | --- | ------------- | ------------------ | ------- |
| POST   | /v1/adjustments/:id/approval                  | reconciliation/router.ts:230 | 422  | 422 | GATED_STATIC  | adjustment.approve |         |
| GET    | /v1/adjustments                               | reconciliation/router.ts:247 | 403  |     | GATED_RUNTIME | finance.view       |         |
| POST   | /v1/adjustments                               | reconciliation/router.ts:214 | 422  | 422 | GATED_STATIC  | adjustment.create  |         |
| PATCH  | /v1/disputes/:id                              | reconciliation/router.ts:302 | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |
| GET    | /v1/disputes                                  | reconciliation/router.ts:325 | 403  |     | GATED_RUNTIME | finance.view       |         |
| POST   | /v1/disputes                                  | reconciliation/router.ts:262 | 422  | 422 | GATED_STATIC  | finance.dispute    |         |
| POST   | /v1/lender-statements/:id/match               | reconciliation/router.ts:165 | 403  |     | GATED_RUNTIME | finance.reconcile  |         |
| GET    | /v1/lender-statements/:id                     | reconciliation/router.ts:151 | 403  |     | GATED_RUNTIME | finance.view       |         |
| POST   | /v1/lender-statements/auto-ingest             | reconciliation/router.ts:118 | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |
| GET    | /v1/lender-statements                         | reconciliation/router.ts:137 | 403  |     | GATED_RUNTIME | finance.view       |         |
| POST   | /v1/lender-statements                         | reconciliation/router.ts:74  | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |
| POST   | /v1/reconciliation-exceptions/:id/resolution  | reconciliation/router.ts:197 | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |
| GET    | /v1/reconciliation-exceptions                 | reconciliation/router.ts:181 | 403  |     | GATED_RUNTIME | finance.view       |         |
| POST   | /v1/reconciliation/auto-ingest                | reconciliation/router.ts:118 | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |
| POST   | /v1/reconciliation/payouts/:id/bank-reconcile | reconciliation/router.ts:343 | 422  | 422 | GATED_STATIC  | finance.reconcile  |         |

### reporting (19)

| Method | Path                         | Source                  | Stub | DB  | Class         | Gate                                              | Finding |
| ------ | ---------------------------- | ----------------------- | ---- | --- | ------------- | ------------------------------------------------- | ------- |
| GET    | /v1/dashboards/:code         | reporting/router.ts:128 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/exports/:id/download     | reporting/router.ts:231 | 403  |     | GATED_RUNTIME | config.manage \| export.run                       |         |
| GET    | /v1/exports/:id              | reporting/router.ts:222 | 403  |     | GATED_RUNTIME | config.manage \| export.run                       |         |
| GET    | /v1/exports                  | reporting/router.ts:244 | 403  |     | GATED_RUNTIME | config.manage \| export.run                       |         |
| POST   | /v1/exports                  | reporting/router.ts:206 | 422  | 422 | GATED_STATIC  | export.run \| config.manage                       |         |
| GET    | /v1/metric-definitions/:code | reporting/router.ts:79  | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/metric-definitions       | reporting/router.ts:71  | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/metrics/definitions      | reporting/router.ts:63  | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/metrics                  | reporting/router.ts:47  | 422  | 422 | GATED_STATIC  | report.read \| report.manage \| config.manage     |         |
| GET    | /v1/report-runs/:id/download | reporting/router.ts:182 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/report-runs/:id          | reporting/router.ts:173 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/report-runs              | reporting/router.ts:195 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| DELETE | /v1/report-schedules/:id     | reporting/router.ts:278 | 403  |     | GATED_RUNTIME | config.manage \| report.manage \| report.schedule |         |
| GET    | /v1/report-schedules         | reporting/router.ts:270 | 403  |     | GATED_RUNTIME | config.manage \| report.manage \| report.schedule |         |
| POST   | /v1/report-schedules         | reporting/router.ts:252 | 422  | 422 | GATED_STATIC  | report.schedule \| report.manage \| config.manage |         |
| GET    | /v1/reporting/control-totals | reporting/router.ts:93  | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| POST   | /v1/reporting/refresh        | reporting/router.ts:107 | 422  | 422 | GATED_STATIC  | report.manage \| config.manage                    |         |
| POST   | /v1/reports/:code/runs       | reporting/router.ts:156 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |
| GET    | /v1/reports                  | reporting/router.ts:150 | 403  |     | GATED_RUNTIME | config.manage \| report.read \| report.manage     |         |

### rules/api (27)

| Method | Path                                             | Source                  | Stub | DB  | Class         | Gate                         | Finding |
| ------ | ------------------------------------------------ | ----------------------- | ---- | --- | ------------- | ---------------------------- | ------- |
| GET    | /v1/decision-definitions/:key                    | rules/api/router.ts:143 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| GET    | /v1/decision-definitions                         | rules/api/router.ts:128 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| GET    | /v1/decision-records/:id                         | rules/api/router.ts:741 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| GET    | /v1/decision-records                             | rules/api/router.ts:724 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| POST   | /v1/decisions/:decisionKey/evaluations           | rules/api/router.ts:673 | 422  | 422 | NO_GATE_FOUND | none                         | F-05    |
| POST   | /v1/rule-set-versions/:versionId/impact-analyses | rules/api/router.ts:413 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| POST   | /v1/rule-set-versions/:versionId/publish         | rules/api/router.ts:562 | 403  |     | GATED_RUNTIME | rule.publish                 |         |
| POST   | /v1/rule-set-versions/:versionId/reinstate       | rules/api/router.ts:608 | 403  |     | GATED_RUNTIME | rule.suspend                 |         |
| POST   | /v1/rule-set-versions/:versionId/retire          | rules/api/router.ts:631 | 403  |     | GATED_RUNTIME | rule.publish                 |         |
| POST   | /v1/rule-set-versions/:versionId/reviews         | rules/api/router.ts:539 | 403  |     | GATED_RUNTIME | rule.approve                 |         |
| POST   | /v1/rule-set-versions/:versionId/simulations     | rules/api/router.ts:306 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| POST   | /v1/rule-set-versions/:versionId/submit          | rules/api/router.ts:518 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| POST   | /v1/rule-set-versions/:versionId/suspend         | rules/api/router.ts:585 | 403  |     | GATED_RUNTIME | rule.suspend                 |         |
| POST   | /v1/rule-set-versions/:versionId/validate        | rules/api/router.ts:283 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| GET    | /v1/rule-set-versions/:versionId                 | rules/api/router.ts:247 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| PUT    | /v1/rule-set-versions/:versionId                 | rules/api/router.ts:263 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| POST   | /v1/rule-sets/:ruleSetId/comparisons             | rules/api/router.ts:345 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| POST   | /v1/rule-sets/:ruleSetId/rollbacks               | rules/api/router.ts:652 | 403  |     | GATED_RUNTIME | rule.publish                 |         |
| GET    | /v1/rule-sets/:ruleSetId/test-cases              | rules/api/router.ts:464 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| POST   | /v1/rule-sets/:ruleSetId/test-cases              | rules/api/router.ts:479 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| GET    | /v1/rule-sets/:ruleSetId/versions                | rules/api/router.ts:213 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| POST   | /v1/rule-sets/:ruleSetId/versions                | rules/api/router.ts:228 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| GET    | /v1/rule-sets/:ruleSetId                         | rules/api/router.ts:197 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| GET    | /v1/rule-sets                                    | rules/api/router.ts:180 | 403  |     | GATED_RUNTIME | rule.author \| rule.simulate |         |
| POST   | /v1/rule-sets                                    | rules/api/router.ts:160 | 403  |     | GATED_RUNTIME | rule.author                  |         |
| GET    | /v1/rule-simulations/:simulationId               | rules/api/router.ts:330 | 403  |     | GATED_RUNTIME | rule.simulate                |         |
| PUT    | /v1/rule-test-cases/:testCaseId                  | rules/api/router.ts:498 | 403  |     | GATED_RUNTIME | rule.author                  |         |

### security (6)

| Method | Path                | Source                 | Stub | DB  | Class         | Gate              | Finding |
| ------ | ------------------- | ---------------------- | ---- | --- | ------------- | ----------------- | ------- |
| GET    | /v1/incidents/:id   | security/router.ts:131 | 403  |     | GATED_RUNTIME | security.incident |         |
| PATCH  | /v1/incidents/:id   | security/router.ts:105 | 403  |     | GATED_RUNTIME | security.incident |         |
| GET    | /v1/incidents       | security/router.ts:147 | 403  |     | GATED_RUNTIME | security.incident |         |
| POST   | /v1/incidents       | security/router.ts:79  | 403  |     | GATED_RUNTIME | security.incident |         |
| GET    | /v1/security/events | security/router.ts:50  | 403  |     | GATED_RUNTIME | security.incident |         |
| POST   | /v1/security/events | security/router.ts:27  | 422  | 422 | NO_GATE_FOUND | none              | F-04    |

### verification (6)

| Method | Path                                           | Source                     | Stub | DB  | Class         | Gate                  | Finding |
| ------ | ---------------------------------------------- | -------------------------- | ---- | --- | ------------- | --------------------- | ------- |
| POST   | /v1/verification-requests/:id/checklist-review | verification/router.ts:196 | 403  |     | GATED_RUNTIME | document.review       |         |
| POST   | /v1/verification-requests/:id/complete         | verification/router.ts:167 | 403  |     | GATED_RUNTIME | verification.complete |         |
| GET    | /v1/verification-requests/:id                  | verification/router.ts:98  | 403  |     | GATED_RUNTIME | verification.read     |         |
| PATCH  | /v1/verification-requests/:id                  | verification/router.ts:143 | 403  |     | GATED_RUNTIME | verification.update   |         |
| GET    | /v1/verification-requests                      | verification/router.ts:77  | 403  |     | GATED_RUNTIME | verification.read     |         |
| POST   | /v1/verification-requests                      | verification/router.ts:120 | 403  |     | GATED_RUNTIME | verification.create   |         |

## 9. Web route inventory

No web route has a route-level permission guard. "Sidebar rule" is what hides the link; "checks in file" counts permission tests inside the page component's file.

| Route                                     | Component                   | Route source                           | Sidebar rule                                                                                            | Permission checks in component file | Codes checked                                                                        |
| ----------------------------------------- | --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| /roles                                    | RolesListPage               | features/access-control/routes.tsx:8   | user.manage                                                                                             | 0                                   |                                                                                      |
| /roles/:id                                | RoleDetailPage              | features/access-control/routes.tsx:12  | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /permissions                              | PermissionsCatalogPage      | features/access-control/routes.tsx:16  | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /activities                               | ActivitiesPage              | features/activities/routes.tsx:5       | lead.read \| customer.read \| application.read \| activity.create                                       | 0                                   |                                                                                      |
| /admin                                    | AdminLayout                 | features/admin/routes.tsx:12           | no sidebar entry                                                                                        | 2                                   | config.manage, user.manage                                                           |
| /admin/organisation                       | OrganisationPage            | features/admin/routes.tsx:15           | config.manage                                                                                           | 3                                   | config.manage                                                                        |
| /admin/branches                           | BranchesPage                | features/admin/routes.tsx:16           | config.manage                                                                                           | 2                                   | config.manage                                                                        |
| /admin/teams                              | TeamsPage                   | features/admin/routes.tsx:17           | config.manage                                                                                           | 3                                   | config.manage, user.manage                                                           |
| /admin/teams/:id                          | TeamDetailPage              | features/admin/routes.tsx:18           | no sidebar entry                                                                                        | 3                                   | config.manage, user.manage                                                           |
| /admin/queues                             | QueuesPage                  | features/admin/routes.tsx:19           | config.manage                                                                                           | 4                                   | config.manage, user.manage                                                           |
| /admin/queues/:id                         | QueueDetailPage             | features/admin/routes.tsx:20           | no sidebar entry                                                                                        | 4                                   | config.manage, user.manage                                                           |
| /api-management                           | ApiManagementPage           | features/api-management/routes.tsx:7   | api.read \| api.manage \| config.manage                                                                 | 0                                   |                                                                                      |
| /applications                             | ApplicationsPage            | features/applications/routes.tsx:8     | application.read                                                                                        | 2                                   | application.read                                                                     |
| /applications/:id                         | ApplicationDetailPage       | features/applications/routes.tsx:9     | no sidebar entry                                                                                        | 7                                   | application.update, application.review, application.cancel                           |
| /approvals                                | ApprovalsPage               | features/approvals/routes.tsx:5        | config.manage \| data_correction.request \| data_correction.approve                                     | 6                                   | config.manage, data_correction.request, data_correction.approve                      |
| /audit                                    | AuditSearchPage             | features/audit/routes.tsx:7            | audit.read \| audit.export_evidence \| config.manage                                                    | 0                                   |                                                                                      |
| /automations                              | AutomationListPage          | features/automation/routes.tsx:8       | automation.read \| automation.author \| automation.approve \| automation.execute \| automation.operator | 0                                   |                                                                                      |
| /automations/:id                          | AutomationDetailPage        | features/automation/routes.tsx:12      | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /commission                               | CommissionDashboardPage     | features/commission/routes.tsx:4       | finance.view \| commission.plan.edit \| commission.plan.approve                                         | 5                                   | commission.plan.edit, commission.plan.approve, adjustment.create, adjustment.approve |
| /config                                   | ConfigurationPage           | features/configuration/routes.tsx:6    | config.manage                                                                                           | 0                                   |                                                                                      |
| /connectors                               | ConnectorPage               | features/connectors/routes.tsx:5       | connector.read \| connector.manage                                                                      | 0                                   |                                                                                      |
| /customers                                | CustomerListPage            | features/customers/routes.tsx:9        | customer.read                                                                                           | 0                                   |                                                                                      |
| /customers/:id                            | CustomerDetailPage          | features/customers/routes.tsx:13       | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /customers/:id/consents                   | CustomerConsents            | features/customers/routes.tsx:17       | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /document-sharing                         | DocumentSharingPage         | features/document-sharing/routes.tsx:5 | document.upload \| share.create                                                                         | 0                                   |                                                                                      |
| /documents                                | DocumentsPage               | features/documents/routes.tsx:5        | application.read                                                                                        | 2                                   | application.read                                                                     |
| /complaints                               | ComplaintsPage              | features/grievances/routes.tsx:8       | complaint.create \| complaint.manage                                                                    | 3                                   | complaint.manage, complaint.create                                                   |
| /complaints/:id                           | ComplaintDetailPage         | features/grievances/routes.tsx:9       | no sidebar entry                                                                                        | 2                                   | complaint.manage                                                                     |
| /grievances                               | GrievancesPage              | features/grievances/routes.tsx:10      | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /admin/import-export                      | ImportExportPage            | features/import-export/routes.tsx:5    | import.run \| export.run                                                                                | 0                                   |                                                                                      |
| /integrations                             | IntegrationsPage            | features/integrations/routes.tsx:7     | integration.read \| integration.manage \| config.manage                                                 | 0                                   |                                                                                      |
| /admin/integrations                       | IntegrationsPage            | features/integrations/routes.tsx:8     | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /invoices                                 | InvoicesPage                | features/invoices/routes.tsx:5         | finance.view \| invoice.manage                                                                          | 2                                   | invoice.manage                                                                       |
| /leads                                    | LeadList                    | features/leads/routes.tsx:7            | lead.read                                                                                               | 0                                   |                                                                                      |
| /leads/new                                | LeadCreate                  | features/leads/routes.tsx:8            | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /leads/:id                                | LeadDetail                  | features/leads/routes.tsx:9            | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /ledger                                   | LedgerPage                  | features/ledger/routes.tsx:8           | finance.view                                                                                            | 0                                   |                                                                                      |
| /lender-cases                             | LenderCaseListPage          | features/lender-cases/routes.tsx:8     | application.read \| lender_case.submit                                                                  | 0                                   |                                                                                      |
| /lender-cases/:id                         | LenderCaseDetailPage        | features/lender-cases/routes.tsx:9     | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /applications/:applicationId/lender-cases | LenderCasePanel             | features/lender-cases/routes.tsx:10    | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /lenders                                  | LenderListPage              | features/lenders/routes.tsx:6          | none                                                                                                    | 2                                   | config.manage                                                                        |
| /lenders/:id                              | LenderDetailPage            | features/lenders/routes.tsx:7          | no sidebar entry                                                                                        | 6                                   | config.manage                                                                        |
| /messaging                                | MessagingPage               | features/messaging/routes.tsx:6        | message.send \| config.manage                                                                           | 0                                   |                                                                                      |
| /message-templates                        | MessagingPage               | features/messaging/routes.tsx:7        | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /notifications                            | NotificationsPage           | features/notifications/routes.tsx:7    | none                                                                                                    | 0                                   |                                                                                      |
| /payouts                                  | PayoutsDashboardPage        | features/payouts/routes.tsx:4          | finance.view \| payout.request \| payout.approve \| payout.record_payment                               | 4                                   | payout.request, payout.approve, payout.record_payment                                |
| /performance                              | PerformanceDashboardPage    | features/performance/routes.tsx:7      | report.read                                                                                             | 0                                   |                                                                                      |
| /performance/leaderboard                  | LeaderboardPage             | features/performance/routes.tsx:8      | report.read                                                                                             | 0                                   |                                                                                      |
| /platform-admin                           | PlatformConsolePage         | features/platform-admin/routes.tsx:7   | platform.console                                                                                        | 0                                   |                                                                                      |
| /platform-console                         | PlatformConsolePage         | features/platform-admin/routes.tsx:8   | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /platform-admin/tenants/:tenantId         | TenantDetailPage            | features/platform-admin/routes.tsx:9   | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /platform-console/tenants/:tenantId       | TenantDetailPage            | features/platform-admin/routes.tsx:10  | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /privacy                                  | PrivacyDashboard            | features/privacy/routes.tsx:6          | audit.read \| customer.read                                                                             | 0                                   |                                                                                      |
| /products                                 | ProductCataloguePage        | features/products/routes.tsx:6         | none                                                                                                    | 2                                   | config.manage                                                                        |
| /products/:id                             | ProductDetailPage           | features/products/routes.tsx:7         | no sidebar entry                                                                                        | 5                                   | config.manage                                                                        |
| /reconciliation                           | ReconciliationDashboardPage | features/reconciliation/routes.tsx:8   | finance.view \| finance.reconcile                                                                       | 5                                   | finance.reconcile, finance.dispute, adjustment.create, adjustment.approve            |
| /reports                                  | ReportingPage               | features/reporting/routes.tsx:7        | report.read \| report.manage                                                                            | 0                                   |                                                                                      |
| /rules                                    | RulesListPage               | features/rules/routes.tsx:10           | rule.author \| rule.simulate \| rule.approve \| rule.publish \| rule.suspend                            | 0                                   |                                                                                      |
| /rules/:ruleSetId                         | RuleSetDetailPage           | features/rules/routes.tsx:11           | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /rules/versions/:versionId                | RuleVersionDetailPage       | features/rules/routes.tsx:12           | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /decisions                                | DecisionRecordsListPage     | features/rules/routes.tsx:13           | rule.author \| rule.simulate \| rule.approve \| rule.publish \| rule.suspend                            | 0                                   |                                                                                      |
| /decisions/:id                            | DecisionRecordDetailPage    | features/rules/routes.tsx:14           | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /sanctions                                | SanctionsListPage           | features/sanctions/routes.tsx:12       | sanction.record \| disbursement.record \| disbursement.verify                                           | 0                                   |                                                                                      |
| /sanctions/:lenderCaseId                  | SanctionsForCase            | features/sanctions/routes.tsx:13       | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /security                                 | SecurityIncidentsPage       | features/security/routes.tsx:5         | security.incident                                                                                       | 2                                   | security.incident                                                                    |
| /targets                                  | TargetsPage                 | features/targets/routes.tsx:5          | report.read \| target.manage                                                                            | 3                                   | target.manage                                                                        |
| /tasks                                    | TaskList                    | features/tasks/routes.tsx:6            | task.read                                                                                               | 0                                   |                                                                                      |
| /users                                    | UserListPage                | features/users/routes.tsx:8            | user.manage                                                                                             | 0                                   |                                                                                      |
| /users/new                                | UserCreatePage              | features/users/routes.tsx:9            | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /users/:id                                | UserDetailPage              | features/users/routes.tsx:10           | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /verifications                            | VerificationListPage        | features/verifications/routes.tsx:8    | verification.read \| verification.perform                                                               | 0                                   |                                                                                      |
| /verifications/workbench                  | VerificationPage            | features/verifications/routes.tsx:9    | verification.read \| verification.perform                                                               | 0                                   |                                                                                      |
| /verifications/:id                        | VerificationDetailPage      | features/verifications/routes.tsx:10   | no sidebar entry                                                                                        | 0                                   |                                                                                      |
| /workforce                                | WorkforcePage               | features/workforce/routes.tsx:5        | none                                                                                                    | 6                                   | user.manage, config.manage, attendance.manage                                        |

Routes with no sidebar entry: /roles/:id, /permissions, /admin, /admin/teams/:id, /admin/queues/:id, /applications/:id, /automations/:id, /customers/:id, /customers/:id/consents, /complaints/:id, /grievances, /admin/integrations, /leads/new, /leads/:id, /lender-cases/:id, /applications/:applicationId/lender-cases, /lenders/:id, /message-templates, /platform-console, /platform-admin/tenants/:tenantId, /platform-console/tenants/:tenantId, /products/:id, /rules/:ruleSetId, /rules/versions/:versionId, /decisions/:id, /sanctions/:lenderCaseId, /users/new, /users/:id, /verifications/:id. They are reachable by URL and by in-page links.

## 10. Page, tab, button and action visibility

The scan found 643 buttons, tabs, switches and menu items with an action in 76 files; 60 sit under a permission test the scan could recognise (heuristic: a permission/`can`/`allowed` condition in the 14 lines above). 52 of the 76 files contain no permission test at all. **Absence of a UI guard is not a defect when the API refuses the action (category E, hide or disable for a cleaner experience); it matters when the API does not (category F, section 5).** The full per-control list (file, line, label, guarded) is in the JSON file.

| Page file                                                | Controls | Recognised guards | Risk-labelled controls | of which unguarded | Permission codes tested in the file                                                  |
| -------------------------------------------------------- | -------- | ----------------- | ---------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| features/rules/RuleVersionDetailPage.tsx                 | 22       | 0                 | 4                      | 4                  |                                                                                      |
| features/reporting/ReportingPage.tsx                     | 21       | 0                 | 4                      | 4                  |                                                                                      |
| features/targets/TargetsPage.tsx                         | 14       | 2                 | 4                      | 4                  | target.manage                                                                        |
| features/import-export/ImportExportPage.tsx              | 12       | 0                 | 3                      | 3                  |                                                                                      |
| features/audit/AuditSearchPage.tsx                       | 10       | 0                 | 3                      | 3                  |                                                                                      |
| features/security/SecurityIncidentsPage.tsx              | 9        | 0                 | 3                      | 3                  | security.incident                                                                    |
| features/sanctions/SanctionsPanel.tsx                    | 8        | 0                 | 3                      | 3                  |                                                                                      |
| features/connectors/ConnectorPage.tsx                    | 29       | 0                 | 2                      | 2                  |                                                                                      |
| features/reconciliation/ReconciliationDashboardPage.tsx  | 25       | 3                 | 2                      | 2                  | finance.reconcile, finance.dispute, adjustment.create, adjustment.approve            |
| features/platform-admin/PlatformConsolePage.tsx          | 23       | 0                 | 2                      | 2                  |                                                                                      |
| features/leads/LeadDetail.tsx                            | 20       | 0                 | 1                      | 1                  |                                                                                      |
| features/lender-cases/LenderCasePanel.tsx                | 17       | 0                 | 1                      | 1                  |                                                                                      |
| features/document-sharing/DocumentSharingPage.tsx        | 14       | 0                 | 1                      | 1                  |                                                                                      |
| features/invoices/InvoicesPage.tsx                       | 10       | 1                 | 1                      | 1                  | invoice.manage                                                                       |
| features/verifications/VerificationDetailPage.tsx        | 10       | 0                 | 1                      | 1                  |                                                                                      |
| features/privacy/PrivacyDashboard.tsx                    | 9        | 0                 | 1                      | 1                  |                                                                                      |
| features/tasks/TaskList.tsx                              | 9        | 0                 | 1                      | 1                  |                                                                                      |
| features/automation/AutomationDetailPage.tsx             | 8        | 0                 | 1                      | 1                  |                                                                                      |
| features/access-control/RoleDetailPage.tsx               | 6        | 0                 | 1                      | 1                  |                                                                                      |
| features/messaging/MessagingPage.tsx                     | 4        | 0                 | 1                      | 1                  |                                                                                      |
| features/payouts/PayoutsDashboardPage.tsx                | 18       | 4                 | 1                      | 0                  | payout.request, payout.approve, payout.record_payment                                |
| features/admin/LenderDetailPage.tsx                      | 17       | 6                 | 0                      | 0                  | config.manage                                                                        |
| features/users/UserDetailPage.tsx                        | 16       | 0                 | 0                      | 0                  |                                                                                      |
| features/commission/CommissionDashboardPage.tsx          | 15       | 4                 | 0                      | 0                  | commission.plan.edit, commission.plan.approve, adjustment.create, adjustment.approve |
| features/lenders/LenderDetailPage.tsx                    | 15       | 5                 | 0                      | 0                  | config.manage                                                                        |
| features/automation/AutomationListPage.tsx               | 12       | 0                 | 0                      | 0                  |                                                                                      |
| features/rules/RuleSetDetailPage.tsx                     | 12       | 0                 | 0                      | 0                  |                                                                                      |
| features/admin/QueuesPage.tsx                            | 10       | 5                 | 0                      | 0                  | config.manage, user.manage                                                           |
| features/api-management/ApiManagementPage.tsx            | 10       | 0                 | 0                      | 0                  |                                                                                      |
| features/integrations/IntegrationsPage.tsx               | 10       | 0                 | 0                      | 0                  |                                                                                      |
| features/access-control/RolesListPage.tsx                | 9        | 0                 | 0                      | 0                  |                                                                                      |
| features/customers/CustomerDetailPage.tsx                | 9        | 0                 | 0                      | 0                  |                                                                                      |
| features/lenders/LenderListPage.tsx                      | 9        | 3                 | 0                      | 0                  | config.manage                                                                        |
| features/rules/RulesListPage.tsx                         | 9        | 0                 | 0                      | 0                  |                                                                                      |
| features/users/UserListPage.tsx                          | 9        | 0                 | 0                      | 0                  |                                                                                      |
| features/workforce/WorkforcePage.tsx                     | 9        | 1                 | 0                      | 0                  | user.manage, config.manage, attendance.manage                                        |
| features/admin/ProductDetailPage.tsx                     | 8        | 4                 | 1                      | 0                  | config.manage                                                                        |
| features/configuration/ConfigurationPage.tsx             | 8        | 0                 | 0                      | 0                  |                                                                                      |
| features/customers/CustomerConsents.tsx                  | 8        | 0                 | 0                      | 0                  |                                                                                      |
| features/grievances/ComplaintDetailPage.tsx              | 8        | 0                 | 0                      | 0                  | complaint.manage                                                                     |
| features/admin/TeamsPage.tsx                             | 7        | 5                 | 0                      | 0                  | config.manage, user.manage                                                           |
| features/leads/LeadList.tsx                              | 7        | 0                 | 0                      | 0                  |                                                                                      |
| features/products/ProductCataloguePage.tsx               | 7        | 2                 | 0                      | 0                  | config.manage                                                                        |
| features/sanctions/SanctionsListPage.tsx                 | 7        | 0                 | 0                      | 0                  |                                                                                      |
| features/applications/ApplicationDetailPage.tsx          | 6        | 2                 | 0                      | 0                  | application.update, application.review, application.cancel                           |
| features/notifications/NotificationPreferencesDialog.tsx | 6        | 0                 | 0                      | 0                  |                                                                                      |
| features/notifications/NotificationsPage.tsx             | 6        | 0                 | 0                      | 0                  |                                                                                      |
| features/verifications/VerificationPage.tsx              | 6        | 0                 | 0                      | 0                  |                                                                                      |
| features/admin/BranchesPage.tsx                          | 5        | 3                 | 0                      | 0                  | config.manage                                                                        |
| features/approvals/ApprovalsPage.tsx                     | 5        | 3                 | 0                      | 0                  | config.manage, data_correction.request, data_correction.approve                      |
| features/notifications/NotificationCenter.tsx            | 5        | 0                 | 0                      | 0                  |                                                                                      |
| features/products/ProductDetailPage.tsx                  | 5        | 1                 | 0                      | 0                  | config.manage                                                                        |
| features/verifications/VerificationListPage.tsx          | 5        | 0                 | 0                      | 0                  |                                                                                      |
| features/applications/EligibilityCard.tsx                | 4        | 2                 | 1                      | 0                  | application.read, eligibility.override                                               |
| features/lender-cases/LenderCaseListPage.tsx             | 4        | 0                 | 0                      | 0                  |                                                                                      |
| features/platform-admin/TenantDetailPage.tsx             | 4        | 0                 | 0                      | 0                  |                                                                                      |
| features/activities/ActivitiesPage.tsx                   | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/activities/LogActivityForm.tsx                  | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/admin/components.tsx                            | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/admin/LendersPage.tsx                           | 3        | 1                 | 0                      | 0                  | config.manage                                                                        |
| features/admin/ProductsPage.tsx                          | 3        | 1                 | 0                      | 0                  | config.manage                                                                        |
| features/customers/CustomerListPage.tsx                  | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/document-sharing/PublicUploadPage.tsx           | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/grievances/ComplaintsPage.tsx                   | 3        | 1                 | 1                      | 0                  | complaint.manage, complaint.create                                                   |
| features/grievances/GrievancesPage.tsx                   | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/leads/LeadCreate.tsx                            | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/messaging/TemplateEditor.tsx                    | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/performance/PerformanceDashboardPage.tsx        | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/rules/DecisionRecordDetailPage.tsx              | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/rules/DecisionRecordsListPage.tsx               | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/users/UserCreatePage.tsx                        | 3        | 0                 | 0                      | 0                  |                                                                                      |
| features/access-control/PermissionsCatalogPage.tsx       | 2        | 0                 | 0                      | 0                  |                                                                                      |
| features/admin/OrganisationPage.tsx                      | 2        | 1                 | 0                      | 0                  | config.manage                                                                        |
| features/verifications/VerificationCreateDialog.tsx      | 2        | 0                 | 0                      | 0                  |                                                                                      |
| features/messaging/MessageComposer.tsx                   | 1        | 0                 | 0                      | 0                  |                                                                                      |
| features/performance/LeaderboardPage.tsx                 | 1        | 0                 | 0                      | 0                  |                                                                                      |

Risk-labelled means the label contains approve, reject, delete, revoke, submit, record, activate, suspend, export, reveal, verify, release, payout, publish, disburse, sanction, override, close, void, resolve, import, commit, rollback, assign, or send. The per-action API gate for each is in section 8.

## 11. Dashboards and default visibility

- **Home** (`shell/HomePage.tsx`): 18 static cards, filtered only by realm (F-07). The cards carry no data, so the exposure is navigation only.
- **Dashboard APIs**: `GET /v1/dashboards/:code` requires report.read | report.manage | config.manage (the sweep opened it with each). Executive, finance, branch, operations, connector, leaderboard and team dashboards all use that one route, so any holder of report.read gets every dashboard, including the FINANCE and EXECUTIVE ones. Whether code-level scoping exists inside the dashboard service was not traced; this is open decision D-04.
- **Performance, Targets, Leaderboard**: report.read at both UI and API.
- **Notifications**: own notifications only; `GET /v1/notifications` and the stream are scoped to the caller.
- **Pending approvals** (`/approvals`): UI anyOf config.manage | data_correction.request | data_correction.approve; API data-corrections needs data_correction.request.
- No other role-specific dashboard exists. Each role lands on the same Home page.

## 12. Components with no permission rule (categories A to G)

| Category                                      | Components                                                                                                                                                                              | Finding                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A. Intentionally public                       | Login, MFA, password reset pages; /upload/:token (public upload with OTP); /public/v1/* token routes; /health; /openapi.json                                                            | INFO (token and OTP checked on the public routes; the OpenAPI document is public) |
| B. Authenticated but permissionless           | Home, Notifications, Account security; /v1/me, /v1/tenant, notifications, attendance (own), integration capabilities, partner sandbox                                                   | INFO / F-13 for the one wrong rule                                                |
| C. Visible to every role by default           | Home cards (18), Lenders, Products, Workforce screens, directory reads (users, branches, teams, queues, delegations)                                                                    | F-07, F-11, F-16, F-21                                                            |
| D. Permission exists but is not connected     | lender.read/manage, product.read/manage (granted to nobody, unused); commission.plan.*, commission.calculate, customer.reveal_sensitive, lead.reopen (granted to nobody); security.vuln | F-10, F-18, F-21                                                                  |
| E. Backend-protected but frontend-unprotected | Lead actions (Qualify, Disqualify, Convert, Assign); all routes without a route guard (52 of 76 page files have no check)                                                               | F-08, F-12                                                                        |
| F. Frontend-protected but backend-unprotected | Commission reads, sanction and disbursement reads, manual journal posting, security event writes, import list; decision evaluation (unconfirmed)                                        | F-01 to F-06                                                                      |
| G. Unknown policy                             | Decision evaluation callers, workforce visibility, dashboard scoping, catalogue read access                                                                                             | F-05, F-11, D-04                                                                  |

## 13. Backend and database enforcement

- **Tenant isolation**: every request is wrapped in `withTenantTx`; the tenant-isolation suite (55 tests, 11 files) passes. All the open reads above are tenant-scoped; none leaks across tenants. The data-layer helpers also read `tenant_id` from the principal, never from input.
- **Platform realm**: all 19 platform routes refused a tenant user holding every permission; the platform tables (`feature_flag`, `tenant_feature_flag`, `master_data_item`) allow writes only in the platform realm through row-level security.
- **Separation of duties and step-up**: enforced in services for role edits, rule approval, payouts and connector bank accounts (composite gates in the sweep: `PATCH /v1/connectors/:id`, `POST /v1/customers/:id/reveal`, `POST /v1/ledger/exports`).
- **Feature flags** grant no permission anywhere: no code reads a flag (they are stored, versioned and audited only).
- **Errors**: refusals are 403 with a generic message; lookups before checks (404 on by-id routes of F-01/F-02) would let a user probe ids, which disappears once the checks come first.
- **Database grants**: `dsa_app` has no DELETE anywhere; RLS is enabled and forced on every table with a `tenant_id`.

## 14. Tests and verification

Existing coverage: 53 of 117 API spec files assert a 403 or FORBIDDEN; 10 tenant-isolation case files; web: `Sidebar.spec.ts` and `role-navigation.spec.ts` (9 of 14 roles), plus per-page specs for commission, invoices, lenders, payouts, performance, products, reporting, targets and workforce.

Run during this audit (throwaway databases only, nothing hosted):

| What                                                                            | Result                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route enumeration from createApp                                                | 378 routes                                                                                                                                                                                                                   |
| Zero-grant and all-permission probe of every route (stubbed data layer)         | 241 refused with 403; the rest were validation or data-layer failures, resolved below                                                                                                                                        |
| Single-permission sweep, 99 permission codes x 241 gated routes                 | 219 routes opened by one permission, 22 need a platform realm, step-up or a combination                                                                                                                                      |
| Zero-permission probe of 130 non-403 routes against a real throwaway PostgreSQL | 24 answered 2xx (self-service, directory, and the open reads of F-01, F-02, F-06, F-21), 2 gated after all, 20 not found, 3 deferred, 75 failed validation and 6 were malformed before any check                             |
| Write confirmations as a zero-permission user                                   | security event: 201 and a row written (F-04); ledger journal: reached the audit insert, stopped by the audit action constraint (F-03)                                                                                        |
| Hosted read-only queries                                                        | 99 permissions, 65 role rows in 8 tenants, 16 role codes                                                                                                                                                                     |
| Existing suites on the merged code                                              | web 280/280, contracts 77/77, API unit 952/953 (the failure is the repository secrets scan flagging 7 untracked scratch files), integration 367/368 (grievances, unrelated), isolation 54/55 (endpoint inventory, unrelated) |

Not executed: write calls with valid payloads for routes that validate first (decision evaluation, messages, report schedules and others), role-by-role calls with each role's real grant set, and any browser rendering of the pages. The control scan is a text heuristic.

Proposed test matrix (to add after approval), one parametrised suite over the route inventory in the JSON file:

| #   | Case                                             | Expected                                        |
| --- | ------------------------------------------------ | ----------------------------------------------- |
| 1   | role with the required permission                | allowed                                         |
| 2   | role without it                                  | 403                                             |
| 3   | authenticated user with no grants                | 403 on every route not listed as open by design |
| 4   | user of another tenant                           | 404 / empty, never data                         |
| 5   | direct URL in the browser for each sidebar route | not-permitted page                              |
| 6   | direct API call for each hidden UI action        | 403                                             |
| 7   | view permission without edit permission          | read allowed, write 403, button hidden          |
| 8   | action permission without approval permission    | maker cannot approve own item                   |
| 9   | feature flag off                                 | no permission is implied                        |
| 10  | unknown or obsolete role                         | no grants, 403                                  |

## 15. Prioritised remediation plan (nothing applied yet)

| Priority | Work                                                                                                                                                                                                             | Findings                 | Needs                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| 1        | Add permission checks to the finance, sanction, ledger-posting and security-event endpoints and fix the three ledger audit action names; one 403 test per endpoint for zero-grant, sales and the right role      | F-01 to F-04             | approval; code and tests only, no migration |
| 2        | Check the import list and decision evaluation; confirm intended callers first                                                                                                                                    | F-05, F-06               | product decision on callers                 |
| 3        | One shared permission map (from NAV_GROUPS) used by the sidebar, the Home cards and a route guard; hide lead action buttons by permission; fix Access control rule; remove navigation.ts and the duplicate entry | F-07, F-08, F-12 to F-15 | approval                                    |
| 4        | Decide the nine ungranted permissions and the catalogue read policy; then a grant migration                                                                                                                      | F-10, F-21, F-18         | business decision, then migration approval  |
| 5        | Remove the six platform grants from the Qloax and demo-alpha tenant admin roles and fix the provisioning script                                                                                                  | F-09                     | hosted write approval                       |
| 6        | Decide workforce and directory visibility; add the five missing roles to the navigation tests; align role grants across tenants                                                                                  | F-11, F-16, F-17, F-19   | business decision                           |

## 16. Decisions needed from the business or security owner

1. **D-01** Should every employee see commission plans, calculations and payables, or only finance roles? (F-01)
2. **D-02** Should sanction and disbursement data be limited to the sanction/disbursement permissions, or to anyone who can read the application? (F-02)
3. **D-03** Who may post manual ledger journals and record security events? (F-03, F-04)
4. **D-04** Do the Executive and Finance dashboards need their own permission instead of one report.read? (section 11)
5. **D-05** Which roles get commission.plan.edit, commission.plan.approve, commission.calculate, customer.reveal_sensitive and lead.reopen? (F-10)
6. **D-06** Is workforce (staff email and workload) visible to all staff? Is the user, branch, team and queue directory open to all staff? (F-11, F-16)
7. **D-07** Should lenders and products stay open to all staff? Then drop lender.* and product.* codes. (F-21)
8. **D-08** Who may call decision evaluation directly? (F-05)

## 17. File paths

Every route in section 8 carries its router file and line; web routes in section 9 carry the route file and line; section 10 gives the page files and the JSON file gives every control with its line. The evidence scripts were run from outside the repository and are described in section 14.

## 18. Remediation status (2026-10-19 to 2026-10-21)

Status key: FIXED AND TESTED, PARTIALLY FIXED, REQUIRES BUSINESS APPROVAL, NOT FIXED (reason).

| Finding                                    | Status                                                                                                                             | Evidence                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| F-01 commission reads                      | FIXED AND TESTED                                                                                                                   | finance-service assertCommissionRead; finance.spec, permission-phase1 F01-01..03                           |
| F-02 sanction/disbursement reads           | FIXED AND TESTED (stricter policy kept)                                                                                            | sanctions service checkReadAccess; permission-phase1 F02-01..03; D-02 open                                 |
| F-03 ledger posting and audit names        | FIXED AND TESTED; manual posting closed to people as a temporary safeguard                                                         | ledger-hardening.int.spec (5/5), ledger-security-hardening.spec; D-03 open                                 |
| F-04 security event forgery                | FIXED AND TESTED (SUSPICIOUS_ACCESS only over HTTP; server sets principal, address, severity)                                      | security-report.int.spec (6/6), security-report unit (16/16), security.spec (29/29), permission-phase1 F04 |
| F-05 decision evaluation                   | FIXED AND TESTED (rule.simulate); D-08 open on other callers                                                                       | decision-import-authz F05 (5/5)                                                                            |
| F-06 import reads                          | FIXED AND TESTED (import permission; non-administrators see only their own uploads)                                                | decision-import-authz F06 (5/5)                                                                            |
| F-07 Home cards                            | FIXED AND TESTED (shared rule set, all 14 roles)                                                                                   | HomePage.spec, access.spec                                                                                 |
| F-08 route guard                           | FIXED AND TESTED (Forbidden state; fails closed)                                                                                   | access.spec TEST-ACC-01..07                                                                                |
| F-09 stray platform grants on tenant roles | PARTIALLY FIXED: correction and restore written and rehearsed (operator-grants-fix-v2 4/4); NOT APPLIED to hosted (needs approval) | tools/sql/fixes/*.v2.sql                                                                                   |
| F-10 nine ungranted permissions            | REQUIRES BUSINESS APPROVAL (role mapping decision table)                                                                           | section 5                                                                                                  |
| F-11 workforce data                        | REQUIRES BUSINESS APPROVAL                                                                                                         | section 16 D-06                                                                                            |
| F-12 lead action buttons                   | FIXED AND TESTED                                                                                                                   | lead-actions via access.spec TEST-ACC-10..12                                                               |
| F-13 Access control rule                   | FIXED AND TESTED (user.manage or role.manage)                                                                                      | access.spec TEST-ACC-08                                                                                    |
| F-14 duplicate navigation config           | FIXED AND TESTED (navigation.ts and its spec removed; single access.ts)                                                            | access.spec                                                                                                |
| F-15 duplicate Performance entry           | FIXED AND TESTED                                                                                                                   | access.spec TEST-ACC-09                                                                                    |
| F-16 directory reads                       | REQUIRES BUSINESS APPROVAL                                                                                                         | section 16 D-06                                                                                            |
| F-17 cross-tenant grant differences        | NOT FIXED: test fixtures and provisioning differ; needs a decision on the canonical role set                                       | section 5                                                                                                  |
| F-18 catalogue                             | FIXED AND TESTED for the duplicate; finance.period_close is in the contracts but not in hosted: REQUIRES BUSINESS APPROVAL         | permissions.ts                                                                                             |
| F-19 navigation tests for all roles        | FIXED AND TESTED (14 roles, real grants)                                                                                           | role-grants.fixture, access.spec                                                                           |
| F-20 deferred stubs                        | UNCHANGED by design (409 until built)                                                                                              | section 5                                                                                                  |
| F-21 lender and product catalogue reads    | REQUIRES BUSINESS APPROVAL                                                                                                         | section 16 D-07                                                                                            |
| F-22 platform realm isolation              | VERIFIED UNCHANGED                                                                                                                 | platform-realm and platform-admin specs                                                                    |
| F-23 decision record id collision (new)    | FIXED AND TESTED                                                                                                                   | decision-engine record id; decision-import-authz F23-01                                                    |

Other fixes made while finishing:

- The untracked scratch scripts that contained a database password were moved out of the repository (kept in the scratchpad, not committed).
- Grievances TEST-GRV-INT-03 updated: the lead provider is wired, so an unknown lead is 404 NOT_FOUND.

Known open items at publication:

- The isolation inventory (TEST-SEC-001-INV-02) lists 137 `/v1` operations without an isolation case. Most predate this work (IMP-, LCS-, SND-, LED- routes). It is NOT allowlisted; closing it needs a dedicated isolation pass.
- Hosted database: no write was made for F-09 or any other finding in this work.

## 19. Decisions taken by default (closing section 16)

These were decided on the evidence in the code and the audit, so no item is left waiting. Each can be changed later by a one-line edit and a test update.

| Decision                                        | Taken                                                                                                                 | Basis                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| D-01 commission visibility                      | Finance-type roles only: `finance.view`, `commission.plan.edit`, `commission.plan.approve`                            | Matches the Commission screen and F-01 guard                        |
| D-02 sanction and disbursement reads            | Keep the stricter permissions (sanction, disbursement); do not widen to `application.read`                            | Read access follows the screen that records the money               |
| D-03 manual ledger posting                      | System identities only until a posting permission is defined; no human grant added                                    | No permission expresses manual posting; settlement posts in-process |
| D-04 executive and finance dashboards           | Keep one `report.read` permission for all dashboards; code-level scoping left as is                                   | No separate permission exists in the contracts                      |
| D-05 and F-10 nine ungranted permissions        | Not granted to any role by default. Left unassigned until the role owners approve a mapping                           | Granting by default would invent business policy                    |
| D-06 workforce and directory reads (F-11, F-16) | Directory reads (users, branches, teams, queues) stay open to signed-in staff for pickers. Workforce detail unchanged | Assignment and picker workflows need them                           |
| D-07 lender and product catalogue (F-21)        | Reads open to signed-in staff; create and update need `config.manage` (already enforced)                              | Catalogue is needed to quote and submit                             |
| D-08 decision evaluation callers (F-05)         | HTTP route requires `rule.simulate`; in-process callers unaffected                                                    | Only the rules screen and simulation use the route                  |

Still open, because they change hosted data or the catalogue, and nothing in this repository can close them:

- `finance.period_close` is in the contracts but not in the hosted catalogue. Period close on hosted cannot succeed until a catalogue row is added through an approved hosted write.
- The F-09 correction for stray `platform.*` grants is prepared and rehearsed; it has not been applied to hosted.
- The isolation inventory (137 `/v1` operations without a named isolation case) remains; closing it needs a per-module proof pass, not a registry entry.
