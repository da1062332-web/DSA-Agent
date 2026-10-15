# Pending approvals and coordination (Vaibhav's modules)

Drafts only. Nothing here has been applied to the hosted database, and none of it changes another developer's code.
Date drafted: 2026-10-15.

## 1. Module 1 (Tenant): `platform.console` and `platform.flags` for ROLE-PLATFORM-SUPERADMIN

**Why.** `apps/api/src/modules/platform-admin/router.ts` requires `platform.console` and `platform.flags`. Hosted has neither
permission, so nobody can open the Platform Console.

**One design point to confirm.** `role` is per tenant (`tenant_id NOT NULL`, `UNIQUE (tenant_id, code)`), so a
ROLE-PLATFORM-SUPERADMIN row has to live in a tenant. Hosted has Alpha, Beta and Demo DSA tenants, and no platform tenant.
Options: (a) a dedicated "platform" tenant that holds the operators, or (b) add the role to an existing tenant.
Option (a) matches the spec ("the platform console shows no tenant business data"). The draft below assumes
a tenant whose id you supply.

**Draft migration (proposed file name `20261001000044_platform_permissions.sql`, Dev 1 range 0040-0049). Not created in
`supabase/migrations`, not applied:**

```sql
SET search_path = app, extensions, public;

-- 1. The two permission codes the platform console already checks.
INSERT INTO permission (code, description, introduced_in) VALUES
  ('platform.console', 'Open the platform console: tenant list, health and entitlements, no business data', 'M-044'),
  ('platform.flags',   'Read and set feature flags',                                                       'M-044')
ON CONFLICT (code) DO NOTHING;

-- 2. The role and its grants, in the tenant that holds platform operators. <PLATFORM_TENANT_ID> is to be confirmed.
INSERT INTO role (id, tenant_id, code, name, is_template, created_by)
VALUES ('rol_platform_superadmin', '<PLATFORM_TENANT_ID>', 'ROLE-PLATFORM-SUPERADMIN', 'Platform super admin', true, 'migration')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_code) VALUES
  ('<PLATFORM_TENANT_ID>', 'rol_platform_superadmin', 'platform.console'),
  ('<PLATFORM_TENANT_ID>', 'rol_platform_superadmin', 'platform.flags')
ON CONFLICT DO NOTHING;
```

Before applying: confirm the platform tenant id, the real `role.id` convention, and that `role_permission` has no other required
columns on hosted (the local migration shows `tenant_id`, `role_id`, `permission_code`). Add the MANIFEST.md row.

## 2. Module 16 (Applications): proposed withdraw and reopen transitions (NOT approved, not implemented)

The spec page names the states, the permissions and who holds them. It does not contain the T-APP table, so the from/to
rules below are a **proposal** for the product owner to approve or change.

Statuses: DRAFT, DOCUMENTS_PENDING, UNDER_REVIEW, READY_FOR_SUBMISSION, SUBMITTED, SANCTIONED, PARTIALLY_DISBURSED,
DISBURSED, CLOSED, REJECTED, WITHDRAWN, CANCELLED.

Built today: T-APP-01 DRAFT to DOCUMENTS_PENDING, T-APP-02 DOCUMENTS_PENDING to UNDER_REVIEW, T-APP-10 cancel
(DRAFT, DOCUMENTS_PENDING, UNDER_REVIEW to CANCELLED, reason required).

| Proposed | From | To | Permission (spec) | Rules to confirm |
|---|---|---|---|---|
| Withdraw | DRAFT, DOCUMENTS_PENDING, UNDER_REVIEW, READY_FOR_SUBMISSION | WITHDRAWN | `application.withdraw` | Reason required. Once a lender case exists the withdrawal should go through the case (case WITHDRAWN) and roll up. Is a withdraw from SUBMITTED allowed at all? |
| Reopen | WITHDRAWN, CANCELLED | DOCUMENTS_PENDING | `application.reopen` | Reason required. Time limit? Does the checklist reset? Is the same product version kept or re-pinned? |
| Reopen terminal | REJECTED, CLOSED | UNDER_REVIEW | `application.reopen_terminal` | Spec gives no role. Suggest ROLE-ORG-OWNER only, with a reason and an audit event. |

Roles, from the spec page (hosted today in brackets):

| Permission | Spec roles | Hosted today |
|---|---|---|
| `application.create`, `application.update` | ORG-OWNER, BRANCH-MGR, TEAM-MGR, RM, LOAN-OPS | RM only (plus the Demo tenant admin) |
| `application.read` | the above plus COMPLIANCE, AUDITOR | RM, TEAM-MGR, BRANCH-MGR, LOAN-OPS, ORG-OWNER, COMPLIANCE |
| `application.assign` | ORG-OWNER, BRANCH-MGR, TEAM-MGR | no `application.assign` code exists |
| `application.withdraw` | RM (own), TEAM-MGR, BRANCH-MGR, LOAN-OPS, ORG-OWNER | no code exists |
| `application.cancel`, `application.reopen` | TEAM-MGR upward | cancel: RM only |
| `application.review`, `application.close` | ORG-OWNER, BRANCH-MGR, LOAN-OPS | review: BRANCH-MGR, LOAN-OPS (close: no code) |

