# Module 1 (Tenant): platform realm. Review package

Status: **prepared for review. Nothing in this package has been applied to the hosted database.**
Migration: `supabase/migrations/20261001000050_platform_realm.sql` (in the repository, not applied).
Date: 2026-10-15. Prepared by Vaibhav's assistant. Piyush owns the platform-admin code and must review it.

## 1. What was wrong (found in review)

### 1.1 Permission grants in migration 0046

| Grant | Where it is on hosted today | Verdict |
|---|---|---|
| `platform.console`, `.flags`, `.master_data`, `.jobs`, `.support_access`, `.release` | `ROLE-ORG-OWNER` and `ROLE-TENANT-ADMIN` of 5 tenants (30 grants, 7 users) | **Wrong.** MODULE 1 and 40 give these to ROLE-PLATFORM-SUPERADMIN and ROLE-PLATFORM-SUPPORT only. |
| `data_correction.request` | `ROLE-ORG-OWNER`, `ROLE-TENANT-ADMIN`, `ROLE-BRANCH-MGR`, `ROLE-LOAN-OPS` | **Correct, tenant realm.** Routes are `/v1/data-corrections`, requested inside a tenant. Unchanged. |
| `data_correction.approve` | `ROLE-ORG-OWNER`, `ROLE-TENANT-ADMIN` | **Partly wrong.** The spec says the tenant `ROLE-TENANT-ADMIN` approves. Removed from `ROLE-ORG-OWNER` only. This one is a judgement call: say if the owner should keep it. |

### 1.2 Problems beyond the grants

| # | Finding | Severity |
|---|---|---|
| 1 | `feature_flag` and `master_data_item` had no row-level security, and `dsa_app` can INSERT/UPDATE them, so the database let any tenant session change global flags and master data. Only the API check stood in the way. | High |
| 2 | The router skipped every permission check for a `SERVICE` principal. | High |
| 3 | The support-access and data-correction services stored data in memory (not in the tables 0046 created) and trusted a `tenantId` from the request body. | High |
| 4 | Support-access approval needed only `config.manage` in any tenant, and was not tied to the request's tenant. Any tenant administrator could approve any tenant's request. | High |
| 5 | A tenant admin holding `platform.support_access` could list every tenant's support requests with `?tenantId=`. Data-correction approve and execute were not tenant-scoped. | High |
| 6 | The health route had no permission check at all. | Medium |
| 7 | The console tenant list swallowed database errors and returned **made-up tenants and counts** (12 users, 48 applications, a fixed entitlement list). The service also seeded a fake APPROVED support grant and an APPROVED data correction. | Medium |
| 8 | Piyush's live tests wrote rows to the hosted project: `support_access_grant` and `data_correction_request` each hold one test row (created_by `TEST` and `usr_maker`). | Low (cleanup needs approval) |

Items 2 to 7 are code and are fixed in this package. Items 1 and 3 to 5 need the migration to be fully closed in the database.

## 2. The design

