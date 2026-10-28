# Hosted Supabase: review and remediation plan

Status: **draft, not approved, nothing changed.** Written 2026-10-26 from read-only checks of the shared project `mlpkwwhnagxzinaohdxg` (ap-south-1), the local configuration, and the git history. No secret value appears in this document or in the checks that produced it. Re-checked read-only on 2026-10-27: the `public.label_set` grants, the one `public` view without `security_invoker`, the `dsa_api` execute grants on `app.authenticate_user` and the two test-login functions, the open network allowlist and the disabled database SSL enforcement are all unchanged.

Every step below needs your explicit approval before it is taken. Credential rotation, migrations, Supabase settings, repository visibility, history rewrites and deletion of local files are all on that list.

## 1. Bottom line

- The shared database is **reachable from any IP address**, **accepts unencrypted connections**, and its **main password is in the public git history**. The repository is **public**. Assume the password and the service-role key are known to anyone who has read the history.
- One database view, `public.label_set`, lets **anonymous and signed-in users read and change every tenant's rows** through the Supabase Data API. It bypasses row-level security. This is a tenant-isolation failure that needs no credentials beyond the public publishable key.
- Nothing is deployed, so the exposure is to the internet and to developers, not to users of a live product. That lowers the urgency of the app-side work. It does not lower the urgency of the database work.
- Test authentication is off for this configuration. The config loader refuses it against the shared database even with the test OTP set. A regression test now covers that case.

## 2. Current configuration (verified)

Local backend, from `apps/api/.env`, with values never printed:

| Setting | State |
|---|---|
| `DATABASE_URL` | Supabase pooler, port 6543, database `postgres`, login `dsa_api` for this project. `dsa_api` is a member of `dsa_app` and has NOBYPASSRLS. **The API does not connect as `postgres`.** |
| TLS on that connection | **Not used.** The client socket is unencrypted (`client_socket_encrypted=false`). The pooler accepts TLS when asked (`client_socket_encrypted=true` with TLS requested), so the fix is a configuration change. |
| `DIRECT_DATABASE_URL` | Direct host, login `postgres` (BYPASSRLS). Read by `tests/guard/local-db.global-setup.ts` and `tools/test_lifecycle.ts`, not by the API at runtime. |
| `VERIFY_DATABASE_URL` | Pooler, login `postgres`. Read by scratch scripts in `apps/api/scratch/`, several of which write to the database. |
| Password across the three URLs | **One value.** The same password is in all three. |
| `SUPABASE_JWT_SECRET` | Empty. The local backend has no legacy HS256 secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | Present. A service-role JWT for this project, valid until 2036. Read by `tools/provision-platform-admin.ts`, `tools/provision-tenant.ts` and `apps/api/test/e2e_all_modules.ts`, not by the API runtime. |
| `APP_SIGNING_SECRET` | Absent. Document links and webhook subscriptions are degraded in development, and the API logs a warning at startup. |
| `TEST_AUTH_ENABLED` | Absent, so test login is **off**. `TEST_BYPASS_OTP` is present but inert. |
| `DISABLE_MFA`, `TEST_TOKENS` | Absent and `false`. |
| `NODE_ENV` | `development` (also the config default). |
| Config loader on the local env | Accepts it as it is. With `TEST_AUTH_ENABLED=true` it refuses, naming SUPABASE_URL, DATABASE_URL and BYPASS_JWT_SECRET. With `DISABLE_MFA=true` it refuses. |
| Web `apps/web/.env.local` | Public values only. `VITE_TEST_AUTH` is absent, so the test sign-in is off. |

Hosted project, from read-only checks as `dsa_api` and the Supabase CLI:

