# Connector containment: root cause and application-side fix (2026-11-06)

**Status:** application-side fix committed locally as `682d581` on `beta`. Not pushed, not deployed. The hosted state was not re-verified in this session, and nothing was written to hosted.

Written for: the developers, the tenant owner, and the staff operator who runs the hosted containment.

## 1. Summary

A connector portal login could hold an internal role (`ROLE-RM` on the partner login recorded in the containment runbook). The API refuses to create such a role and the internal API refuses connector logins, but nothing stopped the permission loader from giving a connector login the grants of a role row that was already open. `GET /v1/me` also returned the role codes to the connector. This change closes both read paths in the application. The hosted row itself is an owner action (section 5).

## 2. Code paths audited

| Path | File | Finding | Change |
|---|---|---|---|
| Grants loaded for every user type | `packages/kernel/src/auth/resolve-principal.ts` (grants query) | Joined `user_role_assignment` for any `app_user`, including `CONNECTOR`. An open role on a portal login became live grants. | Fixed: connector logins get no grants and their role rows are not read |
| Role codes on `GET /v1/me` | `apps/api/src/modules/platform/router.ts` (`/me`) | Returned the role codes of any user, including a connector | Fixed: `roles` is empty for a connector |
| Role assignment refused for connectors | `apps/api/src/modules/platform/role-guards.ts` (`assertRoleAllowedForUserType`); `router.ts` (role routes, about line 1705); `user-lifecycle.ts` (lines 281, 715) | Refused. Each reads the user type from the database | None |
| Internal API gate | `apps/api/src/http/connector-identity-gate.ts`; `apps/api/src/app.ts` (lines 154, 178) | Refuses connector logins on `/platform/v1` and `/v1`, except `GET /me` and `GET /v1/me` | None |
| Database guard | `supabase/migrations/20261001000097_connector_role_guard.sql` | Refuses role rows on connector logins and type changes while a role is open | None (migration is immutable) |
| Portal ownership | `apps/api/src/modules/partner-view/portal-standing.ts` (`standing`) | Connector comes from the server-side login row (`app_user.connector_id`), joined to a connector in the same tenant and `ACTIVE`. Does not read grants, so the fix does not affect the portal | None |
| Activation | `apps/api/src/modules/origination/connectors/connector-service.ts` (`assertConnectorVerification`, lines 183–215; called at about line 700); `router.ts` (lines 206–211) | Activation needs a `VERIFIED` record whose subject is this connector. Generic records are refused | None |

## 3. Root cause

- **Writers and readers were guarded unevenly.** The API and the database refuse to create a role on a connector login (once 0097 is applied). Neither stops a row that already exists from being read. The permission loader trusted every row.
- **How the hosted row was written is not established from the repository.** Writers in the repository that can create a role row without a connector check:
  - `tools/sql/0054/apply.sql` (`created_by = 'SYSTEM:platform'`): gives `ROLE-RM` to active users with no role. The staff-only filter is applied when it runs, so a login that later becomes a connector keeps the row.
  - `tools/apply_fixes_to_hosted_db.ts` (`created_by = 'system_audit_reconcile'`): the same pattern.
  - `tools/provision-tenant.ts` and `tools/provision-platform-admin.ts`: tenant and platform seeding, not a connector path.
  - The runbook records `created_by` as `SYSTEM`. That matches none of these values exactly, so the evidence export is the authority.
  - `git log -S` finds no commit that adds role writes to the connector code.
- **No API path changes a user's type after creation.** A grep of `apps/api/src` finds no `UPDATE` that sets `user_type`. A login that changed type did so outside the API. Migration 0097 now blocks that.

## 4. Changes (commit `682d581`, branch `beta`)

- `packages/kernel/src/auth/resolve-principal.ts`: new `effectiveGrants(userType, rows)`. It returns `[]` for `CONNECTOR`. The resolver skips the role query for connector logins.
- `apps/api/src/modules/platform/router.ts`: `GET /me` returns no role codes for a connector login.
- `packages/kernel/src/auth/resolve-principal.spec.ts`: `TEST-CONCONTAIN-001` to `004`. These cover a connector with an open `ROLE-RM` row, a connector with no rows, and staff behaviour unchanged (branch grants kept, unknown codes and repeats dropped).

Not changed: the gate, the role guards, migration 0097, the portal code.

## 5. Hosted state: records conflict (owner action)

| Source | What it says |
|---|---|
| `docs/CONNECTOR_CONTAINMENT_RUNBOOK.md` (2026-10-29) | Open role, not executed |
| `docs/HOSTED_STATUS_REFRESH_2026-10-29.md` | Role still open-ended |
| `docs/CONNECTOR_SECURITY_REMEDIATION.md` (2026-10-29) | Migration 0097 not applied; containment not executed |
| `docs/CONNECTOR_HOSTED_DEPLOYMENT_CHECKLIST.md` header (2026-10-29) | Role ended, 0097 applied, owner-approved. Section 1 checkboxes unticked |
| `docs/FIX_PLAN_2026-11-06.md` and `docs/PROJECT_AUDIT_2026-11-05.md` | Containment open (C-01) |

Not verified here: no hosted query was run, and no hosted write was made. The owner should run these read-only checks and record the output:

- `tools/sql/remediation/connector-containment.post-check.sql`. Expected: open connector-login roles 0; history row kept (1); `role.assignment_ended` recorded (1); `guard_trigger_installed` true.
- `tools/sql/batch/97.verify.sql`. Expected: no FAIL rows.

Until those outputs are recorded, C-01 stays open in the fix plan.

## 6. Verification

Run here, against a local Testcontainers PostgreSQL through the guarded configs (Docker Desktop started for this run):

- New regression spec `apps/api/test/connector-identity.int.spec.ts`, 5 of 5 pass. It runs the real resolver, `supabaseAuth`, the internal-API gate, `GET /v1/me` and `/portal/v1` against a database. `TEST-CONCONTAIN-INT-01` and `-02` fail on the pre-fix resolver and router and pass with the fix. The other three already passed before the fix and must keep passing.
- The 11 connector integration suites (109 tests): pass. They include the cross-connector cases (`TEST-ACC-PORTAL-03` and `-05`, `TEST-CPT-DSP-03`), which show that changing the id in a portal request does not reach another connector's data, and the verification-gated activation case in `connector-verification.int.spec.ts`.
- API unit suite, whole: 101 files, 1,488 of 1,488 pass. Kernel unit suite: 35 of 35 pass, including 4 new `TEST-CONCONTAIN` cases.
- Typecheck `packages/kernel` and `apps/api`: pass. ESLint on the changed files: 0 errors (one existing `any` warning in `router.ts`, outside this change).
- Migration immutability (`check:migrations`): 92 files unchanged.
- Tenant isolation suite (`npm run test:isolation`): 18 files, 549 of 549 pass.

Not run:

- Hosted: not touched. No hosted query, no hosted write.

## 7. Open items

- Owner: C1 to C5 and the post-check (checklist section 0).
- Owner: confirm the hosted state of migration 0097 and of the role row (section 5).
- Deploy the commit with the next API release. The smoke test in the checklist (section 2) should also confirm that `GET /v1/me` shows no roles for a connector login.
- Known gaps, unchanged: a database superuser can bypass the triggers; suspending a login does not revoke its Supabase sessions; reads are not audited; the resolver's subject-first binding ignores the token's e-mail once a subject is bound.
- The 0054 reconcile step and the fix script still write `ROLE-RM` to staff accounts. They are safe for staff, but without 0097 a later type change would not be caught.