- One dedicated tenant, `ten_01M4ZG67WTS51Q0XN7F1Y9CCYG` ("Platform Operations", type `PLATFORM`), holds platform operators. Constant `PLATFORM_TENANT_ID` in `packages/contracts/src/platform-realm.ts`.
- `ROLE-PLATFORM-SUPERADMIN`: the six `platform.*` permissions plus `audit.read` (for the platform tenant's own audit trail).
- `ROLE-PLATFORM-SUPPORT`: `platform.console` and `platform.support_access` only ("metadata only").
- Realm rule in the API: a platform permission works only for a signed-in **user** of the platform tenant. A tenant administrator with the same code is refused. Tenant routes (approvals, data corrections) work only for a user of a customer tenant, so an operator cannot approve their own request. Service identities have no shortcut in either realm.
- Realm rule in the database: `app.is_platform_realm()` is true only in a session whose tenant is the platform tenant. Policies:

| Table | Platform session | Customer-tenant session |
|---|---|---|
| `tenant` | read all rows (metadata) | own row only (unchanged) |
| `feature_flag`, `master_data_item` | read and write | read only |
| `support_access_grant` | read all, insert a PENDING request, **no update** | read own, update own (approve, deny, revoke), no insert |
| `data_correction_request` | **no access** (it holds old and new business values) | own rows (unchanged) |
| all business tables | **no access** (unchanged) | own rows (unchanged) |

- Cross-tenant aggregate: `platform_tenant_user_counts()` returns active users per tenant (counts only), refuses to run outside the platform realm, and is the only cross-tenant read besides the tenant row.
- Audit: every platform action and every cross-tenant read writes an audit event in the platform tenant (`platform.tenants_listed`, `platform.flag_set`, `platform.queue_paused`, `platform.support_access_requested`, `...approved`, `data_correction.requested`, and so on). Support-access events are written in the same transaction as the change.
- MFA: all six `platform.*` codes and `data_correction.approve` are now in the mandatory-MFA list (API and web), so any platform operator needs an aal2 session. Step-up on individual platform actions is not added.

## 3. What the migration does to hosted (exact effects)

1. Creates function `is_platform_realm()` and, after review, `platform_tenant_user_counts()`.
2. Replaces the `tenant_type` check to allow `PLATFORM`.
3. Inserts 1 tenant, 2 roles, 9 role grants (platform tenant only).
4. **Deletes 30 `role_permission` rows** (the operator permissions of tenant roles) and **2 rows** (`data_correction.approve` of the owner role).
5. Adds policy `platform_read` to `tenant`; enables and forces RLS on `feature_flag` and `master_data_item` with 3 policies each.
6. `support_access_grant`: adds 3 columns with defaults, replaces the status check, adds a four-hour window check (`NOT VALID`, so the one leftover test row is not rejected), replaces the single `tenant_isolation` policy with 3 policies.
7. Does not touch `data_correction_request`, any business table, any user, or any other role.

Not done by the migration: creating the first platform user. After approval, create the superadmin in Supabase Auth, add the `app_user` row in the platform tenant, and assign `ROLE-PLATFORM-SUPERADMIN` (MFA enrolment follows at first sign-in).

## 4. Impact analysis

| Who | Effect |
|---|---|
| 7 users who hold `platform.*` today (tenant admins and owners) | Lose the Platform Console and its sidebar item. Nothing else changes for them. |
| Tenant administrators | Still approve support access and data corrections, but **there is no screen for it yet**: those tabs are inside the Platform Console page, which only operators can open. The APIs work (`/v1/support-access-requests`, `/v1/data-corrections`). A small tenant-side approvals page is the follow-up. |
| Platform operators | New: sign in as users of the platform tenant. They see tenant metadata and active-user counts. Business counts show as null. Entitlements show empty until SUB-TEN.03 exists. |
| Piyush's tests | `platform-admin.spec.ts` updated (17 tests, was 9): platform principal now uses `PLATFORM_TENANT_ID`, tenant and platform permissions are separated, in-memory store injected. His `platform-admin-live-pg.int.spec.ts` is unchanged and still reads and writes hosted when `DATABASE_URL` is set, see risk below. |
| Fresh database builds | Unchanged by this work. They still fail on Akash's migrations 0019, 0037 and 0042, so the new live tests ran on a corrected copy of the migrations folder. |

## 5. Test results (local only)

| Suite | Result |
|---|---|
| `platform-admin.spec.ts` (unit, Piyush's file updated) | 17 passed |
| `platform-realm.int.spec.ts` (new, real PostgreSQL 16, RLS applies) | 10 passed |
| Full API unit suite | 736 passed (51 files) |
| Web suite, kernel suite | 199 passed, 21 passed |
| Typecheck (root, web, api), web production build | clean, built |
| Lint on changed files | clean except 3 errors in `platform-admin-service.ts` that exist unchanged in the committed original |
| Live-database regression on the corrected migrations (platform.int, mfa.int, eligibility, applications.int, grievances.int, catalogue, platform-realm) | 77 of 78 passed. The one failure, `TEST-ORG-INT-01` (expected 422 to be 409), fails identically without migration 0050, so it is not caused by this work. |
| Isolation suite | 31 of 32 passed; the failure is the known inventory check (107 operations of other modules without isolation cases) |

What the 10 live tests prove: platform roles and grants exist and no customer-tenant role holds an operator permission; the two DELETE statements remove exactly the intended grants and keep the tenant admin's; the tenant list shows metadata only, excludes the platform tenant, and is audited; a tenant admin holding every platform code gets 403 and the database shows them only their own tenant and refuses the count function; flags and master data are readable by all and writable only by a platform session; the full support-access lifecycle (operator files, operator cannot approve through the API or SQL, another tenant sees nothing and gets 404, the target tenant approves, the audit trail has both events); the database refuses a pre-approved insert, a tenant-made insert and a five-hour window; the platform realm reads no data-correction values and no rows of nine business tables.

## 6. Reconciliation of migrations 0044 to 0049 (repository, manifest, hosted)

| Migration | In repo | In manifest | Hosted state | Finding |
|---|---|---|---|---|
| 0044 payout permissions and roles | yes | yes (M-044) | 4 permissions present; `ROLE-COMMISSION-APPROVER` in **5 of 6** tenants | Test Tenant B (`ten_01JTESTTENANT00000000000002`) lacks the role. Likely created after 0044 ran. Role ids use prefix `rol_` (other roles use `role_`). |
| 0045 messaging role grants | yes | yes | 16 grants expected, 16 present, none missing | Matches exactly. |
| 0046 platform admin | yes | yes | tables and permissions present | Grants wrong (section 1); flags and master data without RLS; 2 leftover test rows. Fixed by 0050. |
| 0047 verifier roles and grants | yes | yes | `ROLE-DOC-VERIFIER` 6/6, `ROLE-VERIFIER` 6/6, `ROLE-COMPLIANCE` 6; `verification.*` and `document.review` present | Matches. |
| 0048 eligibility | yes | yes | applied and verified earlier today | Matches. |
| 0049 reconciliation | yes | yes | not checked in this review | Needs Piyush's confirmation that it is applied. |

The manifest now has rows for 0044 to 0050 after this change (M-050 added). Piyush's migrations 0044 to 0049 are in the repository, which closes the earlier gap.

## 7. Risks and what is deliberately not done

- **Piyush's live tests run against hosted.** `platform-admin-live-pg`, `connectors-live-pg`, `messaging-live-pg`, `payouts-live-pg` and `reconciliation-live-pg` read `DATABASE_URL` from `apps/api/.env`. With a hosted URL in that file, `npm run test:int` writes test rows into the hosted project. Run int suites by name only, or point `DATABASE_URL` elsewhere. This should change.
- Feature flags, master data, queues, dead letters, releases and **data corrections are still in memory** (lost on restart, separate per mount). Only tenant metadata and support access are database-backed. Data corrections need a table that matches the spec (ENT-112); the 0046 table has a different shape and is unused by the service.
- No step-up on individual platform actions, no real tenant lifecycle endpoints (`platform.tenant.*` from the spec are not in the permission catalogue).
- Support access grants a **record**, not a session: nothing yet lets an operator act inside a tenant. The grant is metadata and audit only.
- The two leftover hosted test rows are not deleted (a hosted change).
- Rollback: the migration is additive except the 32 deleted grant rows. To roll back, re-insert those grants from migration 0046's statements and drop the new policies and function. Taking a backup of `app.role_permission` before applying is recommended.

## 8. Message for Piyush (draft, not sent)

> Piyush: Vaibhav is moving the platform permissions out of the tenant roles (spec: only ROLE-PLATFORM-SUPERADMIN and
> ROLE-PLATFORM-SUPPORT hold platform.*). Review this PR, mainly `platform-admin/router.ts`, the new `platform-store.ts`, and
> `supabase/migrations/20261001000050_platform_realm.sql`. Things that change in your area: (1) platform routes now need the
> permission AND a user of the platform tenant; tenant routes (support approval, data corrections) need a customer-tenant user;
> (2) the SERVICE bypass in the router is gone; (3) support access and the tenant list now use the database
> (PgPlatformStore); the in-memory store is only for unit tests; (4) data corrections ignore a body tenantId and use the
> signed-in tenant; (5) I edited platform-admin.spec.ts to match. Please also: stop your live-pg tests writing to the hosted
> project, tell us whether 0049 is applied, and say if ROLE-ORG-OWNER should keep data_correction.approve. Nothing is applied to hosted.