| Area | State | Evidence |
|---|---|---|
| Network access to the database | **Open to every IP.** `dbAllowedCidrs` is `0.0.0.0/0`, and `::/0` for IPv6. | `supabase network-restrictions get --experimental` |
| SSL enforcement for the database | **Off.** | `supabase ssl-enforcement get --experimental` |
| Point-in-time recovery | **Off.** WAL-G is enabled, but the CLI lists no backups. Retention is unconfirmed. | `supabase backups list` |
| Roles | `anon`, `authenticated`: NOLOGIN. `postgres`: LOGIN, BYPASSRLS. `service_role`: BYPASSRLS. `dsa_api`: LOGIN, NOBYPASSRLS. | `pg_roles` |
| `app` schema (142 tables) | `anon` and `authenticated` have **no** privileges on any table. | `has_table_privilege` |
| `public` schema | **142 views and no base tables.** 141 use `security_invoker`. **`public.label_set` does not.** It is owned by `postgres`, and `anon` and `authenticated` hold SELECT, INSERT, UPDATE and DELETE on it. The view is auto-updatable. | Catalog checks |
| Broad grants on `public` | Migration 0087 grants ALL on every table and view in `public` to `anon` and `authenticated`, and sets default privileges so new objects get the same grant. | `supabase/migrations/20261001000087_expose_app_in_public.sql` |
| Tables without RLS | Three tables in `app` have no RLS: `decision_definition`, `decision_dependency` and `permission`. They look like reference data. | `pg_class` |
| `app.authenticate_user(text)` | SECURITY DEFINER. Returns `password_hash`. Contains a hardcoded alias: the identifier `admin@alpha.com` matches the user whose email is `admin@dsa.com`. `dsa_api` can execute it. No code in the repository calls it. | Function definition |
| `app.app_user.password_hash` | The column exists on hosted, but no migration creates it. Its population could not be checked: RLS hides rows from the application role, and the per-tenant count returned zero. | `supabase/` migrations; `provision-platform-admin.int.spec.ts` asserts it stays empty |
| `app.lookup_test_user`, `app.list_test_users` | Still exist, and `dsa_api` can execute them (earlier read-only audit). `list_test_users` returns active users across all tenants. | `supabase/migrations/20261001000086_test_auth_bypass.sql` |
| Storage buckets | Not readable by `dsa_api`. Public or private status **unverified**. | Permission denied on `storage.buckets` |
| Auth schema | Not readable by `dsa_api` (permission denied). | Catalog probe |
| Migration ledger | Not visible to `dsa_api` (undefined table). Applied migrations **unverified** from the application role. | Catalog probe |
| Sign-ups | Last recorded as open (`disable_signup: false`, 2026-10-17). **Not re-verified in this pass.** | `docs/HOSTED_FINDINGS_20261017.md` |

Repository and history:

| Area | State | Evidence |
|---|---|---|
| Repository visibility | **Public.** Remote `origin` is GitHub, `da1062332-web/DSA-Agent`. | `gh repo view` |
| Local env files | Git-ignored, and never committed. | `git check-ignore`; `git log --all -- <env files>` |
| The database password | Present in **22 commits**. The first one is reachable from the remote branch `origin/samarth`. The password is **unchanged** (it still matches the current value). | History scan, booleans and hashes only |
| The service-role key | Present in **4 commits**. Unchanged. | History scan |
| Other token shapes (GitHub, Supabase personal access, AWS, private keys, Slack) | None found in history or in tracked files. | History scan |
| Write-capable scripts that use the superuser URL | Tracked in `apps/api/scratch/` and `tools/apply_fixes_to_hosted_db.ts`, and in the history. | `git grep` |
| Local copies of old credentials | `apps/api/.env.bak` and `~/.dsa-env-backup/` **exist** on this machine. | Existence check only |

Earlier record, same project: test runs wrote rows to the shared database on 2026-10-17 (04:07–04:09 and 04:47–04:48 UTC), using a connection string from a spec or from `.env`. The guards in `tests/guard/` now refuse non-local databases. The inventory dated 2026-10-16 (`docs/HOSTED_TEST_RESIDUE.md`) found test residue and deleted nothing. This pass did not re-count it.

## 3. Incident to record

During this review, a helper script printed the database password once in its error output, in URL-encoded form. The value is now in this session's transcript. It was already public through the history, so the new exposure is to the transcript and any logs that keep it. The rotation in step P0-1 covers it. The helper scripts have been fixed so that errors never print arguments.

## 4. Risks, ranked

