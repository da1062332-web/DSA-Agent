# DSA CRM: final release readiness (connector ecosystem, migrations 0098 to 0102, MFA)

Date: 2026-11-03. Written for: the owners of the DSA CRM repository and the people who approve a hosted migration.

**Verdict: not ready for a hosted migration or a production release.** The code and the local tests are in order. What blocks release is
outside the code: an administrator's credential rotation, decisions on the business rules, a hosted database that has not been checked, and a
production configuration that currently runs without second factors.

## 0. Things to act on first

1. **Production runs without a second factor.** The API on Render answers `/public/v1/auth/config` with `{"mfaEnabled":false}`, so
   `SUPABASE_MFA_ENABLED` is `false` in production. Payout and approval step-ups are not enforced there. See section 7.
2. **The served frontend is older than the API.** The Vercel bundle has no MFA changes. The likely cause is that Vercel deploys `main`, which
   is still at `d423452`. Not verified (no dashboard access).
3. **The running API needs migrations 0098 and 0099 on the database it uses.** `supabase/MANIFEST.md` says they are not applied to hosted.
   If that is still true, users who hold only parent codes are refused on the sub-permission routes. Check first:
   [docs/HOSTED_MIGRATION_RUNBOOK.md](HOSTED_MIGRATION_RUNBOOK.md), section 3.
4. **The database password is still in the git history** and has not been rotated (F1). Rotation is an administrator's action.

## 1. Status

| Area                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                       | Evidence                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connector Management (MOD-CON): workspace, dashboard, referrals, activity, earnings, verification, bank accounts, agreements, portal users, activation                                                 | Implemented and tested locally. Activation of a connector that is not already ACTIVE is refused until the consent decision is made (fail-closed, by design).                                                                                 | Connector integration suites 137 of 137 (section 4); isolation 549 of 549; `CONNECTOR_VERIFICATION_DECISION.md`                                        |
| Connector Portal (MOD-CPT): referrals with consent code, duplicate refusal, statements, payouts with step-up and disputed-line exclusion, disputes with categories, rate card, partner document upload | Implemented and tested locally. Partner uploads are off until an approved document type exists and a malware scanner answers.                                                                                                                | Same suites; `connector-portal*.int.spec.ts`, `connector-portal-documents.int.spec.ts`                                                                 |
| Optional MFA                                                                                                                                                                                           | Implemented. The API reports `SUPABASE_MFA_ENABLED` at `GET /public/v1/auth/config`; the sign-in screen and the shell read it. With MFA off, sign-in is password only and no OTP module appears. With MFA on, the existing second step runs. | `auth-config.spec.ts` (API), `mfa-flow.spec.ts`, `auth-config.spec.ts` (web), 736 web tests, `mfa-enforcement.spec.ts` 6 of 6                          |
| Migrations 0098 to 0102: scripts, snapshot-based rollbacks, rehearsals                                                                                                                                 | Implemented and rehearsed on local throwaway databases. **Not applied to hosted.**                                                                                                                                                           | `migration-0098-0099.int.spec.ts` 9 of 9; `migration-0100.int.spec.ts`; `migration-upgrade-0100-0102.int.spec.ts`; `migration-audit-batch.int.spec.ts` |
| Security findings                                                                                                                                                                                      | F2, F5, F6, F10 to F18, F21, F22, F23, F24 fixed with tests. F1 and F7 done in code, not in the environment. F3 fixed in code and migration 0101, not applied. F4 accepted, to confirm.                                                      | `CONNECTOR_SECURITY_AUDIT.md`                                                                                                                          |
| Deployment                                                                                                                                                                                             | API and web are live. The API serves the MFA endpoint. The web bundle is older.                                                                                                                                                              | Section 6                                                                                                                                              |
| Browser verification                                                                                                                                                                                   | **Not performed.** No browser tool is available in this environment. A manual checklist is in section 9.                                                                                                                                     | --                                                                                                                                                     |

## 2. Migrations

