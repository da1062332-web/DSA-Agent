# Hosted test login: containment, deployment and migration plan

Status: **draft, nothing applied.** Written 2026-10-26 from the working tree that holds the uncommitted test-auth and error-handling changes. Hosted was not contacted to write this plan.

Update 2026-10-27: the frontend and backend run only on localhost, and neither is deployed. Sections 2, 3 (options A and B) and the hosted smoke tests have no target, so do not run them. Option C is the first deployment of this build. The user replied "approved all". That does not name a hosted action, so nothing hosted has changed. Section 9 lists what is still needed.

## 1. Where things stand

| Item | Status |
|---|---|
| Hosted API URL and host | **Not found.** Not in the repo, the CI workflow (no deploy job), GitHub deployments or environments (none), repo secrets or variables (none), or the hosted docs. The Netlify CLI on this machine has an expired session and no linked site. Needed from you. |
| Hosted API environment | **Not inspected.** Needs the platform and read access. Names and yes/no only, never values. |
| Exposure of the previous build (from the code) | `test-login` and `test-users` were mounted unconditionally. The default OTP was `000000`. The verifier accepted HS256 tokens signed with the published constant `dsa-crm-test-bypass-jwt-secret-key-2026` whenever `BYPASS_JWT_SECRET` was unset. `test-login` logged every attempt's email and OTP. `NODE_ENV` defaults to `development`. |
| Current build (uncommitted) | Test routes exist only with `TEST_AUTH_ENABLED=true` and the checks in `apps/api/src/test-auth.ts`. The constant is never accepted. Error responses carry no driver text. Logs are redacted. |
| Hosted database functions | `app.lookup_test_user(text)` and `app.list_test_users()` (migration 0086) still exist. `dsa_app` has EXECUTE, and `dsa_api` inherits it (from the earlier read-only audit). `list_test_users()` is `SECURITY DEFINER` and returns active users across all tenants. |
| Point-in-time recovery | **Not enabled** (`docs/HOSTED_FINDINGS_20261017.md`). Recovery for hosted changes depends on the state backup kept outside the repository (`docs/HOSTED_APPLY_CHECKLIST.md`). |

## 2. Reachability, to be probed after approval

Two probes that send no credentials and no real email, OTP or token:

- `POST {API}/public/v1/auth/test-login` with the body `{}`. The handler rejects the body before any database access. Previous build: `422 VALIDATION_ERROR`. Current build with the flags off: `404`. The answer also shows which build is live, since only the previous build mounts this route unconditionally.
- `GET {API}/public/v1/auth/test-users`. **Not planned without your approval.** The handler runs its query over every active user's email before it answers, so even a status-only probe makes the server read that list. The route sits in the same router as `test-login`, so a `422` from `test-login` also means `test-users` is mounted.

No forged token is sent to hosted. The rejection of the published-secret token is covered by the unit tests instead.

## 3. Containment options (none applied)

| Option | What changes | Effect on the previous build | Residual risk | Approval |
|---|---|---|---|---|
| **A.** Env change on the hosted API, then restart | Set `BYPASS_JWT_SECRET` to a random value of at least 32 characters, and `TEST_BYPASS_OTP` to a random value. Keep both only in the platform's secret store. | The published constant is rejected, because the verifier then uses only the configured secret. `test-login` with `000000` returns 401. The web fallback fails. | `test-users` stays reachable while the previous build runs. Earlier attempts remain in the logs. | Yes, the exact values and the restart. |
| **B.** Edge rule blocking `/public/v1/auth/test-*` | A path rule on the platform or proxy, if one exists. | Both test routes return a blocked response. | Does not stop forgery on other endpoints. Use with A, not instead of it. | Yes. |
| **C.** Deploy the current API build with the flags off | Section 4. | Test routes return 404, and the constant is never accepted. | Needs a commit and a deploy. | Yes. |

Recommended order: **A now**, if the platform allows an env change with a restart, then **C**. Add **B** only if `test-users` must close before C.

## 4. API deployment plan

Preconditions

1. Commit only this change set, on a branch. The working tree also holds unrelated work (dashboards, lender cases, UI primitives) that must not ship with it.
2. CI green on that commit: lint, typecheck, unit, integration, migrations and isolation.
3. The deploy directory contains no `.env`. The start script loads one if present (`node --env-file-if-exists=.env dist/server.js`). A `TEST_AUTH_ENABLED=true` there would be refused at startup against the hosted URL, but the directory should not carry it at all.