| # | Risk | Severity | Why it matters |
|---|---|---|---|
| R1 | `public.label_set` readable and writable by anonymous users, across tenants | **Critical** | Tenant isolation fails with only the publishable key. Verified from the catalog; not yet confirmed with a live request. |
| R2 | Database password in public history, still current | **Critical** | Anyone can log in to the database as `postgres` or `dsa_api`, from any IP, without TLS. |
| R3 | Service-role key in public history, still current, valid to 2036 | **Critical** | Bypasses row-level security on every Supabase API, and can administer auth users. |
| R4 | Database open to `0.0.0.0/0` | **High** | Multiplies R2 and R3. |
| R5 | Database connections unencrypted, SSL not enforced | **High** | Passwords and data cross the network in plaintext. |
| R6 | Repository public | **High** | Makes R2 and R3 permanent until history is removed. |
| R7 | `app.authenticate_user` returns password hashes, has a hardcoded admin alias, and `dsa_api` can run it | **High** (dormant) | Any future code path or compromised API process could dump hashes across tenants. |
| R8 | Broad grants on `public`, and default privileges for new objects | **Medium** now, **high** if `app` USAGE is ever granted to `anon` | 141 `security_invoker` views are safe only because `app` table privileges are missing. |
| R9 | Superuser URL in local `.env`, and write-capable scripts in the tree | **Medium** | Makes superuser access easy to reach from a laptop or a script. |
| R10 | Point-in-time recovery off, backup retention unconfirmed | **High** for recovery | A bad write or a destructive script has no fine-grained recovery path. |
| R11 | Sign-ups possibly open | **Medium**, unverified | Anyone can create an identity in the shared project. Tenant access still needs a tenant claim, but the invitation flow binds by email, so the setting needs review before the invitation rollout. |
| R12 | Storage buckets unknown | **Unknown** | If a bucket holding documents is public, its files are reachable by URL. |
| R13 | Test residue in the shared database | **Medium** | Test tenants and rows sit beside real data. |
| R14 | Three tables in `app` without RLS | **Low** | Likely reference data. Needs confirmation. |
| R15 | Schema drift: `label_set` view, `password_hash` column and the 142 views are not all in migrations | **Medium** | The hosted schema differs from the reviewed migrations. |
| R16 | Local copies of old credentials | **Medium** | Keeps the old values on disk. |
| R17 | `APP_SIGNING_SECRET` absent | **Low** | Document links and webhook subscriptions are degraded, not exposed. |

## 5. Remediation steps

Order matters. The steps are grouped so that each group closes a larger exposure than the one after it.

### P0: contain the critical exposures (approval required for each)

**P0-1. Rotate the database passwords (R2).** Give `postgres` and `dsa_api` separate passwords, not one shared value.
- Who is affected: every developer's `.env`, and the tools that use the superuser URL. Nothing is deployed, and the GitHub repository has no database secrets or deployments, so the blast radius is developers.
- Steps: announce a short freeze of hosted writes; rotate both passwords in the Supabase dashboard; update the local `.env` files; check that each developer's connection works with `select 1`; check that the old password fails.
- Reversible: no. The old value is compromised.

**P0-2. Close the `label_set` exposure (R1).** Apply a hosted hotfix, then put the same change in a new migration.
- Hotfix (one statement): `REVOKE ALL ON public.label_set FROM anon, authenticated;`
- Migration: revoke the same privileges, and then decide whether the view is needed at all. Migration 0087 exists so that Studio and the Data API can see business tables. The application reaches the database only through the Express API, so the simplest fix is to drop the `public` views, or to recreate each one with `security_invoker` and revoke all DML from `anon` and `authenticated`.
- Verification: the catalog check in section 6 must return false for `anon` and `authenticated`. After approval, a live check with the publishable key and `limit=0` confirms the result without returning any row. A permission error means the fix works; an empty array with status 200 means the role still has access.
- Reversible: yes, by granting the privileges back.

**P0-3. Rotate the Supabase API keys (R3).** The service-role key is a legacy JWT, signed with the project's JWT secret.
- Option A: rotate the JWT secret. This invalidates every session and every key. Every user signs in again.
- Option B: move to the new API keys (publishable and secret) and disable the legacy keys. This needs the tools and the web build updated.
- Either way, update `SUPABASE_SERVICE_ROLE_KEY` in every `.env` that holds it, and update the publishable key in the web build. Check that the provisioning tools still work.
- Reversible: no.

**P0-4. Restrict network access to the database (R4).** Replace `0.0.0.0/0` and `::/0` with the egress addresses of developer machines and any runners that need the database. Confirm which addresses are actually used before applying. Developers on changing networks will be blocked until their address is added.
- Reversible: yes.

**P0-5. Make the repository private (R6).** This stops new exposure. It does not remove the old history from forks, clones or caches, so P0-1 and P0-3 still come first.
- Reversible: yes.

