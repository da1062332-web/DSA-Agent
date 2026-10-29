# Migration 0086 (test-login helpers): security review

Status: review of the repository and the hosted records in `docs/`, 2026-10-28. In that review nothing was changed. **Update 2026-10-29:** the EXECUTE revoke in section 4, step 1 was applied to hosted with owner approval, and migration 0096 then dropped the functions (see the update below). No function was dropped and no code was altered. Facts below are cited to the file or document that states them. The hosted API and its configuration were not probed.

> **Update 2026-10-29.** The hosted read-only check (`docs/HOSTED_STATUS_2026-10-29.md`) contradicted the 2026-10-28 claim that the API role had lost EXECUTE. Then, with owner approval, `tools/sql/remediation/0086-revoke-test-login-execute.sql` was run on hosted. It revoked EXECUTE on both functions from PUBLIC, `dsa_app` and `dsa_api`. The verify file then showed each ACL as `{postgres=X/postgres}`, and effective EXECUTE is false for `dsa_api`, `dsa_app`, `anon` and `authenticated`. The functions were then dropped the same day by migration 0096 (`supabase/migrations/20261001000096_drop_test_login_functions.sql`).

## 1. What migration 0086 creates

`supabase/migrations/20261001000086_test_auth_bypass.sql` creates two `SECURITY DEFINER` functions, owned by `postgres`, so they bypass row-level security. Each is granted `EXECUTE` to `dsa_app`.

- `app.lookup_test_user(p_email text)` returns the first active or inactive user whose email (case-insensitive) or id matches. It returns `idp_subject` (the Supabase Auth subject) and the tenant status. It has **no tenant filter and no check on the caller**.
- `app.list_test_users()` returns **every active user with an email, across all tenants**: id, email, display name, tenant id, role code, role name and primary branch name.

## 2. How the API uses them

- `GET /public/v1/auth/test-users` (`apps/api/src/http/public-auth-router.ts`, line 26) calls `app.list_test_users()` (lines 45 and 56). It takes **no password, code or session**.
- `POST /public/v1/auth/test-login` (line 68) compares `otp` with `TEST_BYPASS_OTP` (line 77). The default is `000000` (`apps/api/src/config.ts`, line 70). On a match it calls `app.lookup_test_user` (lines 101 and 112) and signs in that user, with no password and no authenticator factor.
- Both routes are mounted only when `createApp` receives a `testAuth` value (`apps/api/src/app.ts`, lines 131–132). `resolveTestAuth` returns one only when `TEST_AUTH_ENABLED=true` and every check in `apps/api/src/test-auth.ts` passes: not `NODE_ENV=production`; a local Supabase URL; a local database or a host the developer approved; never the shared project ref `mlpkwwhnagxzinaohdxg`; and a bypass secret of at least 32 characters that is not a published value and not the JWT secret.
- The web login page falls back to test login only when the build has `VITE_TEST_AUTH=true`. `testAuthEnabled()` is false in any `PROD` build (`apps/web/src/auth/test-auth.ts`, line 15), so the fallback is not compiled into a production bundle.

## 3. The risk

Audit AUD-001 (`docs/AUDIT_REPORT_2026-10-26.md`, rated **Critical, verified**) describes the chain when the routes are live: `GET test-users` lists the people, then `POST test-login` with `000000` signs in as any listed user, including a user the audit could not rule out in the platform realm. The password and the authenticator factor are never checked.

Two further facts raise the stakes:

- **The bypass secret is published.** `dsa-crm-test-bypass-jwt-secret-key-2026` appears in the repository (the `PUBLISHED_SECRETS` list in `test-auth.ts`, the e2e helper that signs mock tokens, and several specs and docs). The repository is public (remediation plan, R6). The audit records the forgery path as AUD-002 (Critical, reproduced on the 2026-10-26 code): the verifier accepted HS256 tokens signed with that literal, which was its default. The current code closes that path. The verifier honours the bypass secret only against a local Supabase URL (`packages/kernel/src/auth/verify-token.ts`, lines 78–80), and `BYPASS_JWT_SECRET` has no default (`apps/api/src/config.ts`, line 87). A deployed build older than that change is not verified by this review.
- **The repository's gate is not the database's gate.** The functions exist in the database, so the API gate is the only protection on the API path. The containment plan (`docs/HOSTED_TEST_AUTH_CONTAINMENT_PLAN.md`) records that a previous build may have run on hosted, and that it logged emails and one-time codes for each test-login attempt.

### Current exposure on the shared hosted project

