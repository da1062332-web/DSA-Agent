# Sub-permission trim: review before anything is removed

Status: **proposal for owner review. Nothing in this document has been applied to any database, and there is no trim migration yet.**

Source of the "now" columns: the grants of the 14 roles of tenant `qloax-dsa` as read from the shared hosted project on 2026-10-19 (`apps/web/src/shell/role-grants.fixture.ts`, `QLOAX_ROLE_GRANTS_PRE_M098`), then passed through the backfill of migration M-098 (`withSubPermissionBackfill`, which the migration mirrors and a test pins). The hosted grants may have changed since 2026-10-19: re-read them before approving. Role names and permission codes only; no user, customer or tenant data.

Migration M-099 (`20261001000099_role_grants_per_roles_page.sql`) is a separate, additive step that goes in after M-098 and before any trim. It gives the template roles the grants the Roles page names and they lacked (Tenant Administrator: api and integration access, webhook.manage; DSA Owner: user.read; Branch Manager: report.read, target.manage, application.update, performance.read, target.read; RM: document.upload, share.create; Sales Executive: activity.update; Compliance: report.read; Finance Executive: payout.request, disbursement.verify, disbursement.read). The tables below are the state after M-098 only, so those roles gain a few screens on top of the "before" counts. M-099 removes nothing.

Source of the "target" columns: Notion "Roles, Workflows & Permissions Architecture", sections 6 and 7 (UI Access and Core Permissions per role). The Notion "Permission Catalogue, Access Matrix & Qloax Tenant Reference" page disagrees with it in places and calls itself a snapshot; where they disagree, the row is listed under _Decisions_, not decided here.

How the sidebar lists were produced: the real rule set in `apps/web/src/shell/access.ts` (`visibleGroups`), run on each role's grants. "Before" is the role after M-098. "After sub-permission trim" removes only the sub-permissions listed for that role. A screen can stay visible after the trim because the role still holds an older code that opens it (the transition alias): those are listed as _still open through_, and each is a decision.

## Summary