### P1: encrypt connections and remove the dormant exposures (approval required)

**P1-1. Encrypt client connections (R5).** Set `sslmode=verify-full` in `DATABASE_URL`, with Supabase's CA certificate, or at minimum `sslmode=require`. The pooler accepts TLS, as verified. Confirm `client_socket_encrypted=true` with the same check used in section 6. Then enable SSL enforcement on the project (a Supabase settings change, which needs approval). Only enforce after every client connects with TLS.

**P1-2. Remove `app.authenticate_user` (R7).** Drop the function in a migration. Confirm that nothing calls it (the repository check found no callers). Before dropping the `password_hash` column (R15), confirm its population with a superuser check, which needs its own approval.

**P1-3. Remove broad grants from `public` (R8).** Revoke INSERT, UPDATE and DELETE from `anon` and `authenticated` on every `public` view, and change the default privileges so new objects do not get them. Keep SELECT only where it is needed.

**P1-4. Remove superuser access from everyday use (R9).** Keep `VERIFY_DATABASE_URL` and `DIRECT_DATABASE_URL` out of `.env`, and store them in a password manager. Remove the write-capable scripts from `apps/api/scratch/` and from `tools/apply_fixes_to_hosted_db.ts`, after checking that nothing still needs them. Removing a file does not remove it from history, so this depends on P0-1.

**P1-5. Delete local copies of old credentials (R16).** Delete `apps/api/.env.bak` and `~/.dsa-env-backup/` after P0-1 and P0-3. Show you the file list first.

### P2: backups, sign-ups, storage and cleanup (approval required)

**P2-1. Backups (R10).** Decide whether to enable point-in-time recovery. It is a paid Supabase add-on, so this is your decision. Confirm the retention of the daily physical backups in the dashboard, and rehearse a restore to a scratch project before the next destructive change.

**P2-2. Sign-ups (R11).** Check the current setting in the dashboard. If self sign-up is not needed, turn it off. Confirm that admin-created invitations still work. Review the invitation binding by email before the invitation rollout.

**P2-3. Storage (R12).** Check in the dashboard whether any bucket that holds documents is public. If one is, make it private and move access to signed URLs.

**P2-4. Test residue (R13).** Use `docs/HOSTED_TEST_RESIDUE.md` to delete test tenants' rows. Take a backup first. Keep the test guards in place, and confirm that no test writes to the hosted database.

**P2-5. RLS on reference tables (R14).** Confirm that `decision_definition`, `decision_dependency` and `permission` hold no tenant data. Then add RLS, or document them as global reference tables.

**P2-6. Schema drift (R15).** Compare the hosted schema with the migrations: the `label_set` view, the `password_hash` column, the 142 views, and the migration ledger, which `dsa_api` cannot read. The result should be a list of differences, each with an owner.

## 6. Verification after each step

These checks are read-only, and they run as `dsa_api` unless stated otherwise.

- Catalog privileges: `has_table_privilege('anon', 'public.label_set', 'UPDATE')` and the other DML privileges must be false. The same check applies to every `public` view.
- Socket encryption: a connection from the local machine must report an encrypted socket once P1-1 is done.
- Network restrictions and SSL enforcement: `supabase network-restrictions get --experimental` and `supabase ssl-enforcement get --experimental`.
- Backups: `supabase backups list --project-ref mlpkwwhnagxzinaohdxg`.
- Rotated credentials: the old password fails, and the new one returns `select current_user`.
- Live exposure check: after approval, a `limit=0` request with the publishable key to the Data API. This checks privilege without returning any row.
- Tests after code changes: the full API unit suite, the tenant-isolation suite, the kernel and web suites, and both typechecks.

## 7. Sequencing and rollback

1. Approve P0-1 and P0-2 first. P0-2's hotfix can be applied the same day, before any rotation.
2. Approve P0-5 (repository private) with P0-1. Then P0-3 and P0-4.
3. P1 steps can follow in any order, except that P1-1's enforcement waits until every client uses TLS.
4. P2 steps depend on your decisions about PITR and sign-ups.

Rollback: rotated secrets cannot be rolled back, because the old values are compromised. For grants, revoke and re-grant as shown in the steps. For network restrictions, remove the allowlist. For SSL enforcement, turn it off.