Environment, names only

- Must be set: `NODE_ENV=production` (the config default is `development`, which turns on the development paths in the error handler and the logger), `SUPABASE_URL`, `DATABASE_URL` (as today), `APP_SIGNING_SECRET` (required in production), `CORS_ALLOWED_ORIGINS`.
- Must not be set: `TEST_AUTH_ENABLED`, `TEST_DATABASE_HOSTS`, `DISABLE_MFA`, `TEST_TOKENS`, `ENABLE_MOCK_PROVIDERS`.
- Remove if present: `BYPASS_JWT_SECRET` and `TEST_BYPASS_OTP`. The new build does not read them.

Steps, after approval

1. Build the artifact with `npm run build -w @dsa/api` from the reviewed commit.
2. Deploy and restart. The restart stops the background worker (outbox relay and jobs) and fails in-flight requests.
3. Smoke tests, non-authenticating: `GET /health` returns 200. `POST /public/v1/auth/test-login` with `{}` returns 404. `GET /v1/me` with no token returns 401.
4. A real staff sign-in through the web app, performed by you, reaches the app. This confirms the verifier still accepts the Supabase-issued ES256 tokens.
5. Watch the logs for 30 minutes. Expect no `[test-login]` lines and no `TEST_AUTH_ENABLED` warning.

Rollback: redeploy the previous artifact. Do not restore the previous build without Option A in place, because it reopens the exposure.

Access risk: tokens issued by the previous test login stop working, which is intended. Sessions from Supabase Auth are unaffected.

## 5. Web deployment plan

Build

- Build in a clean checkout, or with no `.env.local` present. Vite inlines the `VITE_*` values from the env files it loads, so the build environment matters. It must not carry `VITE_TEST_AUTH`, `VITE_TEST_BYPASS_OTP` or `VITE_DISABLE_MFA`.
- Checked locally on the current code: the production build contains no test endpoint path, no test factor, no test secret and no test error text. Two identifiers remain, `dsa_bypass_active` and `bypass-refresh-token`. They clear sessions that the previous build may have left in a browser, and production never activates them.

Order: deploy the API first, then the web build. The current web build does not call `test-login`.

Smoke tests: the sign-in page loads. A real staff member signs in with a password and an authenticator code (you perform this). The account page works. The browser network log shows no request to `/public/v1/auth/test-login`.

Access risk: a browser that holds a test session from the previous build has it cleared on the first load of the new build, and must sign in again.

Rollback: redeploy the previous static build. The previous build is the exposure, so do this only with Option A in place.

## 6. Migration plan: revoke the test database functions

Facts

- Created by `supabase/migrations/20261001000086_test_auth_bypass.sql`. Both functions are `SECURITY DEFINER`, so they bypass row-level security. `list_test_users()` returns every active user with an email, across all tenants.
- The only caller is `apps/api/src/http/public-auth-router.ts`, the test-login route family. No other code or tool calls them. The one test that names them mocks the database.
- Migration 0086 is **not listed in `supabase/MANIFEST.md`**, so its owner is not recorded. Close that gap before the next migration is merged.
- A merged migration is never edited (`supabase/MANIFEST.md`, rule 1). A correction is a new file in the owner's number range, recorded with the migration check tool. A new number needs a manifest PR (rule 3).

Options

1. **Recommended.** A new migration revokes EXECUTE from `dsa_app`. `dsa_api` inherits it, so the API role loses both functions. Local impact: `supabase db reset` applies the revoke to the local database too, so local test login fails until a local-only grant is restored. That grant belongs in a script that refuses any non-local database, documented in `e2e/LIVE-SETUP.md`.
2. **Later**, after option 1 and the new API build are verified on hosted: drop the functions in another migration. That is irreversible without re-creating them from 0086.
3. **Do nothing at the database level.** The API gate still holds, but the cross-tenant function stays callable by `dsa_api` from any future code path.

Option 1 is now in `supabase/migrations/20261001000091_security_hardening.sql` (manifest M-091, lock recorded, isolation suite passes with it applied to a fresh database). It was applied to hosted by the owner on 2026-10-27 and verified read-only: the two test-login lookups are no longer callable by the API role. The draft SQL below is the same revoke, kept for reference.

