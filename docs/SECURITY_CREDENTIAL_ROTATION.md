# Hosted database credential: remediation and rotation

Status: **the credential must be treated as compromised. It is not yet rotated, and the value is still in the git history. The repository
change (the file no longer holds the value) and the TLS change for the status script are done. Rotation and history cleanup need an administrator.**

No value is written in this document, and none should be pasted into a ticket, a log or a chat.

## What was exposed

- `check_status.cjs` contained the hosted Postgres connection string, including the database password, as a literal.
- The first commit that added it is `8e60e8f` (2026-10-29). The same password value appears in 23 commits of the local history. Any clone or
  remote that holds those commits holds the value. That includes the `backup/*` and `backup-*` branches, which contain the same history.
- Local `apps/api/.env` and `apps/api/.env.bak` hold the hosted connection. Both are gitignored and not in the repository, but they are on
  developer machines and must be updated during rotation.

## What has been done in the repository

- `check_status.cjs` reads `HOSTED_CHECK_DATABASE_URL` from the environment. With the variable absent it exits with code 1 and prints only the
  instruction. It runs select statements only.
- TLS is always verified (see the certificate section below). The script never sets `rejectUnauthorized` to `false`.
- `apps/api/test/check-status-config.spec.ts` (TEST-CHKSTAT-01 to 04) checks that the script holds no connection string, that it fails safely
  without the variable, that certificate checks are never turned off, and that an unreadable CA file stops the run before any connection.
- `apps/api/test/no-embedded-secrets.spec.ts` (TEST-SECRETS-01) scans tracked files for database passwords, JWTs and Supabase secret keys.

This does not make the incident safe. The password still works until it is rotated, and it is still in the history.

## 1. Rotation (administrator only)

These steps are not performed by engineering. They need the Supabase project owner, through the approved administration process.

1. **Rotate the database password** in the Supabase dashboard for the hosted project (Project settings, then Database). Store the new value only
   in the approved secret store.
2. **Update every consumer of the old value.** On Render, the service's environment variables that hold database URLs
   (`DATABASE_URL`, and `VERIFY_DATABASE_URL` and `DIRECT_DATABASE_URL` if they are set there). On each developer machine, `apps/api/.env`.
   Any operator's `HOSTED_CHECK_DATABASE_URL`. Remove the old value from `apps/api/.env.bak` or delete the file. Vercel holds no database
   credential.
3. **Restart** the API service after the change, and confirm `/health` answers.
4. **Review connection history** in the Supabase logs for connections that used the old password since 2026-10-29. Record what was found and
   who reviewed it.
5. **Confirm** the old password is refused and the new one works, using one read-only select.
6. **Record** the rotation date, the reviewer and the consumers updated, in the approved change log.

Rotation comes before any history cleanup. Rewriting history does not revoke the value.

## 2. Git history cleanup (not performed; requires an explicit decision by the repository owners)

Cleanup removes the value from the history. It is destructive and it changes every commit hash after the first occurrence.

Procedure, if the owners approve it:

1. Freeze pushes to every branch, including the `backup*` branches, and tell every contributor.
2. Write a replacement file **outside the repository**, mapping the value to a placeholder. Never print it or commit it.
3. Run the rewrite on a fresh mirror clone, not on a working copy: `git filter-repo --replace-text <that file>`.
4. Verify on the mirror, with output that does not show the value: search the rewritten history for the value and expect no match.
5. Force-push every rewritten branch and tag to every remote, after the owners' approval. Ask every contributor to re-clone.
6. Re-run the secrets test on the new head. It must pass.

Do not run any of these steps without an explicit decision by the repository owners. Do not force-push as part of any other change.

## 3. TLS certificate for the status script (F7)

The status script connects to the hosted pooler over TLS and verifies the server certificate. It never disables the check.

To configure it:

1. Download the database SSL certificate for the hosted project from the Supabase dashboard (the database settings page). Save the file on the
   operator's machine, **outside the repository**.
2. Set `HOSTED_CHECK_CA_FILE` to that file's path in the shell for the run, next to `HOSTED_CHECK_DATABASE_URL`.
3. Run `node check_status.cjs <application id>`.

Behaviour:

- With `HOSTED_CHECK_CA_FILE` set but unreadable, the script exits with code 1 before it connects, and names the variable and the path. It
  prints no connection detail.
- Without it, the system trust store is used. If that store does not trust the pooler, the connection fails. That is the intended result.
- Do not set `rejectUnauthorized` to `false`, and do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`, as a workaround.

Not verified here: the connection itself, because no hosted access was used. The certificate file has not been obtained.
