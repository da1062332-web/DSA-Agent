# E2E coverage: features and roles

Mocked Playwright specs in this folder (API calls are stubbed, so no database is needed). Run all: `npm run test:e2e`. Run one: `npx playwright test e2e/08-loan-operations.spec.ts -g TC-LO-04`. Add `--headed` to watch the narrated demo.

Manual counterpart: the Notion guide "DSA CRM Manual Testing" (one folder per role). The test ID tells you the role; the manual page has the same flow in plain steps.

## Role specs (what each role does and must not do)

| Spec | Role | Feature covered | Test IDs |
|---|---|---|---|
| 01 | Platform Super Admin | Tenant directory, feature flags, background jobs, support-access boundary | TC-PSA-01, 02, 03 |
| 02 | Tenant Admin | Staff users, roles and permission matrix, admin SoD boundaries | TC-TA-01, 02, 03 |
| 03 | Organisation Owner | Portfolio overview, connectors, dual-control limits | TC-OWN-01, 02, 03 |
| 04 | Branch Manager | Branch pipeline and queues, task delegation, branch data scope | TC-BM-01, 02, 03 |
| 05 | Team Manager | Team workload, task and SLA supervision, boundaries | TC-TM-01, 02, 03 |
| 06 | Relationship Manager | Lead intake and validation, duplicates, contact attempts, qualify and convert, consent record and withdrawal, boundaries | TC-RM-01 to 06 |
| 07 | Sales Executive | Lead intake and validation, activity and follow-up task, boundaries (incl. Eligibility, Documents, Document sharing, Connector portal refused) | TC-SE-01, 02, 03 |
| 08 | Loan Operations | Sanction terms and tranche limit, SOD-04, lender package and submit, step-up, lender query and response | TC-LO-01 to 08 |
| 09 | Document Verifier | Verification case and checklist attestation, rejected-item block, boundaries (incl. Leads, Customers, Document sharing refused) | TC-DV-01, 02, 03 |
| 10 | Compliance Officer | Audit search and chain verification, evidence export, privacy register, read-only boundary | TC-CO-01, 02, 03 |
| 11-12 | Rule Author and Approver | Draft, validate, simulate, review, SOD-01, step-up, author cannot approve or publish | TC-BRE-01 to 04 |
| 13 | Finance and Commission Approver | Payout dual control, UTR recording, commission plan maker-checker | TC-FIN-01 to 04 |
| 14 | Customer (secure link) | OTP gate, valid upload, file type and 15 MB limit, expired, revoked and tampered links | TC-CUST-01 to 06 |
| 16 | Full Lifecycle Demo | Unbroken Golden Path from Multi-Tenant Organisation Setup to Customer Document Upload, Verification, Sanction, Dual-Control Disbursal, Commission Payout & Cryptographic Audit | TC-DEMO-FULL-01, 02 |

## Feature x role matrix (spec 15)

`15-feature-role-matrix.spec.ts` opens every sidebar screen as every customer-tenant role and checks it against the app's own rules (`apps/web/src/shell/access.ts`):

- `TC-MATRIX-00`: every sidebar screen is listed in the matrix (fails when someone adds a menu item without a test).
- `TC-MATRIX-<ROLE>`: the sidebar shows exactly the screens that role may open, and none it may not.
- `TC-MATRIX-<ROLE>-ROUTES`: each screen opens with its page header, or shows "You do not have permission" when the role is refused.

Screens covered (47): Tasks, Approvals, Activity, Notifications, Leads, Customers, Messaging, Grievances, Applications, Documents, Document sharing, Verification, Verification workbench, Lender cases, Sanction and disbursement, Eligibility, Lenders, Products, Commission, Payouts, Ledger, Invoices, Reconciliation, Connectors, Workforce, Connector portal, Performance Dashboard, Targets, Leaderboard, Reports, Rule sets, Decisions, Automation rules, Users, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy and consent, Security incidents, Integrations, API management, Import and export.

## Known gaps (no automated test yet)

- Staff checklist upload, view, review and waive on `/documents`, quarantined files, and the Supabase Cloud Storage card.
- Eligibility run and override, Connector portal referral and payout request.
- Grievances, Messaging send, Targets, Reports filters, Import/Export, Integrations, API keys, Automation, Ledger and Reconciliation actions beyond opening the screen.
- Live (real API) flows: only `TC-SE-LIVE-01` exists (see `LIVE-SETUP.md`).
