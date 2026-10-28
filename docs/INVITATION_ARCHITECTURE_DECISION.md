# Staff invitations: architecture decision

Status: **Accepted by the owner on 2026-10-27** (D1, D2, D4, D5 below), for local implementation and verification. Hosted steps still need separate approval: see [INVITATION_HOSTED_CHECKLIST.md](INVITATION_HOSTED_CHECKLIST.md).

Written for: the platform owner and the engineers who maintain staff onboarding.

| Decision | What was approved |
|---|---|
| D1 | Architecture B: a separate provisioning worker creates Supabase Auth accounts, writes tenant claims and sends invitations. |
| D2 | ADR-SB-02 stays unchanged: only provisioning tooling writes `app_metadata.tenant_id`. |
| D4 | An invited user is activated only after a successful password sign-in. |
| D5 | The e-mail identity fallback is removed once every existing account is safely bound to its Supabase Auth subject. |

D3 (rotating the service-role key, remediation step P0-3) is still open. It is a hosted step.

---

## 1. How it works

| Step | Where | What happens |
|---|---|---|
| Invite | API, `POST /v1/users/invitations` (`apps/api/src/modules/platform/user-lifecycle.ts`) | Checks `user.manage`, the tenant (from the session, never the request), the branch, the roles and the e-mail address. Writes `app_user` (INVITED, subject `invite:<user id>`, which no token can carry) and `staff_invitation` (PENDING, delivery QUEUED). Audit `user.invited`. No call to Supabase. |
| Send | Provisioning worker, `tools/provisioning-worker.ts` running `apps/api/src/provisioning/invitation-delivery.ts` | Finds due rows through `app.pending_staff_invitation_deliveries` (SYSTEM context, ids only). Claims each row in its own tenant (QUEUED → SENDING, one worker wins). Creates the Auth account and writes the tenant claim, or reuses an account that already carries this tenant's claim. Binds `app_user.idp_subject` to the account id. Marks the invitation SENT with a 24-hour expiry. Audit `user.invitation_sent`. |
| Fail | Worker | A provider outage is retried with a growing delay (1, 2, 4… minutes, at most 5 attempts), then FAILED (`DELIVERY_FAILED`). An address held by another tenant's account, or by an account with no tenant claim, fails for good (`EMAIL_NOT_AVAILABLE`); such an account is never adopted. A binding that points elsewhere fails as `SUBJECT_CONFLICT`. A request older than 24 hours is not sent late (`REQUEST_EXPIRED`). Audit `user.invitation_failed`. |
| Cancel | Worker | A user who is no longer INVITED (deactivated, suspended) is not sent anything, or, if it was sent meanwhile, the invitation is REVOKED. The worker never changes a user's status. Audit `user.invitation_cancelled`. |
| Resend | API, `POST /v1/users/:id/invitation/resend` | Only for INVITED users; refused while a send is queued or in progress, within 60 s of the last request, and after 5 resends. Queues the invitation again. Audit `user.invitation_resent`. |
| Status | API, `GET /v1/users/:id/invitation` | State (PENDING, EXPIRED, ACCEPTED, NONE), delivery state (QUEUED, SENDING, SENT, FAILED, CANCELLED), failure code, expiry, resend count. |
| Set password | Web, `/accept-invitation` (`apps/web/src/auth/AcceptInvitationPage.tsx`) | The link session sets a password, then every session is ended. |
| Activate | `packages/kernel/src/auth/resolve-principal.ts` | Only when the token subject is the bound account, its `amr` includes `password`, the tenant is ACTIVE, and the invitation is PENDING, SENT and not expired. Audit `user.invitation_accepted` and `user.activated`, in the activation's own transaction. MFA and authorization rules apply after that, unchanged. |

Database: migration 0092 (`staff_invitation`) and 0093 (delivery columns, the discovery function). Neither is applied to any hosted database.

## 2. The key boundary

- The HTTP API has no setting for the service-role key, and removes `SUPABASE_SERVICE_ROLE_KEY` from its own process environment at start-up (with a warning) in case a shared `.env` still holds it.
- No API source outside `apps/api/src/provisioning/` names the key, imports the provisioning code, calls a Supabase Auth admin endpoint, or writes a tenant claim. `apps/api/test/service-key-boundary.spec.ts` checks this on every test run.
- The provisioning code is published as `@dsa/api/provisioning` and run only by `tools/provisioning-worker.ts` and `tools/identity-binding.ts`. They read `apps/api/.env.provisioning` (not committed), connect to the database as `dsa_api` so row-level security applies, refuse `postgres`/`service_role` URLs, and print ids and short codes only.
- The worker starts only with `PROVISIONING_WORKER_ENABLED=true` and a complete configuration. Without the worker, invitations stay QUEUED and can activate nobody.