| Item | Status | Source |
|---|---|---|
| Both functions exist on hosted | Yes, found by the 2026-10-26 read-only audit | containment plan, section 1 |
| `dsa_app` could execute them | Yes before 2026-10-29. **Revoked on 2026-10-29** (approved; verified) | containment plan, section 1; `docs/HOSTED_STATUS_2026-10-29.md` |
| `dsa_api` could execute them | Yes before 2026-10-29: an explicit grant that no repository migration makes. **Revoked on 2026-10-29** | `docs/HOSTED_STATUS_2026-10-29.md` |
| PUBLIC could execute them | Yes before 2026-10-29 (`=X` in the hosted ACL; migration 0086 revokes PUBLIC, so the hosted ACL did not match the file). **Revoked on 2026-10-29** | `docs/HOSTED_STATUS_2026-10-29.md` |
| EXECUTE removed from the API role | **Done 2026-10-29** by the approved revoke, verified (ACL `{postgres=X/postgres}`). Before it, 0091's revoke had run, but a later manual grant by `postgres` re-added the role (`docs/HOSTED_STATUS_2026-10-29.md`, "Investigation"). The earlier "verified read-only" entry was wrong | containment plan, section 1; remediation plan, P0-2; `docs/HOSTED_STATUS_2026-10-29.md` |
| Functions dropped 2026-10-29 by migration 0096 | Until 2026-10-29 they existed and the owner role could call them | this review; `docs/HOSTED_STATUS_2026-10-29.md` |
| The API role has called the functions on hosted | Yes, in the retained statement history: `dsa_api` ran `lookup_test_user` 154 times and `list_test_users` 13 times. The caller and the results are not recorded | `docs/HOSTED_STATUS_2026-10-29.md`, "Investigation" |
| A hosted API that could serve the routes | None recorded: "No hosted API exists" (updated 2026-10-27) | containment plan, section 9 |
| Hosted `NODE_ENV`, `TEST_AUTH_ENABLED` and any previous build's logs | Unknown; no probe has been run | containment plan, sections 8–9 |

**Severity:** Critical as a design exposure (AUD-001, AUD-002). Partly mitigated since 2026-10-29: PUBLIC, `dsa_app` and `dsa_api` no longer hold EXECUTE, and the Data API does not expose schema `app` (probe, 2026-10-29). Still open: the route code and its default OTP are in source (the gate refuses the shared project), and the bypass secret is public. No hosted API is recorded as serving the test routes, but that is not verified.

## 4. Recommended remediation (none done here; each step needs owner approval)

1. **Done 2026-10-29 (approved and verified).** EXECUTE was revoked from PUBLIC, `dsa_app` and `dsa_api` on both functions, using `tools/sql/remediation/0086-revoke-test-login-execute.sql`. Verify with `...verify.sql` (read-only) and repeat it on a schedule. The rollback file (`...rollback.sql`) restores the pre-revoke grants. Do not run it without the same approval. Migration 0091 does not revoke from PUBLIC, which is why the revoke was needed.
2. **Confirm no deployed API runs test login.** Any hosted API must answer `GET /public/v1/auth/test-users` and `POST /public/v1/auth/test-login` with 404 (the containment plan's smoke tests, section 4).
3. **Done 2026-10-29 (approved):** the two functions were dropped by migration 0096, after the revoke. Originally: drop them in a new migration, after the API no longer calls them. That means removing the test routes from any build that can reach hosted, or moving the local test lookup out of the database. Local tests must be updated first. The drop is irreversible without re-creating the functions from 0086 (containment plan, option 2). It needs an assigned migration number and owner approval.
4. **Remove the default code and the published secret from every environment.** `TEST_BYPASS_OTP` should have no default outside a local stack, and the bypass secret must be rotated wherever it was ever set. This changes configuration, so it needs owner approval.
5. **Answer the platform-realm question with a read-only query** (only with approval): whether `app.app_user` holds a platform-realm user that `lookup_test_user` would return. The audit says this was not confirmed.
6. **Review hosted logs from any previous build** for emails and one-time codes, and decide retention and deletion (containment plan, section 8). This is an owner decision.
7. **Record an owner for 0086.** `supabase/MANIFEST.md` and `docs/MIGRATION_MATRIX.md` now carry "Owner to confirm (not recorded)". The containment plan asks for this before the next migration is merged.
8. **Remove the unauthenticated `GET /public/v1/auth/test-users` route** from any build that can reach hosted, even before the functions are dropped. It needs no credential at all.

## 5. What this review did not verify

- The hosted API's deployed build, its environment variables and its logs (no hosted probe was run).
- Whether any platform-realm user exists in `app.app_user` (not queried).
- Whether the published secret was ever accepted by a deployed API (not verified).
- Who granted EXECUTE to PUBLIC and to `dsa_api` on hosted, and when. No repository migration makes either grant, and the migration ledger is absent.