| Version | File                                                     | Origin                       | Applied to hosted                           | Verify                | Rollback                                | Order       |
| ------- | -------------------------------------------------------- | ---------------------------- | ------------------------------------------- | --------------------- | --------------------------------------- | ----------- |
| 0097    | `20261001000097_connector_role_guard.sql`                | connector work               | Yes, 2026-10-29 (per `MIGRATION_MATRIX.md`) | `97.verify.sql`       | `97.rollback.sql`                       | before 0098 |
| 0098    | `20261001000098_permission_sub_permissions_expand.sql`   | origin (Dev 1, TASK-412)     | **Not per MANIFEST; not checked**           | `98.verify.sql` (new) | `98.rollback.sql` (new, needs snapshot) | 1st         |
| 0099    | `20261001000099_role_grants_per_roles_page.sql`          | origin (Dev 1, TASK-412)     | **Not per MANIFEST; not checked**           | `99.verify.sql` (new) | `99.rollback.sql` (new, needs snapshot) | 2nd         |
| 0100    | `20261001000100_connector_portal_dispute_and_upload.sql` | this work (pending approval) | No                                          | `100.verify.sql`      | `100.rollback.sql`                      | 3rd         |
| 0101    | `20261001000101_verification_connector_subject.sql`      | this work (pending approval) | No                                          | `101.verify.sql`      | `101.rollback.sql`                      | 4th         |
| 0102    | `20261001000102_partner_dispute_category_required.sql`   | this work (pending approval) | No                                          | `102.verify.sql`      | `102.rollback.sql`                      | 5th         |

- Lock: `supabase/migrations.lock.json` records 92 files, all unchanged (`npm run check:migrations -w @dsa/tools`).
- Versions are unique. Origin's 0098 and 0099 and this work's 0100 to 0102 were renumbered during the merge, so no two files share a version.
- Dependencies: the local rehearsals apply the migrations in this order. A fresh database built from all of them passes the isolation sweep.

### Commands (hosted, only with approval; full steps in the runbook)

```
# read-only, first (section 3 of the runbook)
npx supabase db query --linked -f tools/sql/batch/preflight.sql

# per migration: snapshot (0098, 0099 only), apply through the wrapper, verify
npx supabase db query --linked -f tools/sql/batch/98.verify.sql     # expect no FAIL row
npx supabase db query --linked -f tools/sql/batch/99.verify.sql
npx supabase db query --linked -f tools/sql/batch/100.verify.sql
npx supabase db query --linked -f tools/sql/batch/101.verify.sql
npx supabase db query --linked -f tools/sql/batch/102.verify.sql

# rollback, reverse order, only when needed (the snapshot and the confirmation are required for 98 and 99)
#   102.rollback.sql, 101.rollback.sql, 100.rollback.sql
#   SET dsa.rollback_m099_confirmed = 'no-human-grants';   then 99.rollback.sql
#   SET dsa.rollback_m098_confirmed = 'no-human-grants';   then 98.rollback.sql
```

Nothing above has been run against hosted. The `verify:migrations` script was not run, because it reads `apps/api/.env`, which can point at
the hosted database.

## 3. Test evidence (final code, this pass; numbers are actual results)

| Check                                                                         | Result                                                           | Baseline before this pass |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| Isolation sweep (`npm run test:isolation`)                                    | **18 of 18 files, 549 of 549 tests**                             | 548                       |
| API unit (`apps/api`, `npx vitest run`)                                       | **98 files, 1411 of 1411**                                       | 1409                      |
| Web unit (`apps/web`, `npx vitest run`)                                       | **109 files, 736 of 736**                                        | 736                       |
| Connector, MFA, document-type, migration integration (`vitest.int.config.ts`) | **14 files, 137 of 137**                                         | 97 (connector only)       |
| Migration rehearsal 0098 and 0099 (re-run after formatting)                   | **9 of 9**                                                       | new                       |
| Status-script tests (TLS, CA file)                                            | **4 of 4**                                                       | 2                         |
| Provisioning worker (TEST-WRK-01 to 11)                                       | **11 of 11**                                                     | 10                        |
| Migration lock                                                                | **92 files, unchanged**                                          | 92                        |
| API typecheck; web typecheck                                                  | **pass; pass**                                                   | pass                      |
| Production build: web (`vite build`)                                          | **pass, 27.0 s**                                                 | pass                      |
| Production build: API (`tsup`)                                                | **pass**                                                         | pass                      |
| ESLint, changed code files                                                    | **0 errors** (the one warning in the rehearsal test was removed) | 0 errors                  |
| Prettier, changed files                                                       | **pass** after formatting                                        | --                        |

Each figure is the output of a run in this pass. Re-run before a release, since the tree still has uncommitted changes.

Regression evidence for the two fixes that came from the failing tests:

- F22 (invitation resend): TEST-WRK-11 was run against the old clock comparison and **failed**, then against the fix and **passed**. The file was
  restored from a backup, and a diff confirmed the restore.
- F21 (signed file links): `file-link-signer.spec.ts` 4 of 4, covering the canonical signature, the exact segment count, and a tampered body.

## 4. Security findings