## 3. Threat model

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | An administrator invites into another tenant, or chooses a tenant claim | The tenant is the session's; the claim is the invitation row's tenant, written by the worker. Tenant B cannot read or resend tenant A's invitations (TEST-FLOW-03, -06). | Low |
| T2 | The HTTP API is compromised | It holds no key and can only record requests; it cannot create accounts or write claims. | Low |
| T3 | The worker or its key is compromised | The key lives in one process; the worker writes as `dsa_api` under row-level security. The key is still a project-wide secret. | **High until the key is rotated (D3)** |
| T4 | Someone pre-registers the invitee's address | An account with no claim or another tenant's claim is never adopted (TEST-WRK-05). | Low |
| T5 | The link is read by someone else | A link session cannot activate (TEST-INV-05, TEST-WRK-01); activation needs a password sign-in. Whoever reads the e-mail can still set the password first: inherent to e-mail onboarding, limited by the 24 h expiry and MFA at first sign-in. | Medium |
| T6 | Duplicate or concurrent sends | One claim per row (TEST-WRK-03); a stale claim is taken over and the account reused (TEST-WRK-04); one PENDING invitation per user; resend refused while queued. | Low |
| T7 | Retries resurrect a deactivated user or an expired invitation | The worker never changes user status and cancels when the user is not INVITED (TEST-WRK-08); late requests expire (TEST-WRK-07); activation re-checks expiry (TEST-INV-06). | Low |
| T8 | Identity matched by e-mail instead of subject | A subject-bound user always wins (TEST-INV-09). With `IDENTITY_EMAIL_FALLBACK=false`, only the subject matches (TEST-INV-11). Each fallback use is logged by user id. | Medium until D5 is complete |
| T9 | Secrets in logs | The worker redacts the key from every line and prints no address or link; errors carry fixed messages (TEST-PAUTH-07, TEST-PWRK-01, TEST-PCFG-06). | Low |

## 4. D5: removing the e-mail fallback

1. **Phase 1, inventory (read-only):** `npm run identity:inventory -w @dsa/tools` classifies every user: BOUND, PENDING_INVITATION, BINDABLE, or one of the cases a person resolves (BOUND_MISMATCH, NO_ACCOUNT, CROSS_TENANT, NO_CLAIM, ACCOUNT_TAKEN, AMBIGUOUS).
2. **Phase 2, binding (needs approval on hosted data):** `npm run identity:bind -w @dsa/tools` shows the BINDABLE rows; `--apply --project-ref <ref> --expect <n>` binds exactly those, each only if it has not changed since it was checked, with an audit record `user.identity_bound`.
3. **Phase 3:** once the inventory shows no row needing work, set `IDENTITY_EMAIL_FALLBACK=false` in the API. After a period with no fallback warnings in the logs, delete the fallback code from `resolve-principal.ts`.

## 5. Tests

| Area | File | IDs |
|---|---|---|
| Worker, end to end against a database | `tests/isolation/cases/provisioning-worker.spec.ts` | TEST-WRK-01 to 10 |
| API requests | `tests/isolation/cases/invitation-flow.spec.ts` | TEST-FLOW-01 to 09 |
| Activation and identity matching | `tests/isolation/cases/invitations.spec.ts` | TEST-INV-01 to 07, 09 to 11 |
| Binding tool against a database | `tests/isolation/cases/identity-binding.spec.ts` | TEST-IDB-01 to 04 |
| Binding classification | `tools/identity-binding.spec.ts` | TEST-BIND-01 to 06 |
| Key boundary | `apps/api/test/service-key-boundary.spec.ts` | TEST-KEYB-01 to 05 |
| Worker configuration and output | `apps/api/test/provisioning-config.spec.ts`, `tools/provisioning-worker.spec.ts` | TEST-PCFG-01 to 06, TEST-PWRK-01 to 02 |
| Supabase Auth port | `apps/api/test/provisioning-auth-admin.spec.ts` | TEST-PAUTH-01 to 07 |
| Accept page | `apps/web/src/auth/AcceptInvitationPage.spec.tsx` | TEST-ACCEPT-01 to 06 |

## 6. Known limits

1. The Auth port finds an account by listing accounts 200 at a time. Fine for a pilot; slow with many thousands of accounts.
2. If the worker stops after Supabase sent the e-mail but before recording it, the claim is taken over after 10 minutes and the invitee may get a second e-mail (bounded by the attempt limit).
3. Nothing here has run against the hosted project: real e-mail content, link handling and `amr` values are checked in the hosted checklist.
4. `openapi/openapi.yaml` contains defaults generated from the current date (`eventDate`, `paidOn`), so regenerating it changes it every day. This predates this work.
