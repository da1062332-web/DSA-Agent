# Hosted database credential: remediation and rotation

Status: **the credential must be treated as compromised. It is not yet rotated. Current-file remediation is done; rotation and history cleanup are not.**

## What was exposed

- `check_status.cjs` contained the hosted Postgres connection string, including the database password, as a literal.
- The first commit that added it is `8e60e8f` (2026-10-29). The same password value appears in 23 commits in the local history, found by searching the history for the value. Any clone or remote that has those commits has the value.
- Local `apps/api/.env` and `apps/api/.env.bak` hold the hosted connection. Both are gitignored and untracked, so they are not in the repository, but they are on developer machines and must be updated as part of rotation.

## What has been done in the repository

- `check_status.cjs` reads `HOSTED_CHECK_DATABASE_URL` from the environment. With the variable absent it exits with code 1 and prints only the instruction, not any connection detail. It runs select statements only.
- `apps/api/test/check-status-config.spec.ts` (TEST-CHKSTAT-01 and 02) checks that the script holds no connection string and fails safely without the variable.
- `apps/api/test/no-embedded-secrets.spec.ts` (TEST-SECRETS-01) scans tracked files for database passwords, JWTs and Supabase secret keys. It passes.

This does not make the incident safe. The password still works until it is rotated, and it is still in the history.

## Required administrator action (authorized Supabase project owner only)

These steps are not performed by engineering. They need the Supabase project owner, through the approved administration process.

1. **Rotate the database password** in the Supabase dashboard for the hosted project (Project settings, then Database). Store the new value only in the approved secret store.
2. **Update every consumer** of the old value: local `apps/api/.env` on each developer machine, CI and deployment secrets, and any operator's `HOSTED_CHECK_DATABASE_URL`. Remove the old value from `apps/api/.env.bak` if the file is kept.
3. **Review connection history** in the Supabase logs for connections using the old password since 2026-10-29. Record what was found and who reviewed it.
4. **Confirm** the old password is refused and the new one works, using a read-only select.
5. **Record** the rotation date and the reviewer in the approved change log.

## Git history cleanup (not performed; requires explicit team approval)

Rotation makes the leaked value useless. Removing it from history is hygiene, and it is destructive:

- The option is to rewrite history to remove `check_status.cjs` from all commits (for example with `git filter-repo`), then force-push every branch and tag to every remote, then ask every contributor to re-clone.
- Do not run this without an explicit decision from the repository owners. It breaks existing clones and open branches.
- Do not force-push as part of this change.

## Known follow-up (not changed here)

- `check_status.cjs` sets `ssl: { rejectUnauthorized: false }`, which skips certificate verification. Verify the pooler certificate chain and enable verification. This is a separate change because it can break connectivity.
