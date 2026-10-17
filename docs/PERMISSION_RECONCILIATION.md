# Permission catalogue and role-grant reconciliation

Status date: 2026-10-17. Evidence: the contracts catalogue (`packages/contracts/src/permissions.ts`, 100 codes), every migration, the demo role seed (`seeds/demo/platform.ts`), the permissions the API routes enforce, and read-only queries against the shared hosted project (permission list, role names with permission counts). Nothing on hosted was changed.

## 1. Why code has 100 permissions and hosted has 87

The difference is exactly 13 permissions, and every one of them is defined by a migration that is **written, rehearsed and not yet applied to hosted**. None of them is missing from the code or defined twice.

| Permission | Defined by | Granted by the migrations | Enforced by a route? | Meaning |
|---|---|---|---|---|
| `role.manage` | 0054 | the five administrator roles (0054) | yes (13 places) | Role editing. Until 0054 is applied, role routes accept `user.manage` instead (`requireAnyPermission`), so nothing is locked out. |
| `finance.period_close` | 0056 (ledger) | ROLE-COMMISSION-APPROVER and ROLE-ORG-OWNER (0056) | yes (ledger period close) | Release 3 ledger. Not in the hosted batch. |
| `security.incident` | 0063 | ROLE-ORG-OWNER, ROLE-COMPLIANCE, ROLE-TENANT-ADMIN (0063) | yes (5 places) | Needed before the security events and incidents screen can be used on hosted. |
| `security.vuln` | 0063 | the same three roles (0063) | no | Vulnerability management is not built. Defined only. |
| `commission.plan.edit` | 0060 | nobody | yes (Release 3 commission) | Deliberately granted to nobody until commission is promoted. |
| `commission.plan.approve` | 0060 | nobody | yes (Release 3 commission) | Same. |
| `commission.calculate` | 0060 | nobody | no | Defined for the Release 3 calculation job. |
| `customer.reveal_sensitive` | 0060 | nobody | no | The S3 reveal flow is outside the MVP. |
| `lead.reopen` | 0060 | nobody | yes (falls back to `lead.update` when nobody holds it) | |
| `lender.read`, `lender.manage`, `product.read`, `product.manage` | 0060 | nobody | no | The lender and product routes use their own permissions today. Defined so a role can be given them later. |

Automated guard: `permission-catalogue.spec.ts` TEST-PERM-01 to 05. In particular TEST-PERM-04 pins the nine 0060 permissions to that one migration and to "granted by nothing", and TEST-PERM-05 fails if a route starts enforcing a permission that no migration or demo seed can grant (the only allowed exception is the two Release 3 commission plan permissions, and the test fails if either is ever granted without removing it from its list).

## 2. Hosted today (read-only)

- 87 permissions exist; only `eligibility.override` is granted to no role. That is the pending decision below.
- Everything the hosted API enforces is grantable, except the features that need the 13 above.

## 3. Why tenants' roles differ

Role grants for customer tenants are not created by migrations. They come from the demo seed and from one-off scripts, run at different times. Counts by role name on hosted: branch manager 38 to 40, compliance 1 to 6, tenant admin 55 to 61, RM 9 to 18, and the rest identical across tenants. The tenants with the smallest numbers are test tenants. This is drift between seeding runs, not a tenant leaking into another: row-level security separates tenants regardless (isolation suites 53/53 on PostgreSQL 16 and 17). I did not "fix" the counts: nobody has specified the intended set per role, and changing a tenant's grants is a hosted write.

What is enforced in code, regardless of seeding:

- an administrator cannot put into a role a permission they do not hold (`TEST-ROLEMGMT-11`);
- customer-tenant roles can never hold `platform.*` permissions;
- the last administrator cannot be removed;
- system (template) roles cannot be edited or deleted through the API;
- role edits require step-up.

## 4. Decision needed from the owner

**`eligibility.override`**: the Notion spec for module 17 says "authorised approvers (approver roles)" and names no roles. Migration 0055 (not applied) proposes ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS and ROLE-TENANT-ADMIN. I did not add or change any grant. Options: apply 0055 as written; restrict to ROLE-ORG-OWNER and ROLE-TENANT-ADMIN; or leave it ungranted until a dedicated approver role exists. Impact: without a grant nobody can override a failed eligibility result (the check itself still works). Roles can be adjusted later in the role editor.

## 5. Role grants against the role catalogue (2026-10-17, demo-alpha tenant on hosted, read-only)

Method: the grants each role holds on hosted, run through the real sidebar rules, compared with the role catalogue in the Notion "Role-Based User Stories" page (a draft "proposed for review", so it guides but does not decide).

**Fixed in code (sidebar):** ten screens were shown to every signed-in user whatever their grants (Leads, Customers, Activity, Verification workbench, Automation rules, Commission, Payouts, Reconciliation, Invoices). A rule author saw Leads, Commission and Payouts, and each of those screens would have answered 403. Each is now tied to the permission its list endpoint enforces (`Sidebar.tsx`), with a test per role (`role-navigation.spec.ts`, 9 roles) and a test that a user with no grants sees only Home, Notifications, Lenders, Products and Workforce (spec: any staff). Navigation is never the control: the API still enforces every permission.

**Fixed by migration, waiting for hosted:** 0064 grants the sanction and disbursement permissions to owner, tenant admin, branch manager and loan operations. On hosted only owner and tenant admin hold them, so Loan Operations (whose catalogue duty is "record sanction/disbursement milestones") and Branch Manager cannot open that screen. The migration is idempotent and is in the batch.

**Grant gaps I did not change (business authorization, owner to decide):**

| Role | Catalogue duty | What hosted lacks |
|---|---|---|
| ROLE-COMPLIANCE | "Review consent, document sharing, complaints and compliance evidence" | `complaint.manage` (no Grievances screen), `share.create` / `document.upload` (no Document sharing screen) |
| ROLE-BRANCH-MGR | stories for grievances, performance, workforce | `complaint.manage`, `report.read`, `target.manage` (no Grievances, Performance or Targets screens) |
| ROLE-TEAM-MGR | stories for performance | `report.read` (no Performance screen) |
| ROLE-LOAN-OPS | "Prepare files, submit lender cases, handle queries" | no lead or customer read; consistent with the catalogue, listed so it is a conscious choice |
| ROLE-VERIFIER vs ROLE-DOC-VERIFIER | the catalogue has only ROLE-DOC-VERIFIER | `ROLE-VERIFIER` is an older duplicate with the same 7 permissions |

Nothing here is an inconsistency between code and database; each row is a question for the role owners: should the role hold that permission? Say yes and it is one grant statement per row, reviewed like the batch.