| Role                       | Screens before | Screens after sub-permission trim | Still open only through an older code                                                            |
| -------------------------- | -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ROLE-ORG-OWNER`           | 43             | 43                                | none                                                                                             |
| `ROLE-TENANT-ADMIN`        | 40             | 40                                | none                                                                                             |
| `ROLE-BRANCH-MGR`          | 34             | 35                                | Sanction and disbursement, Commission, Payouts, Ledger, Invoices, Reconciliation, Access control |
| `ROLE-TEAM-MGR`            | 15             | 17                                | none                                                                                             |
| `ROLE-RM`                  | 16             | 13                                | none                                                                                             |
| `ROLE-SALES-EXEC`          | 12             | 10                                | none                                                                                             |
| `ROLE-LOAN-OPS`            | 20             | 18                                | none                                                                                             |
| `ROLE-DOC-VERIFIER`        | 13             | 9                                 | none                                                                                             |
| `ROLE-VERIFIER`            | 13             | 9                                 | none                                                                                             |
| `ROLE-COMPLIANCE`          | 16             | 13                                | none                                                                                             |
| `ROLE-FINANCE-EXEC`        | 11             | 11                                | none                                                                                             |
| `ROLE-COMMISSION-APPROVER` | 12             | 11                                | Ledger, Invoices, Reconciliation                                                                 |
| `ROLE-RULE-AUTHOR`         | 8              | 7                                 | none                                                                                             |
| `ROLE-RULE-APPROVER`       | 8              | 7                                 | none                                                                                             |

## Per role

### `ROLE-ORG-OWNER`

- Screens now (43): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Grievances, Applications, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Connectors, Workforce, Performance Dashboard, Targets, Leaderboard, Reports & Catalogue, Automation rules, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy and consent, Security events and incidents, Security, Integrations, API management, Import and export
- Screens after the sub-permission trim (43): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Grievances, Applications, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Connectors, Workforce, Performance Dashboard, Targets, Leaderboard, Reports & Catalogue, Automation rules, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy and consent, Security events and incidents, Security, Integrations, API management, Import and export
- Screens the trim hides: none
- Sub-permissions removed (0): none
- Sub-permissions added (0): none

### `ROLE-TENANT-ADMIN`

- Screens now (40): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Grievances, Applications, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Invoices, Connectors, Workforce, Performance Dashboard, Targets, Leaderboard, Reports & Catalogue, Automation rules, Users, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy and consent, Security events and incidents, Security, Integrations, API management, Import and export
- Screens after the sub-permission trim (40): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Grievances, Applications, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Invoices, Connectors, Workforce, Performance Dashboard, Targets, Leaderboard, Reports & Catalogue, Automation rules, Users, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy and consent, Security events and incidents, Security, Integrations, API management, Import and export
- Screens the trim hides: none
- Sub-permissions removed (0): none
- Sub-permissions added (0): none

### `ROLE-BRANCH-MGR`

- Screens now (34): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Applications, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Connectors, Workforce, Automation rules, Users, Access control, Teams, Work queues, Privacy and consent, Security, Integrations, API management, Import and export
- Screens after the sub-permission trim (35): Home, Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Applications, Document sharing, Verification, Verification workbench, Sanction and disbursement, Eligibility, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Connectors, Workforce, Performance Dashboard, Targets, Leaderboard, Automation rules, Users, Access control, Teams, Work queues, Security, Integrations, API management, Import and export
- Screens the trim hides: Lender cases, Privacy and consent
- **Still open only through an older code the role holds:** Sanction and disbursement, Commission, Payouts, Ledger, Invoices, Reconciliation, Access control. See the legacy codes below.
- Sub-permissions removed (17): `access_review.manage`, `commission.view`, `connector.agreement_manage`, `connector.bank_account_manage`, `connector.portal_user_manage`, `disbursement.read`, `import.read`, `invoice.view`, `ledger.view`, `lender_case.read`, `payout.view`, `privacy.read`, `reconciliation.view`, `role.read`, `sanction.read`, `user.invite`, `user.offboard`
- Sub-permissions added (2): `performance.read`, `target.read`
- Older codes that keep a removed sub-permission's screen open (decide: remove the older code, or keep the screen):
  - removing `access_review.manage` does not close its screen while the role holds `user.manage`
  - removing `commission.view` does not close its screen while the role holds `finance.view`
  - removing `connector.agreement_manage` does not close its screen while the role holds `connector.manage`
  - removing `connector.bank_account_manage` does not close its screen while the role holds `connector.manage`
  - removing `connector.portal_user_manage` does not close its screen while the role holds `connector.manage`
  - removing `disbursement.read` does not close its screen while the role holds `sanction.record`, `disbursement.record`, `disbursement.verify`, `disbursement.exception_approve`
  - removing `import.read` does not close its screen while the role holds `import.run`
  - removing `invoice.view` does not close its screen while the role holds `finance.view`
  - removing `ledger.view` does not close its screen while the role holds `finance.view`
  - removing `payout.view` does not close its screen while the role holds `finance.view`, `payout.request`
  - removing `reconciliation.view` does not close its screen while the role holds `finance.view`
  - removing `role.read` does not close its screen while the role holds `user.manage`
  - removing `sanction.read` does not close its screen while the role holds `sanction.record`, `disbursement.record`, `disbursement.verify`, `disbursement.exception_approve`
  - removing `user.invite` does not close its screen while the role holds `user.manage`
  - removing `user.offboard` does not close its screen while the role holds `user.manage`

### `ROLE-TEAM-MGR`

- Screens now (15): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Applications, Lender cases, Eligibility, Lenders, Products, Workforce, Privacy and consent, Security
- Screens after the sub-permission trim (17): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Applications, Eligibility, Lenders, Products, Workforce, Performance Dashboard, Leaderboard, Teams, Work queues, Security
- Screens the trim hides: Lender cases, Privacy and consent
- Sub-permissions removed (2): `lender_case.read`, `privacy.read`
- Sub-permissions added (2): `performance.read`, `team.manage`

### `ROLE-RM`

- Screens now (16): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Applications, Verification, Lender cases, Eligibility, Lenders, Products, Workforce, Privacy and consent, Security
- Screens after the sub-permission trim (13): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Applications, Verification, Eligibility, Lenders, Products, Security
- Screens the trim hides: Lender cases, Workforce, Privacy and consent
- Sub-permissions removed (3): `attendance.read`, `lender_case.read`, `privacy.read`
- Sub-permissions added (0): none

### `ROLE-SALES-EXEC`

- Screens now (12): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Lenders, Products, Workforce, Privacy and consent, Security
- Screens after the sub-permission trim (10): Home, Tasks, Activity, Notifications, Leads, Customers, Messaging, Lenders, Products, Security
- Screens the trim hides: Workforce, Privacy and consent
- Sub-permissions removed (2): `attendance.read`, `privacy.read`
- Sub-permissions added (0): none

### `ROLE-LOAN-OPS`

- Screens now (20): Home, Tasks, Approvals, Activity, Notifications, Messaging, Applications, Documents, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Connectors, Workforce, Automation rules, Security
- Screens after the sub-permission trim (18): Home, Tasks, Approvals, Notifications, Messaging, Applications, Documents, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Connectors, Automation rules, Security
- Screens the trim hides: Activity, Workforce
- Sub-permissions removed (5): `activity.read`, `attendance.read`, `connector.agreement_manage`, `connector.bank_account_manage`, `connector.portal_user_manage`
- Sub-permissions added (0): none
- Older codes that keep a removed sub-permission's screen open (decide: remove the older code, or keep the screen):
  - removing `connector.agreement_manage` does not close its screen while the role holds `connector.manage`
  - removing `connector.bank_account_manage` does not close its screen while the role holds `connector.manage`
  - removing `connector.portal_user_manage` does not close its screen while the role holds `connector.manage`

### `ROLE-DOC-VERIFIER`

- Screens now (13): Home, Activity, Notifications, Applications, Documents, Verification, Verification workbench, Lender cases, Eligibility, Lenders, Products, Workforce, Security
- Screens after the sub-permission trim (9): Home, Notifications, Applications, Documents, Verification, Verification workbench, Lenders, Products, Security
- Screens the trim hides: Activity, Lender cases, Eligibility, Workforce
- Sub-permissions removed (4): `activity.read`, `attendance.read`, `eligibility.read`, `lender_case.read`
- Sub-permissions added (0): none

### `ROLE-VERIFIER`

- Screens now (13): Home, Activity, Notifications, Applications, Documents, Verification, Verification workbench, Lender cases, Eligibility, Lenders, Products, Workforce, Security
- Screens after the sub-permission trim (9): Home, Notifications, Applications, Documents, Verification, Verification workbench, Lenders, Products, Security
- Screens the trim hides: Activity, Lender cases, Eligibility, Workforce
- Sub-permissions removed (4): `activity.read`, `attendance.read`, `eligibility.read`, `lender_case.read`
- Sub-permissions added (0): none

### `ROLE-COMPLIANCE`

- Screens now (16): Home, Activity, Notifications, Leads, Customers, Applications, Verification, Lender cases, Eligibility, Lenders, Products, Workforce, Audit, Privacy and consent, Security events and incidents, Security
- Screens after the sub-permission trim (13): Home, Notifications, Leads, Customers, Grievances, Applications, Verification, Lenders, Products, Audit, Privacy and consent, Security events and incidents, Security
- Screens the trim hides: Activity, Lender cases, Eligibility, Workforce
- Sub-permissions removed (4): `activity.read`, `attendance.read`, `eligibility.read`, `lender_case.read`
- Sub-permissions added (1): `complaint.read`

### `ROLE-FINANCE-EXEC`

- Screens now (11): Home, Notifications, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Workforce, Security
- Screens after the sub-permission trim (11): Home, Notifications, Sanction and disbursement, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Security
- Screens the trim hides: Workforce
- Sub-permissions removed (1): `attendance.read`
- Sub-permissions added (2): `disbursement.read`, `payout.disburse`

### `ROLE-COMMISSION-APPROVER`

- Screens now (12): Home, Approvals, Notifications, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Workforce, Security
- Screens after the sub-permission trim (11): Home, Approvals, Notifications, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Security
- Screens the trim hides: Workforce
- **Still open only through an older code the role holds:** Ledger, Invoices, Reconciliation. See the legacy codes below.
- Sub-permissions removed (5): `attendance.read`, `invoice.view`, `ledger.view`, `payout.disburse`, `reconciliation.view`
- Sub-permissions added (0): none
- Older codes that keep a removed sub-permission's screen open (decide: remove the older code, or keep the screen):
  - removing `invoice.view` does not close its screen while the role holds `finance.view`
  - removing `ledger.view` does not close its screen while the role holds `finance.view`
  - removing `payout.disburse` does not close its screen while the role holds `payout.record_payment`
  - removing `reconciliation.view` does not close its screen while the role holds `finance.view`

### `ROLE-RULE-AUTHOR`

- Screens now (8): Home, Notifications, Lenders, Products, Workforce, Rule sets, Decisions, Security
- Screens after the sub-permission trim (7): Home, Notifications, Lenders, Products, Rule sets, Decisions, Security
- Screens the trim hides: Workforce
- Sub-permissions removed (1): `attendance.read`
- Sub-permissions added (0): none

### `ROLE-RULE-APPROVER`

- Screens now (8): Home, Notifications, Lenders, Products, Workforce, Rule sets, Decisions, Security
- Screens after the sub-permission trim (7): Home, Notifications, Lenders, Products, Rule sets, Decisions, Security
- Screens the trim hides: Workforce
- Sub-permissions removed (1): `attendance.read`
- Sub-permissions added (0): none

## Decisions for the owner

Each of these is a business authorisation, so none is made here. Say yes or no per line and it becomes one reviewed grant or revoke statement.

1. **Older codes that still open screens.** Where a role holds `finance.view`, `payout.request`, `payout.record_payment`, `connector.manage`, `user.manage`, `config.manage` or another code that the transition alias accepts, the screen stays open after the sub-permission is removed. The per-role lists above show which. The Roles page gives Branch Manager no finance screen, Commission Approver only Commission, Payouts and Approvals, and Org Owner no `user.manage`. Removing these codes is a revoke on live tenants.
2. **`ledger.journal_post` is not granted to anyone, on purpose.** Manual journal posting over the API is closed to every human session by `LedgerService.assertManualPostingAllowed` and pinned by `TEST-HARD-LED-06`, pending audit decision D-03. The permission exists and is held by no role. Wiring it in is a one-line change once D-03 is made.
3. **`finance.view` must stay with whoever creates ledger accounts.** `POST /v1/ledger/accounts` is a write that today needs only `finance.view`. Removing `finance.view` from Finance Executive would leave nobody able to create an account. Either keep `finance.view` on Finance Executive and Org Owner, or name a ledger-account permission first.
4. **Adjustment approvers and the reconciliation list.** `GET /v1/adjustments` needs the reconciliation read permission. Commission Approver approves adjustments (SOD-07) but, under the target above, would not hold `reconciliation.view` and could not list them. Grant it, or let `adjustment.approve` open the list.
5. **Where the two Notion pages disagree.** Tenant Administrator: the Roles page lists no finance or connector screens, the Catalogue snapshot shows broad finance and connector access. Branch Manager: finance, API, integration, import and export grants on hosted are not in its Roles page profile. Commission Approver: the Roles page gives it `payout.record_payment`, while the sequence diagram has Finance Executive execute the bank batch (`payout.disburse` now separates the two). Org Owner: `role.manage` without `user.manage`. Loan Operations: the Catalogue page lists Document sharing and Verifications, the Roles page lists neither. RM: holds `verification.read` on hosted, which the Roles page does not give it.
6. **`lender.read` and `product.read`.** Lenders and Products were open to every staff user and are now gated by these two existing permissions, which the backfill gave to every customer-tenant role. No Notion page says which roles should hold them, so the proposal removes neither. Say who should.
7. **`complaint.read` is backfilled to roles that hold only `complaint.create`.** The API does not yet use `complaint.read` (the list still needs `complaint.manage`), so those roles still get an in-page "no access" message on the Grievances screen. Decide whether intake-only roles may list complaints before the API is wired.
8. **Roles on other tenants.** The hosted tenants Alpha, Beta and Demo DSA hold fewer grants for the same role codes (`docs/PERMISSION_RECONCILIATION.md` section 3). This document covers `qloax-dsa` only.

## Before you apply anything

- Apply migration M-098 first, to every tenant, then deploy the code that uses the sub-permissions. The web and the API no longer accept `application.read`, `customer.read`, `lead.read`, `report.read` or `audit.read` as a way into the screens that were split from them (`BROAD_PARENTS`), because the backfill already gave every current holder the new code. Code deployed before the migration would hide those screens for everyone.
- **The API enforces these sub-permissions** (a role holding only the new code is let in, a role holding only a broad code such as `application.read` is refused, and the older feature-specific code still works during the transition): `lender_case.read`, `sanction.read`, `disbursement.read`, `eligibility.read`, `commission.view`, `payout.view`, `payout.disburse`, `ledger.view`, `reconciliation.view`, `invoice.view`, `audit.seal`, `security.read`, `privacy.read`, `role.read`, `org.manage`, `settings.manage`, `message_template.manage`, `user.invite`, `user.offboard`, `access_review.manage`, `connector.bank_account_manage`, `connector.agreement_manage`, `connector.portal_user_manage`, `target.read` and `import.read`. `apps/api/test/sub-permission-gates.spec.ts` proves each route.
- **Screen-only on purpose** (removing them hides the screen and changes no data access): `activity.read` (the feed shows the caller's own activities, or a subject's activities under that subject's own read permission) and `attendance.read` (the Workforce screen; the attendance list already shows a non-manager only their own records, and the backfill gave `attendance.read` to every role, so using it to mean "see everyone's attendance" would widen access).
- **Not enforced by the API yet:** `performance.read` (dashboards and the leaderboard share one report gate with the report catalogue), `user.read` (the staff list is an open directory used by assignment pickers), `complaint.read` (see decision 7), `team.manage` for work-queue create and edit (still `config.manage`, because the backfill would otherwise give every `user.manage` holder, such as Branch Manager, the right to create queues), document types and reason maps (still `config.manage`), and `ledger.journal_post` (decision 2). For these, removing the sub-permission hides the screen but does not close the API.
- Re-run this document's numbers against a fresh read of the hosted grants.