| ID        | Finding                                                                                                                         | Status                                                                                  | Action needed                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1        | Hosted database password in git history (23 commits, including backup branches)                                                 | Repository file fixed; **not rotated; history not rewritten**                           | Administrator: rotate, update consumers, check the logs (`SECURITY_CREDENTIAL_ROTATION.md`, section 1). Owners: decide on history cleanup (section 2) |
| F2        | Reactivation without a reason                                                                                                   | Fixed (TEST-CINS-07)                                                                    | --                                                                                                                                                    |
| F3        | Activation and bank accounts accepted any VERIFIED record                                                                       | Fixed in code and migration 0101; not applied to hosted                                 | Consent decision (section 5) before any connector can become ACTIVE                                                                                   |
| F4        | Duplicate-referral refusal confirms an open enquiry                                                                             | Accepted, to confirm                                                                    | Business: accept or change                                                                                                                            |
| F5, F6    | Partner page OTP handling; payout status shown when refused                                                                     | Fixed                                                                                   | --                                                                                                                                                    |
| F7        | Status script skipped TLS checks                                                                                                | **Fixed in code.** TLS always verified; the pooler CA comes from `HOSTED_CHECK_CA_FILE` | Operator: obtain the CA certificate from the Supabase dashboard (section 3 of the credential doc)                                                     |
| F8        | Payout step-up                                                                                                                  | Verified; no bypass                                                                     | --                                                                                                                                                    |
| F9 to F18 | Partner document download, upload refusals, cross-connector access, identity gate, role guard, revocation, response allow-lists | Verified by tests (see the audit table)                                                 | --                                                                                                                                                    |
| F19       | Tenant isolation                                                                                                                | 549 of 549                                                                              | --                                                                                                                                                    |
| F20       | Stray change to `vitest.future-clock.config.ts`                                                                                 | Resolved in the tree                                                                    | --                                                                                                                                                    |
| F21       | Signed file link accepted with a changed encoding                                                                               | Fixed, with regression tests                                                            | --                                                                                                                                                    |
| F22       | Invitation resend skipped under load (clock comparison)                                                                         | Fixed; TEST-WRK-11 regression test                                                      | --                                                                                                                                                    |
| F23       | Sign-in and OTP behaviour depended on Supabase error codes                                                                      | Fixed: the setting comes from the API                                                   | Decide the MFA policy (section 7)                                                                                                                     |
| F24       | Rollbacks could not tell migration rows from later hand-made rows                                                               | Fixed: snapshots and confirmation; refuses otherwise                                    | Owners: take the snapshots in the runbook; the human check is manual                                                                                  |

## 5. Business decisions (not decided here; defaults keep each feature safe)

| Decision                                                      | Current default                                                                                                                          | Recommendation                                                                                             | Who                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| Connector verification consent (F3, option A to D)            | Activation of a connector not already ACTIVE is refused. No connector verification can be recorded.                                      | Option A, after a compliance review of connector consent. Details in `CONNECTOR_VERIFICATION_DECISION.md`. | Compliance and product |
| Duplicate-referral refusal disclosure (F4)                    | Refusal confirms an open enquiry, after the customer's consent code is verified.                                                         | Accept, if the connector is already entitled to know the lead's status.                                    | Business               |
| Partner document types                                        | `partner_upload` is false by default (migration 0100). No partner upload is possible until a type is approved. Hosted types not checked. | Approve the specific types, one at a time, through the document-type settings.                             | Operations             |
| Partner dispute categories and the historical backfill (0102) | New partner disputes need a category. Older partner disputes keep NULL.                                                                  | Backfill only after a review of each dispute. Until then, keep the NOT VALID rule.                         | Operations and finance |
| Application and lender progress labels shown to partners      | Partners see lead-level steps only.                                                                                                      | Keep lead-level steps until the labels are approved.                                                       | Business               |
| Staff visibility of customer names on the connector workspace | `lead.read` staff see the name; the mobile number is hidden.                                                                             | Keep, unless compliance says otherwise.                                                                    | Compliance             |
| Dispute evidence attachments                                  | Not built. A dispute has no checklist to attach to.                                                                                      | Build only after the subject model is decided (a new subject type). Keep the feature off.                  | Product                |
| MFA policy                                                    | Production runs with `SUPABASE_MFA_ENABLED=false`.                                                                                       | See section 7.                                                                                             | Security owner         |

## 6. Deployment (observed, read-only; the owner must confirm the deployed commit)