## 8. What not to do

- Do not rewrite the shared history to hide the old values until the rotation is done. A rewrite does not undo exposure, and it breaks every clone.
- Do not run the scratch scripts or the superuser URL against the hosted database.
- Do not test forged tokens against the hosted API.
- Do not use the publishable key to read rows. The `limit=0` probe is the only permitted check.

## 9. Approvals needed

| Step | Approval | Reversible |
|---|---|---|
| P0-1 Rotate database passwords | Yes | No |
| P0-2 Revoke `label_set` privileges (hotfix, then migration) | Yes | Yes |
| P0-3 Rotate or replace Supabase API keys | Yes | No |
| P0-4 Restrict network access | Yes | Yes |
| P0-5 Make the repository private | Yes | Yes |
| P1-1 Encrypt connections and enforce SSL | Yes | Yes |
| P1-2 Drop `app.authenticate_user` and the `password_hash` column | Yes, plus a superuser check | No |
| P1-3 Remove broad grants from `public` | Yes | Yes |
| P1-4 Remove superuser access from everyday use, and delete scripts | Yes | Yes (files), no (history) |
| P1-5 Delete local credential copies | Yes | No |
| P2-1 Enable PITR | Yes, and the cost decision | Yes |
| P2-2 Turn off self sign-up | Yes | Yes |
| P2-3 Make public buckets private | Yes, after checking | Yes |
| P2-4 Delete test residue | Yes, after a backup | No |
| Any superuser query or live Data API probe | Yes, each time | Not applicable |

## 10. Execution log (2026-10-27)

Approval received: the owner replied "approved all" and asked for everything to be completed. The auto-mode permission check then denied the hosted apply of migration 0091, because it modifies a shared resource. That denial was not retried or routed around. Hosted writes below are therefore still not done.

**Done**
- Migration `supabase/migrations/20261001000091_security_hardening.sql` written. It covers P0-2 (`public.label_set` runs as the caller, and anon and authenticated lose writes to every public view), P1-3 (no functions for anon or authenticated), the test-login containment (API role loses the two cross-tenant lookups), and P1-2 (drops `app.authenticate_user`). The `password_hash` column is not dropped (see below).
- Dry run on hosted, inside a transaction that was rolled back: no error. No lasting change.
- Manifest row M-091 added (owner marked "Dev 1, to confirm"). Lock recorded. `check:migrations` passes.
- Tenant isolation: 482 of 482 pass with 0091 applied to a fresh database.
- Rollback snapshot of the access settings saved outside the repo (view options and ACL, the three test-login and authenticate_user function ACLs, the view definition, the default privileges).

**Not done, and why**
- **P0-2 apply to hosted.** Done by the owner on 2026-10-27, with `npx supabase db query --linked -f supabase/migrations/20261001000091_security_hardening.sql`. Verified read-only afterwards: `label_set` has no anon SELECT, anon UPDATE or authenticated DELETE, and runs with `security_invoker`. No public view is readable by anon or writable by authenticated. The two test-login lookups and `app.authenticate_user` are gone from the API role's reach. Anonymous Data API requests to `label_set`, `activity` and `app_user` return `401 42501`. The API role still reads the demo tenant (14 active users). The hosted database has no migration ledger, so no ledger row was written.
- **P0-1 password rotation.** Hosted write. Not attempted. Needs approval, plus a team freeze.
- **P0-3 API keys.** Rotating the JWT secret or the API keys is not in the CLI commands I checked. It needs the Supabase dashboard, and it breaks the publishable key and all sessions.
- **P0-4 network allowlist.** Needs the list of IP addresses that keep access (`--db-allow-cidr`). Currently open to 0.0.0.0/0 and ::/0.
- **P0-5 repository visibility.** Repo `da1062332-web/DSA-Agent` is public. The account `gh` uses (vaibhav-qloax) shows admin=false, so the change needs the owner account, or admin rights.
- **P1-1 SSL enforcement.** Not changed. The CLI supports `--enable-db-ssl-enforcement`, but enabling it first needs `sslmode` set on every client connection string.
- **P2-1 point-in-time recovery.** Dashboard, paid add-on.
- **P2-2 sign-ups.** Dashboard. The web app has no `signUp` call, so turning it off should not affect sign-in. Invitations should be checked to use the admin API.
- **P2-3 storage.** The `Media` bucket is already private. Documents use signed URLs. No change needed.
- **P2-4 test residue.** Not deleted. The app tables carry forbid-delete and audit-seal triggers. Deleting residue means disabling them on the shared database, which needs a decision.