Release-plan note: the spec defers withdraw and reopen to TASK-433, which is outside the first release.

## 3. Messages to send (drafts)

**To Bhushan (Modules 14 and 15 routing).**
> Bhushan: `/lenders` and `/products` currently open your `features/lenders` and `features/products` pages. Vaibhav's
> pages (`features/admin/LendersPage`, `ProductsPage`, `ProductDetailPage`) call the same API, support edit,
> deactivate and new product versions, and are covered by 27 passing tests. Plan: point both routes at Vaibhav's pages and keep
> your pages in the repo, unrouted, as a reference until the team agrees. Your `catalogue-service.ts` and `repository.ts` are
> not imported by anything. OK with you? Nothing changes until you reply.

**To Akash (Module 17).**
> Akash: Eligibility is blocked on you. Which decision key and rule set should `eligibility` read (the registry has no
> eligibility key), and what are the inputs and outcomes? `DK-application.completeness` currently defaults to INCOMPLETE and
> `DK-document.requirements` to PAN_CARD. I'll start once the rule sets are approved.

**To Samarth (stale tokens and demo ids).**
> Samarth: `lender-cases/api.ts`, `sanctions/api.ts` and `TaskList.tsx` read `dsa_token` or `dsa_auth_session` from localStorage. The sign-in
> code deletes those keys on load, so these screens send no token and get 401. Please switch them to `getStoredAuthToken()` or the
> shared `apiFetch`. The routes also pass the hard-coded `app_demo_001` and `lcs_demo_001`; they should take the application and
> case from the page. Also: lead complaints need your lead check wired to the grievance subject port.

## 4. Waiting for confirmation (no work possible yet)

- Module 17 Eligibility: Akash's approved rule sets.
- Module 20 Documents: the confirmed attestation contract.
- Module 14: the spec says lenders are readable by "any staff" (API-LND-002), so the current open read matches the plan. No new
  permission is needed unless the product owner wants one.

## 5. Module 13 (Grievances): complaint due-date rule (decision needed)

Today `dueAt` is optional and nothing sets it, so no complaint can show as overdue. The spec names no number of days.
Options (please pick one):

| Option | Rule | Effect |
|---|---|---|
| A | Handler sets the due date by hand (as now) | No overdue tracking unless people remember. |
| B | Default due date = acknowledgement date + N days for every complaint | Simple. Needs N (the RBI grievance norm is often cited as 30 days, but confirm with compliance). |
| C | N depends on category (for example service 7 days, fraud 3 days) | Most accurate, needs a category table from compliance. |

Nothing is implemented until one is chosen. Option B would be a small change in `complaints.ts` plus a test.

## 6. Done without anyone else (2026-10-15)

- Toasts on every write, permission-based sidebar (including admin, reporting, performance and import items),
  no retry on 401/403, and a single clear "You don't have access" message for every 403 (screens and toasts).
- Messaging page shows a notice when its requests are refused.
- Tests added for the sidebar, retry policy, MFA helper, toast behaviour, Grievances access and the 403 message.

## 7. Module 17 (Eligibility): built as a skeleton, waiting on approvals and rules (2026-10-15)

Built and tested locally: API-ELG-001 (run), 002 (history), 003 (override), the Eligibility card on the application page,
and migration `20261001000048_eligibility.sql`. **The migration is not applied to hosted.** Until it is, the endpoints return an error
on hosted because the table does not exist.

Needs from others before it does real work:
- **Akash:** a published eligibility rule set. Until then every criterion is UNKNOWN (the spec's rule for missing data).
  The one place to connect it is `evaluateCriteria` in `apps/api/src/modules/origination/applications/eligibility.ts`.
- **You:** approval to apply `20261001000048_eligibility.sql` to hosted, and which roles get `eligibility.override`
  (the spec says "approver roles"; no role is granted today).

## 8. Beta cannot build a fresh database (found 2026-10-15, not caused by this work)

The local live-database and isolation suites fail on a clean beta checkout because of Akash's migrations:
1. `20261001000019_verification.sql` references `loan_application` (created in `…0021`), so it fails when applied in file order.
   The manifest says it depends on M-021. It needs a number after 0021.
2. `20261001000037_api_development.sql` and `20261001000042_audit_tamper_evidence.sql` insert into `app.permission (code, description, task_ref)`,
   but the column is `introduced_in`. Both fail on a fresh database.
Hosted already has these tables and permissions, so hosted is not affected. `supabase db reset` and the CI migrate step will fail.
Merged migrations are never edited (manifest rule 1), so the fix is Akash's: new corrective files, or agreed renumbering.
To test around it, the isolation harness accepts `DSA_MIGRATIONS_DIR` (a corrected copy of the migrations folder).

Also found: 107 `/v1` operations have no isolation case (BRE 27, reporting 10, lender cases 8, commission 8, leads 7, customers 7,
verification 6, sanctions 6, payouts 6, tasks 5, performance 5, messaging 4, activities 4, notifications 3, users 1). None are Module 13 to 17.

Likely cause of RM having no complaint access: migration 0028 grants `complaint.create` and `complaint.manage` to
`ROLE-SUPERVISOR` and `ROLE-AGENT`, which do not exist on hosted, so those grants matched no role there.

