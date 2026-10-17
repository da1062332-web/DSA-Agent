# Credential exposure and remediation

Status date: 2026-10-16. **Rotation has not been done and needs the owner's explicit go-ahead.** This document names what was exposed and where. It contains no secret values.

## 1. What was exposed

| # | Credential | Where it was written | Reach if misused |
|---|---|---|---|
| 1 | Database login for the hosted project, administrator role (`postgres.<project-ref>`, through the pooler) | 14 tracked files (see 2) | Full read and write of the shared dev database, bypassing row-level security |
| 2 | Database login for the application role `dsa_api.<project-ref>` | The same files | Everything the API can do, still limited by row-level security |
| 3 | Supabase **service-role key** (a long-lived JWT) | `apps/api/test/e2e_all_modules.ts` (fallback value) | Bypasses row-level security through the REST API, and can create, change and delete Auth users |
| 4 | Supabase anon (publishable) key | `apps/api/test/e2e_all_modules.ts`, `apps/api/scratch/debug_delete_schedule.ts` | Public by design (it ships in the web bundle). Removed anyway, because a fallback key hides a missing setting |
| — | Project reference and project URL | Several places, including `packages/kernel/src/auth/verify-token.ts` (allowed issuer list) | **Not secret.** It appears in every browser request. Left as is |

All of them are in the repository's **git history** (a scan found 11 commits that added the database URL with its password) and on `origin/beta`. A password that was pushed stays recoverable from history even after the file is fixed, so **only rotation removes the exposure**.

A database URL with a password was also printed once into this working session's tool output while scanning (the password was redacted in every later command). Treat that as one more place it exists.

## 2. What was changed in code (done, tested, uncommitted)

- Removed every embedded database credential and hosted URL from application and test code. The eight `*.pg.int.spec.ts` specs, `apps/api/scripts/insert-demo-records.mjs`, `scratch/seed-m027-demo.ts`, `tools/apply-migration-0023.ts`, `0052.ts`, `0053.ts` and `tools/apply_fixes_to_hosted_db.ts` now require `VERIFY_DATABASE_URL` and refuse to run without it. The hosted tools have no built-in default any more.
- Removed the embedded service-role and anon keys and the hosted project URL fallback from `apps/api/test/e2e_all_modules.ts` and `apps/api/scratch/debug_delete_schedule.ts`.
- The nine `*-live-pg` specs no longer call `process.loadEnvFile` on `apps/api/.env`, and every database URL they read goes through `apps/api/test/support/test-db-url.ts`, which accepts only this machine.
- Integration and isolation suites run against a throwaway container only: `tests/guard/no-hosted-db.ts` refuses any non-local connection before DNS, `tests/guard/local-db.global-setup.ts` overrides `DATABASE_URL` with the container, and `tests/guard/verify-local-db.ts` proves the connection string reaches that container (it stamps the container id into the database and reads it back).
- `apps/api/test/no-embedded-secrets.spec.ts` fails the build if any file git tracks (or would track) contains a database password, a JWT or a Supabase secret key, and if a spec reads `.env` or the database URL without the local-only check. It was shown to fail on a planted secret.
- The frontend and backend keys stay separate: the web config already rejects `sb_secret_…` keys, and the API reads `SUPABASE_SERVICE_ROLE_KEY` only from its own environment.

## 3. Rotation plan (pending approval)

Do these in order. Each step breaks anything still using the old value, so tell the team first.

1. **Database passwords** (Supabase dashboard, Project settings, Database): reset the password of the `postgres` login and of the `dsa_api` login. Then update `DATABASE_URL`, `VERIFY_DATABASE_URL` and `DIRECT_DATABASE_URL` in your `apps/api/.env`, in every teammate's `.env`, and in any CI secret. The API and the one-off tools stop working until they are updated.
2. **Supabase API keys** (Project settings, API): the service-role key and the anon key are legacy JWTs signed with the project's JWT secret. Either rotate the JWT secret (this invalidates **every** key and every signed-in session) or move to the new publishable and secret keys and revoke the legacy ones. Then update `SUPABASE_SERVICE_ROLE_KEY` (API), `VITE_SUPABASE_PUBLISHABLE_KEY` (`apps/web/.env.local`), and anyone using the old keys. All users sign in again.
3. **Re-check:** run `npx supabase db query --linked "select 1"` and the three Module 1 verification commands with the new credentials, then sign in on the web app.
4. **History:** do not rewrite shared history to hide the old values (it would break every teammate's clone and does not help once pushed). After rotation the old values are dead. Optionally add the old fingerprints to the secret scanner's allowlist so the CI scan (gitleaks) stops reporting them.
5. **Other copies:** `apps/api/.env.bak` and `~/.dsa-env-backup/` hold the old values locally. They are gitignored. Delete them after rotation.

## 4. Why this is not done yet

Rotating a shared hosted project's credentials changes shared state and interrupts the whole team, so it is left to you. Everything that can be done safely without it is done and covered by the scan test above.

## 5. Update 2026-10-17

- **New exposure found and fixed in code:** five scratch scripts that arrived with a teammate merge (`apps/api/scratch/check_app.cjs`, `check_app.js`, `check_consents.cjs`, `fix_customer_consent.cjs`, `seed_pl_product.cjs`) embedded the database administrator connection string. They are on `origin/beta` and in git history. They now read `VERIFY_DATABASE_URL`; the secret scan (`no-embedded-secrets.spec`) caught them, which is the reason it exists.
- **History scan (counts only):** 11 commits added or removed a database URL with a password, 2 contain a Supabase key token. No tracked file in the current tree holds a real credential (the few matches are dummy values in tests).
- **Rotation was not attempted.** It would change the database passwords and Supabase keys that every teammate's `.env`, the CI secrets and any deployment depend on, and those dependencies cannot be listed from this machine. It also stops the stray test writers described in `docs/HOSTED_TEST_RESIDUE.md`, which is a reason to do it soon. Do it in the order of section 3, and tell the team first.
- **Verification after rotation:** the old passwords must fail to connect and the new ones must work (`npx supabase db query --linked "select 1"`), then run the Module 1 checks.