**Findings to decide**
- 3 of 111 user rows in `app.app_user` hold a `password_hash`. Nothing in the repo reads it. Options: clear the hashes, drop the column, or keep it.
- The hosted database has no `supabase_migrations.schema_migrations` table. So hosted was not migrated through the Supabase CLI. `migration repair` cannot help until a ledger exists.
- The three tables without RLS are global catalogues by design: `decision_definition` (7 rows, documented as a global registry), `decision_dependency` (2 rows), and `permission` (119 rows). Confirm this and document it.

**Not committed.** Proposed commit set: the security files, the two plan docs, migration 0091, and the manifest and lock. `apps/api/src/http/error-handler.ts` contains your uncommitted changes (network error classification, the 42P01 message, and the Postgres mapping), and the suite passes with them. `apps/web/src/shell/AppLayout.tsx` contains about 80 lines of your unfinished work, so it is excluded. Decision needed: include error-handler.ts with your hunks, or split them out.

**Kept on disk.** `apps/api/.env.bak` and `~/.dsa-env-backup/` hold old values. They are not deleted because of the rule about env files. After rotation they are dead values, and deleting them is one command.

## 11. "Update all on hosted DB" (2026-10-27)

The auto-mode permission check denied two hosted changes. The password rotation was denied because it writes new credentials to `apps/api/.env`. The clear of the three password hashes was denied as a shared-resource write. Neither was retried or routed around. Nothing on hosted changed in this step.

**Verified, no writes**
- Owner's account. The app user is ACTIVE in the platform tenant (`ten_01M4ZG67WTS51Q0XN7F1Y9CCYG`) with one active role. Its subject is a UUID that no Auth account has. No Auth account exists for the email, so Supabase answers "invalid credentials".
- Across all tenants: 111 app users. 58 point at Auth accounts that do not exist. Auth has 1 user, and it has no app user. So 58 people cannot sign in.
- `tools/provision-platform-admin.ts` refuses this case on purpose ("resolve this by hand"). So the by-hand steps below follow what the tool would do.
- `app.app_user` has one trigger, `app_user_touch`. Nothing blocks clearing the three hashes.
- Repo `da1062332-web/DSA-Agent`: `admin=false`, `push=true`, public. The visibility change needs the owner account.

**Ready, not run.** Each is a file in the session scratchpad, outside the repo.
1. Rotation: `node rotate-db.js`. Dry run first with `--dry-run` (no writes). Generates new passwords, changes `dsa_api` and `postgres` through the owner route, checks the new passwords connect before it writes `apps/api/.env`, and restores the old password if they don't. Output shows only booleans.
2. Clear hashes: `npx supabase db query --linked -f clear-password-hash.sql`.
3. Owner account: `node create-owner-auth.js` (report only), then `node create-owner-auth.js --apply`. That creates the Auth account with the platform tenant claim, email confirmed, no password. It writes `bind-owner-auth.sql`. Run that file with `npx supabase db query --linked -f bind-owner-auth.sql`. Then use Forgot password on the sign-in page. Setting the password is your step.
4. TLS: after step 1, set `sslmode=require` in the three URLs, check the connection, then `npx supabase ssl-enforcement update --project-ref mlpkwwhnagxzinaohdxg --enable-db-ssl-enforcement --experimental`.
5. Dashboard: turn off "Allow new users to sign up". Turn on point-in-time recovery (paid).
6. Network allowlist: needs the list of addresses that keep access.
7. Not planned yet: deleting test residue, the 57 other orphaned accounts (needs a decision on which are real staff), and rotating API keys and the JWT secret (breaks all sessions; dashboard only).

**Decision needed.** To have these run from here, add a Bash permission rule for them, or run the commands yourself as you did the migration.

## 12. Proposed operations, awaiting approval (2026-10-27)

Nothing in this section has been applied. Each operation lists its exact SQL or command, its expected effect, its rollback, and how to verify it. Approve each one by name.

### A. Restore the owner's Supabase Auth login (first)