```sql
-- DRAFT, not applied. Needs a new number and a manifest entry before it is added to supabase/migrations.
SET search_path = app, extensions, public;
REVOKE EXECUTE ON FUNCTION app.lookup_test_user(text) FROM dsa_app;
REVOKE EXECUTE ON FUNCTION app.list_test_users() FROM dsa_app;
```

Verification, read-only, run by an owner or admin role after the apply. Both values should be `false`.

```sql
SELECT has_function_privilege('dsa_api', 'app.lookup_test_user(text)', 'EXECUTE') AS lookup_for_api,
       has_function_privilege('dsa_api', 'app.list_test_users()', 'EXECUTE')     AS list_for_api;
```

Rollback:

```sql
GRANT EXECUTE ON FUNCTION app.lookup_test_user(text) TO dsa_app;
GRANT EXECUTE ON FUNCTION app.list_test_users() TO dsa_app;
```

Order: after the API deploy in section 4, so no live route depends on the functions when the revoke lands.

Backup: point-in-time recovery is off, so take the state backup that `docs/HOSTED_APPLY_CHECKLIST.md` requires before any hosted change, kept outside the repository.

Access risk: none for users. The only effect is on the test-login routes.

## 7. Keeping test authentication off in shared and production

- API: the config refuses `TEST_AUTH_ENABLED=true` against a non-local `SUPABASE_URL`, a hosted `DATABASE_URL`, or `NODE_ENV=production`. The verifier honours the test secret only for a local URL. `mintBypassToken` refuses non-local URLs. The `.env` loading in the start script cannot switch test login on against the hosted URL. The API bundle still contains the test routes' code. They are inert unless the config allows them.
- Web: a production build compiles the test branches out (`import.meta.env.PROD`), and the flag is also checked at run time.
- Operations: alert on the startup warning `TEST_AUTH_ENABLED is on` in every environment that should never have it.

## 8. Remaining risks and the approval each needs

| Risk | Current state | Mitigation | Approval |
|---|---|---|---|
| The hosted API may run the previous build | Unknown. Needs the URL and the platform. | Probe per section 2. Then Option A, then C. | Yes: the probes and A. |
| `test-users` lists active users' emails if the previous build is live | Unknown. | A does not close it. C or B does. | Yes: C, or B now. |
| Hosted `NODE_ENV` may be unset, which defaults to `development` | Unknown. | Set `NODE_ENV=production` with C, and with A if you accept it there. | Yes. |
| The previous build logged emails and OTPs for every test-login attempt | Possibly in hosted logs. | Review them, then apply your retention and deletion policy. | Yes: log access, and any deletion. |
| The previous error handler could echo driver text, including connection strings | Fixed in the current build. Possibly still in kept logs. | If the hosted API ran in development mode, rotate the database password as already planned in `docs/CREDENTIAL_REMEDIATION.md`. | Yes: the rotation. |
| Cross-tenant `SECURITY DEFINER` functions exist on hosted | Yes. | Migration option 1, then option 2 later. | Yes: the migration. |
| Point-in-time recovery is off | Off. | Enable it. It is a paid Supabase add-on, so it is your decision. | Yes: a Supabase settings change. |
| An open question in `docs/HOSTED_FINDINGS_20261017.md` about six permission changes on the hosted database with no audit event | Open. Not part of this plan. | Your investigation. | Not requested here. |
| Migration 0086 has no owner in the manifest | A process gap. | Record an owner before the revoke migration is merged. | Yes: an owner decision. |

## 9. Status of approvals (updated 2026-10-27)

- No hosted API exists, so there is no URL or platform to probe. The probes in section 2, the environment checks, and containment options A and B do not apply.
- The user replied "approved all". The plan's approval column asks for the exact action each time, so no hosted change has been made.
- Before the migration in section 6 can run, these are needed:
  1. An owner decision for migration 0086, which `supabase/MANIFEST.md` does not list.
  2. A new migration number, recorded in the manifest.
  3. A privilege route. `app.lookup_test_user` and `app.list_test_users` are owned by `postgres`, and `dsa_api` is neither the owner nor a member of that role, so it cannot revoke them. The revoke must run as the owner, through the Supabase CLI's linked project or the dashboard. Do not use the superuser URL in the local `.env` for it.
- Option C (deploy the current build with the flags off) and the smoke tests in section 4 apply at the first deployment of this build.