- **Git:** `origin/beta` is at `a9e5222`, pushed in this work. Local `main` is at `d423452`, and local `beta` has uncommitted changes (14 entries). Nothing from this pass is committed.
- **API (Render, `https://dsa-agent-0it9.onrender.com`):**
  - `/health` returns 200 with `{"status":"ok"}`.
  - `/public/v1/auth/config` returns `{"mfaEnabled":false}`, so the running code includes the MFA endpoint.
  - `/v1/me` without a token returns 401.
  - The CORS preflight allows the frontend origin.
  - Not checked: authenticated flows, tenant loading and the connector APIs. These need a test account and the hosted data.
- **Web (Vercel, `https://dsa-agent-sand.vercel.app`):**
  - The page and a deep link return 200.
  - The bundle points at the Render API and the hosted Supabase project. It has no `localhost` API references.
  - The bundle does not contain the auth-config request or the OTP gating, so it predates the MFA change. The likely cause is that Vercel deploys `main`.
- The deployed commit cannot be read from outside. The owner should confirm it in both dashboards.

## 7. MFA: current state and recommendation

- **Current production state:** `SUPABASE_MFA_ENABLED=false`. Sign-in is password only. Payout and approval step-ups are not enforced, because the
  API treats the project as having no second factor. That is the existing design, applied deliberately, and it is the main risk in
  production today.
- **What the code does with the setting:** on, the authenticator step runs at sign-in, for step-up and on the security page, and the API
  enforces it for the sensitive permissions. Off, none of those steps appears anywhere, and the API skips step-up for every sensitive action.
- **Recommendation:** enable TOTP in the Supabase project (Authentication, multi-factor), set `SUPABASE_MFA_ENABLED=true` on the API, and check
  that users with the sensitive roles can enrol. Until enrolment is done for those roles, accept in writing that payout approvals run without a
  second factor.
- **Policy statements** (for the owner to confirm): the roles in `MFA_REQUIRED_PERMISSIONS` must hold an authenticator before sensitive
  actions; a mismatch between the API and the sign-in service ends sign-in with a message rather than continuing without a second factor.

## 8. Hosted migration prerequisites

Full procedure, checklist and rollback rules: [docs/HOSTED_MIGRATION_RUNBOOK.md](HOSTED_MIGRATION_RUNBOOK.md). In short:

1. Owner confirms the target project. Do not take the target from `apps/api/.env`.
2. Read-only checks: migration history, the catalogue, `preflight.sql`. Record the results.
3. Backup taken, timestamp recorded, restore tested into a scratch project.
4. Snapshots before 0098 and before 0099.
5. Human check that nobody granted a sub-permission or a template grant by hand.
6. Application release built from the same commit, deployed after the migrations.
7. Business decisions in section 5 recorded, with the features that depend on them kept off.
8. The owner's written approval for each write.

## 9. Remaining blockers

1. Credential rotation and connection-log review (administrator, F1).
2. Git history cleanup decision (owners, F1). Destructive; requires every contributor to re-clone.
3. Hosted state of 0098 and 0099, and their application (owner, with Dev 1).
4. Applying 0100 to 0102 to hosted (owner approval; business decisions in section 5).
5. Consent decision for connectors (F3). Connector activation stays blocked until it is made.
6. TLS CA file for the status script (operator, F7).
7. MFA policy and the production setting (section 7).
8. Vercel deployment of the current frontend (owner, with the dashboard).
9. Browser verification (needs a browser tool or a tester).
10. Dispute evidence attachments (new subject type; product decision).
11. Commit and push of the uncommitted changes (needs approval).

## 10. Manual test checklist (browser; not performed)

Run on the deployed frontend once the Vercel deployment is current, with one account per role.

1. Sign-in with a correct password. With MFA off, the dashboard opens with no code screen. With MFA on, the code screen appears.
2. Sign-in with a wrong password shows "Invalid email or password".
3. Sign-in with MFA on and a user who has no authenticator is taken to enrolment, not to the dashboard.
4. Security page with MFA off shows "switched off for this project" and no set-up buttons.
5. Staff user with a sensitive role can open the users, roles and organisation pages.
6. Partner login lands on the connector portal and nothing else. No console calls to `/v1/tenant` or notifications.
7. Partner portal: referral list, referral detail, statements, disputes, rate card. Each shows the server's data or the server's refusal message.
8. Partner payout request: a disputed line is not included.
9. Partner document upload: refused when no document type is approved and when no scanner is configured.
10. Connector workspace: dashboard counts, referrals, activity, verification tab. Counts the user may not see show as not visible, not as zero.
11. Connector activation of a connector that is not ACTIVE is refused with the message about verification.
12. Logout returns to sign-in. Reloading a protected page while signed out sends the user to sign-in.
13. The notification bell appears for staff and not for partner logins.
14. Deep links (for example `/leads/123`) load the app, not a 404.
15. Document download links from a previous session are refused once they expire.