Verified read-only: app user `usr_01M505JK2X7YH7ZYQW1PP5FAA2`, status ACTIVE, tenant `ten_01M4ZG67WTS51Q0XN7F1Y9CCYG` (PLATFORM, ACTIVE), one active role `ROLE-PLATFORM-SUPERADMIN` at tenant scope, branch `br_01M4ZJ8H51XBQ0A3RWZSBVRZAP`. Its subject `5e8d98af-0731-4e45-9bfa-9bbab606f277` matches no Auth account. Zero Auth accounts exist for the email.

Steps:
1. `node create-owner-auth.js` reports the state. It changes nothing.
2. `node create-owner-auth.js --apply` creates the Auth account. It refuses if an account with the email exists, and Supabase rejects duplicate emails, so no duplicate can be created. It sets `app_metadata.tenant_id` to the platform tenant and `email_confirm` to true. It sets no password. It writes `bind-owner-auth.sql`.
3. Run `bind-owner-auth.sql` with `npx supabase db query --linked -f <file>`. The SQL changes one row, and only while its subject is still the orphaned value. It returns the row, so zero rows means nothing changed.
4. Use Forgot password on the sign-in page to set a password.

Expected effects: the app record's login ID changes from the orphaned value to the new Auth ID. The role assignment, tenant, branch and status do not change. Permissions come from the role assignment, not from the Auth record, so no permission is added.

Rollback:
```sql
update app.app_user set idp_subject = '5e8d98af-0731-4e45-9bfa-9bbab606f277'
 where id = 'usr_01M505JK2X7YH7ZYQW1PP5FAA2' and idp_subject = '<NEW_AUTH_ID>';
```
Then delete the Auth user in the dashboard, or with `DELETE /auth/v1/admin/users/<NEW_AUTH_ID>`.

Verification:
```sql
select u.id, u.idp_subject, u.status,
       (select count(*) from app.user_role_assignment a where a.user_id = u.id and a.effective_range @> now()) as active_roles
  from app.app_user u where u.id = 'usr_01M505JK2X7YH7ZYQW1PP5FAA2';
```
Expect the new Auth ID, ACTIVE and 1. In the dashboard, the Auth user must be confirmed and must show `tenant_id` in its app metadata.

Dependencies:
- The reset email goes through Supabase's mailer. Check Authentication → Email before sending.
- `http://localhost:5173/reset-password` must be in Authentication → URL Configuration → Redirect URLs. Otherwise the link fails.
- Platform roles require an authenticator app. After sign-in you will enrol one. That is the screen fixed earlier today.
- This is a by-hand step. `tools/provision-platform-admin.ts` refuses this case on purpose ("resolve this by hand"). The `app_metadata` write uses the same admin call the tool uses. ADR-SB-02 says the provisioning CLI should write it, so confirm that exception.

### B. Rotate the database passwords (`dsa_api` and `postgres`)

Dry run, reviewed (no writes): three URLs. `DATABASE_URL` is `dsa_api` on the pooler, port 6543. `DIRECT_DATABASE_URL` is `postgres` on the direct host, port 5432. `VERIFY_DATABASE_URL` is `postgres.<ref>` on the pooler. All three would be rewritten.

What the script does: generates two new passwords and changes both roles through the owner route. It checks that the new `dsa_api` password connects before it writes `apps/api/.env`. If that check fails, it restores the old passwords and leaves `.env` unchanged. It prints booleans only.

Team impact:
- The local `.env` on this machine is updated by the script. It is a secret-store write, so it needs your explicit approval.
- Other developers' `.env` files stop working until they receive the new values. Send them out of band, never through chat or the repo.
- CI does not use the hosted database. `gh secret list` shows no secrets, and `ci.yml` uses a local stack.
- No deployment uses these credentials.
- Supabase's own services use their own roles. That is expected but not verified in this environment. Check the project's services after the change.
- Session pooling can take a few seconds to pick up a new password. The script retries.
- The script writes the new passwords into a temporary SQL file in the scratchpad and deletes it at once.

Rollback: before `.env` is written, the script restores the old passwords automatically. After success, do not restore the old passwords. They are exposed in git history.

Verification: the new `dsa_api` password connects and reports `dsa_api`. The old passwords are rejected.

Command: `node rotate-db.js` (preceded by `--dry-run`).

### C. Clear the legacy password hashes

Dependencies, checked read-only:
- No function mentions `password_hash`.
- The repo references it in one integration test, `apps/api/test/provision-platform-admin.int.spec.ts`, which expects the column to stay empty. Clearing it matches that expectation.
- The only trigger on `app.app_user` is `app_user_touch`, which updates `updated_at`. Nothing blocks the update.
- The three rows are test and demo data, with no Auth accounts: `usr_01JTESTUSER0000000000000000` (`test-dsa-alpha`, suspended), `usr_demo_01` and `usr_demo_02` (`demo-dsa`).
- `public.app_user` is a view that includes the hash column. It is granted to `authenticated`. Today it is protected because the view is `security_invoker` and `authenticated` has no `app`-schema usage. Clearing the hashes removes that exposure if those grants change.

Necessity: not required for sign-in, which uses Supabase Auth. It is worth doing as defence in depth, and it is irreversible.

SQL:
```sql
update app.app_user set password_hash = null where password_hash is not null returning id;
```
Expect three rows. Verify with `select count(*) from app.app_user where password_hash is not null;`, which should return 0.

Rollback: none. The values are not kept, deliberately. Hash values are sensitive.

### D. TLS for all database connections

Verified today, from this machine:
- The current connections are plaintext. The client socket is not encrypted for any of the three URLs.
- With the `ssl` option set in client code and no certificate check, all three connect, and the client socket is encrypted.
- Certificate verification fails with `SELF_SIGNED_CERT_IN_CHAIN`. The server's certificate needs Supabase's root CA, which this machine does not have.
- In this `pg` version, `sslmode=require` means full verification, so a URL that says only `require` fails.
- `sslmode=no-verify` in a URL is silently ignored, and the connection stays plaintext. TLS must therefore be set in code, not in the URL.
- `pg_stat_ssl` reported `false` for pooled connections while the client socket was encrypted. It appears to show the link inside Supabase, not the client's link. Use the client's own socket as the check.

Clients that need TLS support, before enforcement:
- Runtime: `apps/api/src/kernel-min/db.ts` (`createDb`, used by `apps/api/src/server.ts`).
- Tools: `tools/provision-platform-admin.ts`, `tools/provision-tenant.ts`, `tools/verify-migrations.ts`, `tools/test_lifecycle.ts`, `tools/sql/0050/enforcement-check.mjs`.
- Test helper: `apps/api/test/e2e_all_modules.ts`, and `apps/api/scripts/insert-demo-records.mjs`.
- Not to run against the hosted database: `tools/apply-migration-*.ts`, `tools/apply_fixes_to_hosted_db.ts`, and `apps/api/scratch/*`. Each uses a superuser-level URL. Propose deleting them after approval.
- Local integration tests use a local container and are refused for non-local hosts, so they are unaffected.

Steps, in order, each needing approval:
1. Download the root CA from the dashboard (Project Settings → Database → SSL Configuration), and save it outside the repo.
2. Change the clients above to pass `ssl: { ca, rejectUnauthorized: true }` for non-local hosts. Read the CA path from an environment variable. This is a repo code change, so it needs a review and test run.
3. Verify each URL: the client socket is encrypted and the certificate verifies.
4. Enable enforcement: `npx supabase ssl-enforcement update --project-ref mlpkwwhnagxzinaohdxg --enable-db-ssl-enforcement --experimental`.
5. Verify that a plaintext connection is refused after enforcement.

Rollback: `npx supabase ssl-enforcement update --project-ref mlpkwwhnagxzinaohdxg --disable-db-ssl-enforcement --experimental`. Keep the code change, because it does no harm.

Blocked on: the root CA file. Please download it from the dashboard, or approve me fetching it with the Management API.

### E. Test authentication against the shared database

Verified: `TEST_AUTH_ENABLED` is absent from `apps/api/.env`. The config loader refuses test login against the shared URL and database, even with the test OTP set. The regression tests `TEST-CFGG-08`, `TEST-CFGG-10` and `TEST-AUTH-03/04/06/10` pass in today's API unit run (1057 tests).

### Still outside this plan, and needing separate approval

- Network allowlist: needs the addresses that keep access.
- Deleting test residue, and the other 57 orphaned accounts: needs a decision on which are real staff.
- Rotating API keys and the JWT secret: dashboard only, signs everyone out.
- Repo visibility: the account is not an admin, so it needs the owner account.
- Sign-ups off and point-in-time recovery: dashboard steps.
