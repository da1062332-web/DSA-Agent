# Hosted deployment completion report

**Date:** 2026-11-04
**Scope:** Deployment-readiness audit, sections A to F. No deployment was made. Nothing was committed or pushed in this audit. No hosted data, schema or role was changed in this audit. Render and Vercel were not changed. No key was rotated.
**Branch:** `beta` at `55d87d5`, in sync with the local `origin/beta` ref (0 ahead, 0 behind). A fetch dry run reached the remote and updated no refs.

## 0. Verdict

**Not ready to deploy.** The hosted schema matches the migration files for every table they create, and 0098 to 0102 are applied and verified. The API and web builds pass locally. The migration ledger is still absent, and the blockers below stop a deploy. Two of them are live on Render today, not only at deploy time.

Live now, found in this audit:

1. **The public upload routes on Render use a signing secret that is hard-coded in source.** `apps/api/src/modules/origination/document-sharing/document-sharing-service.ts` line 30 holds the `SESSION_SECRET` literal. Lines 52 and 66 use it to sign and verify upload-session HMACs. The routes are mounted at `/public/v1/upload/:token` (`apps/api/src/app.ts` line 132). A request with a bogus token returns a structured 404 from the handler, so the route is live. The value is in git history (commits `71613d7` and `e97f998`). It is not printed here, and no forgery was attempted. The same router stores files on local disk with a magic-byte check only, with no malware scanner.
2. **Second factor is off in production.** `GET https://dsa-agent-0it9.onrender.com/public/v1/auth/config` returns `{"mfaEnabled":false}`. With `SUPABASE_MFA_ENABLED=false`, the API skips the aal2 check at sign-in and the step-up for payouts and approvals (see section 6).

Blockers before any deploy: section 10.

## 1. Git and verification

| Item | Status |
|---|---|
| `beta` HEAD | `55d87d5` (`docs: record the hosted migrations 0098 to 0102 applied with snapshots and verification`). Working tree clean |
| Commits since `4727297` | `94fa731` connector fixes (consent subject, active-connector referrals, dispute SOD, unique mobile, audited consent sends), `e4d9281`, `a96372e`, `55d87d5` (docs) |
| Upstream changes from Bhushan Shimpi | `76010cf` and `ea987c0` are kept. Their 18 deletions are kept as they are on `origin/beta`. They were **not** restored, and their intent is **not confirmed** |
| Force push or history rewrite | None |
| Signing-key literal | Redacted in the current tree (`docs/AUDIT_REPORT_2026-10-26.md`). Still in git history (`912a261`, `4000af4`, `71613d7`). Not rewritten |

Verification ran on the connector working tree before it was committed as `94fa731`. It was not re-run on the committed tree:

| Check | Result |
|---|---|
| Root typecheck | Pass |
| Kernel unit | 31 of 31 |
| Web unit | 752 of 752 |
| API unit | 1411 of 1411 |
| Integration, focused (connector, portal, verification, document, payout, dispute, attribution, invitation, audit, migration, lead) | 207 pass, 34 skipped. Three migration-rehearsal files fail at setup (section 3) |
| Tenant isolation sweep | 549 of 549 |
| Web and API production builds | Pass |
| Lint | 958 problems: 1 error in `e2e/helpers/mock-session.ts` (predates this work), 957 warnings |

The Playwright e2e suite and browser checks were not run. They need browsers and the public Vercel URL.

## 2. Migrations (local)

- 92 migration files. Every hash matches `supabase/migrations.lock.json`. No duplicate version prefixes.
- Version identifiers are 14 digits, `20261001000000` to `20261001000102`, with gaps. The CLI ledger uses these identifiers, not the short `0098` style.
- All 92 files apply in order on a fresh database with the test fixtures.
- 0099 verify: PASS. 0098 verify on a fixture database reported 29 missing backfill grants. Re-applying 0098 clears them. The fixtures create roles after the migrations, so this does not show what hosted reports.
- 0098 inserts grants for permission codes defined by 54 to 65. Applied without them it fails on a foreign key. The three rehearsal files (`migration-sequence`, `migration-batch-partial`, `migration-batch-runbook`) skip 54 to 65 but still apply 0098. This is a stale test model (AUD-P1-09), not a defect in the migrations.

## 3. Audit A: database

### A1. Temporary login roles

Read-only, one query through the linked CLI. Five CLI calls were made in this audit; each one initialises the login role.

| Role | Login | Owns | Grants | Member of | Open sessions | Assessment |
|---|---|---|---|---|---|---|
| `cli_login_postgres` | yes, expires about 5 minutes after each CLI call | 0 relations, 0 schemas, 0 functions | 0 | `postgres` | 0 | The CLI's working role. Safe to drop once expired and with no CLI command running. It is recreated on the next CLI call |
| `postgres` | yes | 1044 relations, 96 functions, 3 schemas | 2567 | 12 roles | 2 | Platform owner. Keep |
| `dsa_api` | yes | nothing | 0 | `dsa_app` (`postgres` is also a member of `dsa_api`) | 8 (7 idle, 1 idle in transaction, via Supavisor) | The API's database role, as the runbook requires. Keep |
| `authenticator`, `pgbouncer`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_etl_admin`, `supabase_read_only_user`, `supabase_replication_admin` | yes | platform-owned | platform-managed | platform-managed | platform-managed | Supabase platform roles. Do not touch |

Findings:

- Only **one** CLI login role exists in the catalogue: `cli_login_postgres`. The earlier report said the CLI roles "were not removed". The catalogue does not show roles from earlier CLI calls. The CLI reuses one role name and reissues it, so the earlier wording overstated the leftover roles. Correct that wording.
- The role owns nothing and grants nothing, and it has no session when it is not in use. Its only risk is that it exists.
- The API connects as `dsa_api` (8 Supavisor sessions as `dsa_api`). This matches the `DATABASE_URL` rule in section 6.
- Nothing else in the login list is an app role that could be confused with a temporary one.

Cleanup SQL is in section 9, for review only. It is not run. The recommended action is to leave the role for the CLI to manage, and drop it only if the owner wants the catalogue clean, after expiry and with no CLI command in progress.

### A2. Migration ledger

- `supabase_migrations` schema: **absent**. `supabase_migrations.schema_migrations`: **absent**.
- The CLI therefore sees no migration as applied. `supabase db push` against this project would try to apply all 92 files, starting with `0000_roles_and_helpers`. **Do not run `db push` against hosted until the ledger is reconciled (section 8).**

### A3. Hosted state against the migration sequence

Read-only checks, run on 2026-11-04 after the writes:

| Check | Result |
|---|---|
| Tables created by migrations (144 names, from the `CREATE TABLE` statements, checked in `app` then `public`) | **All 144 present**, in every migration that creates tables (50 files). The schema dump taken before the writes also contains 144 `CREATE TABLE` statements |
| Marker 0065: `app.ledger_entry` absent, `app.connector_statement_entry` present | OK |
| Marker 0100: `dispute.category`, `document_type.partner_upload` | Present |
| Marker 0101: `verification.connector_id` | Present |
| Marker 0098 catalogue: `app.permission` | 151 rows (119 before, plus 32 from 0098) |
| `app.role_permission` | 366 rows (218 before 0098, 355 before 0099) |
| Snapshots in `dsa_backup`: `permission_pre_m098` 119, `role_permission_pre_m098` 218, `role_permission_pre_m099` 355 | Present, counts match |
| Test-login functions (`lookup_test_user`, `list_test_users`, from 0086) | **Absent**, as 0096 intends |
| Migrations 0098 to 0102 | Applied and verified (verify scripts: no FAIL row). Recorded in section 1 of the earlier report |

**Not verified on hosted:** the 42 migration files that create no table. Their effects (functions, columns, grants, seeds) were not checked on hosted. The local rehearsal covers them, but not the hosted state. Section 8 describes how to check them.

### A4. Other findings in the database

- The hosted audit query returned only the platform roles, the app role, the one CLI role, and the sessions above. No other login role was found.
- Document rows on hosted: `document` 13, `document_version` 13, `upload_intent` 13, `uploaded_document` 2 (counts only). See section 5.
- One session is `idle in transaction` under `dsa_api`. Watch it. It is not a deploy blocker.

## 4. Audit B: backups

| Item | Result |
|---|---|
| Schema dump | `C:\Users\Vaibhav\dsa-backups\2026-11-04\schema-app-public.sql`, 504,853 bytes, SHA-256 `5336ae475d474b742eedccef64c172b915afcd754d8846376562d968909bdd0b` |
| Data dump | `C:\Users\Vaibhav\dsa-backups\2026-11-04\data-app-public.sql`, 423,099 bytes, SHA-256 `bd87b9cb426acd5d1e544c170a986b1dd5a70deb106f5d2ae50445cbf3bab024` |
| Timestamp | Both written 2026-11-04 12:32 (local time), before the first hosted write |
| Inside the repository | No copy. The only `*public.sql` match in the repo is a migration filename |
| Secret-shaped content | No `PASSWORD '` clause, no `CREATE ROLE` or `ALTER ROLE` statement, no JWT-shaped string, in either file. The schema dump mentions `service_role` 147 times. These are role names in grant and policy statements; the count was checked, not each line. No key-shaped string was found |
| Personal data | Yes. The data dump holds application rows. Its contents are not printed in this report |
| Encryption | **None.** Both files are plain SQL |
| Scope | **Only the `app` and `public` schemas.** The files contain no `auth` or `storage` object references. Supabase Auth users, MFA factors and storage objects are **not** in these backups |
| Access | Folder ACL: `NT AUTHORITY\SYSTEM` (full), `BUILTIN\Administrators` (full), `VAIBHAV\Vaibhav` (full), all inherited |
| Restore test | Local PostgreSQL 17.11 (`postgres:17` image), **not** a Supabase scratch project. The Supabase roles and the `citext`, `pgcrypto` and `btree_gist` extensions were created by hand. The `SET transaction_timeout` line was removed from the dump. Counts matched before the writes: `permission` 119, `role_permission` 218, `app_user` 22, `connector` 2, `staff_invitation` 4 |

Recommendations:

1. **Encrypt** both files at rest with an authenticated tool (for example `age` or 7-Zip AES-256). Keep the passphrase in a password manager. Remove the plain copies after the encrypted ones are verified.
2. **Restrict access** to the owner account only. Remove the inherited `Administrators` and `SYSTEM` grants unless backup tooling needs them. Keep the folder out of any synced location.
3. **Retention:** keep the pre-write pair until the owner signs off 0098 to 0102 and a newer backup exists. Then delete them on a written schedule. Keep one encrypted copy off this machine.
4. **Add the `auth` schema** to the backup, because Supabase Auth users and MFA factors are not in these files. Without it, `app.app_user.idp_subject` cannot be linked to a user after a restore. Use Supabase's own backup or PITR as the primary control, and treat these files as a second copy.
5. **Document-store bytes** are not in either dump (section 5).
6. The restore test proves only that the dump loads into PostgreSQL 17 with the listed counts. It does not prove a restore into Supabase, the `auth` schema, or storage. Repeat it in a Supabase scratch project before relying on these files.

## 5. Audit C: render storage (`DOCUMENT_STORE`)

### C1. What the code reads

- `DOCUMENT_STORE` (`apps/api/src/config.ts` line 93): `local` or `s3`. Default `local`.
- For `s3` the API requires four variables (config.ts lines 154 to 162): `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ACCESS_KEY_ID`, `DOCUMENT_S3_SECRET_ACCESS_KEY`. `DOCUMENT_S3_REGION` is optional (default `us-east-1`).
- Supported backends: **`local`** (development only: a folder on the instance, lost on redeploy) and **`s3`** (any S3-compatible bucket: AWS S3, the Supabase Storage S3 endpoint, or MinIO). The S3 store uses the bucket's own access keys, never the Supabase service-role key (`document-backends.ts` header).
- Files are encrypted at rest with AES-256-GCM, with a key per tenant derived from **`APP_SIGNING_SECRET`**, whichever store is used. Changing that secret makes existing encrypted files unreadable.
- `CLAMAV_ADDRESS` enables the malware scanner for the origination document path.
- The blueprint `render.yaml` does not set `DOCUMENT_STORE`, so the default `local` applies unless the dashboard sets it. **Unverified in the dashboard.** The public endpoints do not reveal it.

### C2. Code gap: the sharing path ignores `DOCUMENT_STORE`

- `apps/api/src/modules/origination/document-sharing/document-sharing-service.ts` lines 38 to 41: the service falls back to `new LocalDocumentStorage()` when no storage is passed. Its scanner falls back to `MagicByteFileScanner`, which has no malware scan.
- `apps/api/src/modules/origination/document-sharing/router.ts` line 165 builds the public router with no storage or scanner override.
- Result: **`DOCUMENT_STORE=s3` does not cover the sharing path**, and `CLAMAV_ADDRESS` does not cover it either. Files on that path always stay on local disk under `./uploads/documents` (the path is not configurable).
- Two rows exist on hosted in `app.uploaded_document`.

Fix (needs approval, then code and tests): route the sharing storage and scanner through the same configured backends as origination, or switch the public sharing router off until it is done.

### C3. Existing uploaded documents

Hosted counts (2026-11-04):

| Table | Rows |
|---|---|
| `app.document` | 13 |
| `app.document_version` | 13 |
| `app.upload_intent` | 13 |
| `app.uploaded_document` (sharing path, local only) | 2 |

- The database holds the object keys and SHA-256 values, not the bytes. Whether the bytes still exist depends on where the API wrote them. The database cannot show that.
- **If `DOCUMENT_STORE` is `local` on Render, the bytes are on the instance disk.** The blueprint has no persistent disk. A redeploy replaces the instance, so those files are lost.
- **Do not redeploy the Render service until the location of the 13 origination files and the 2 sharing files is confirmed.** If they are on the instance, copy them off first.
- Migration procedure once S3 is configured:
  1. Copy each file under its existing key (`<tenantId>/<name>`) into the bucket, through the app's own store, so encryption applies the same way.
  2. Verify every row: read it back through the store and compare with the stored SHA-256. Confirm first what that hash covers (plaintext or stored bytes).
  3. Only then remove the local copies, after a retention decision.
- Local folder names: origination `DOCUMENT_STORAGE_DIR` (default `./uploads/documents-v2`, not in the config schema, read directly from the environment); sharing `./uploads/documents` (fixed).

### C4. Recommendation

- **Backend:** `s3`. Choose one provider. For a project already on Supabase, the Supabase Storage S3 endpoint (`https://<project>.supabase.co/storage/v1/s3`, per the code comment) keeps one vendor. AWS S3 is the alternative. Either way: a **private** bucket, a bucket key limited to that bucket, and a key separate from the service-role key.
- **Environment names:** `DOCUMENT_STORE`, `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ACCESS_KEY_ID`, `DOCUMENT_S3_SECRET_ACCESS_KEY`, and optionally `DOCUMENT_S3_REGION`.
- **Do not configure local storage on Render for production.** That includes setting `DOCUMENT_STORAGE_DIR`.

## 6. Audit D: MFA

### D1. What the setting does

- `SUPABASE_MFA_ENABLED` (`apps/api/src/config.ts` line 65). Default `true`. `false` means the project has no second factor, so the API asks for none.
- `apps/api/src/http/mfa-switch.ts` `secondFactorSkipped()` returns true when `SUPABASE_MFA_ENABLED=false` (or the local-only `DISABLE_MFA` switch applies).
- `apps/api/src/http/supabase-auth.ts` lines 26 to 33: with `secondFactorSkipped()` false, a principal whose role requires MFA and whose token is not `aal2` is refused with `STEP_UP_REQUIRED`.
- Step-up for payouts, bank approvals and other sensitive actions (`requireStepUp`, for example `finance/router.ts`, `connector-portal.ts`, `compliance/privacy-controls.ts`) is skipped when the setting is `false`: `packages/kernel/src/authz/authz.ts` lines 73 to 75 return without a check on `SUPABASE_MFA_ENABLED === 'false'`.
- That same check reads `DISABLE_MFA` and `SUPABASE_MFA_ENABLED` straight from `process.env`, not through the guarded helper in `mfa-switch.ts`. For `DISABLE_MFA` the startup refusal in `config.ts` is the only protection. This is the pattern AUD-038 recorded.
- `GET /public/v1/auth/config` returns `{"mfaEnabled": !secondFactorSkipped()}`, so the web app's sign-in screen follows the same setting.

### D2. Current production state (observed)

- `GET https://dsa-agent-0it9.onrender.com/public/v1/auth/config` returns `{"mfaEnabled":false}` (HTTP 200). **Production runs with no second factor. Payout and approval step-ups are not enforced.**
- `DISABLE_MFA` is not `true` on Render. The config refuses `DISABLE_MFA=true` outside a local stack, and the service is running. This is an inference, not a dashboard check.
- `TEST_AUTH_ENABLED` is off. `GET /public/v1/auth/test-users` returns 404.

### D3. Hosted TOTP state (read-only, counts only)

| Measure | Result |
|---|---|
| Verified TOTP factors in `auth.mfa_factors` | 2 |
| App users (`app.app_user`) | 22 |
| App users with a verified factor (matched on `idp_subject`) | **2**. **20 of 22 have none** |
| Auth users (`auth.users`) | 21. The count differs from the app-user count by one. Not investigated |

**Not verified:** whether TOTP is enabled in the Supabase project now. The database cannot show that. The only way to read it is the Supabase dashboard (the authentication settings, multi-factor section) or the management API, which needs an account token. This audit did not use one. The owner must confirm it in the dashboard.

### D4. Recommended value: `SUPABASE_MFA_ENABLED=true`

Security consequences:

- With `true`, sign-in for MFA-required roles needs an `aal2` token, and step-up is enforced for sensitive actions. That is the intended policy.
- With `true` and TOTP off in Supabase, MFA-required users cannot sign in, and the message says so. It does not fall back to no second factor.
- With `true`, the 20 users without a verified factor who hold an MFA-required role are locked out until they enrol. Users without such a role are not affected.
- With `false`, the whole second-factor model is off in production, and payout approvals run without a second factor. This is a documented choice in `docs/DSA_FINAL_RELEASE_READINESS.md`, but it is not acceptable for payouts without a written risk acceptance from the security owner.

Order of operations:

1. Confirm in the Supabase dashboard that TOTP is enabled.
2. Identify the MFA-required roles (`MFA_REQUIRED_PERMISSIONS` in the code) and the users holding them. Enrol each one, or remove the role.
3. Set `SUPABASE_MFA_ENABLED=true` on Render, and redeploy the API.
4. Check `GET /public/v1/auth/config` returns `{"mfaEnabled":true}`.
5. Sign in with an enrolled MFA-required account and check step-up on a sensitive action.

## 7. Audit E: Vercel (`VITE_API_BASE_URL`)

### E1. How the value is consumed

- `apps/web/src/config.ts` line 10: `VITE_API_BASE_URL: z.string().url()`. It must be an absolute URL.
- `apps/web/src/api/client.ts` lines 103, 194 and 220: each request is `` `${base}${path}` ``, and every `path` starts with `/` (for example `/v1/me`, `/portal/v1/...`, `/public/v1/...`).
- Other direct consumers use the same concatenation: `features/documents/api.ts` line 63, `features/connectors/partner-upload.ts` line 99, `auth/auth-config.ts` line 22, `auth/LoginPage.tsx` line 171, `auth/SecondFactorDialog.tsx` line 339, `auth/StepUpProvider.tsx` line 81.
- Vite inlines the value at **build time**. Changing it needs a rebuild.

**Rule:** the value is the origin only: `https://dsa-agent-0it9.onrender.com`. No trailing slash, and no `/v1` or other path suffix. A trailing slash produces `//v1/...` and breaks every call.

### E2. Served production bundle (public GET, 2026-11-04)

| Check | Result |
|---|---|
| Entry asset | `https://dsa-agent-sand.vercel.app/assets/index-I3Mo33pO.js`, 2,221,667 bytes |
| Render API host | Present, once. Consistent with `VITE_API_BASE_URL` pointing at Render |
| `service_role` | None |
| Key-shaped `sb_secret_` string | None |
| JWT-shaped tokens | One, with role `anon`. Public by design |
| Publishable key prefix `sb_publishable_` | One value present, public by design |
| Supabase host | `mlpkwwhnagxzinaohdxg.supabase.co`, the project ref |
| **Test-login variable name `VITE_TEST_BYPASS_OTP`** | **Present.** The bundle carries the test-login code path. It is inert only if the variable is unset at build time. Treat as a blocker until a rebuilt bundle is checked |
| `localhost:9999` literal | Present. Source not traced |

The served bundle predates the MFA change (the 2026-11-03 observation: `main` at `d423452`, no auth-config request in the bundle). Re-check this after any redeploy.

### E3. Local build

- `apps/web/.env.local` exists. It is git-ignored and not tracked. It sets `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` and `VITE_TEST_BYPASS_OTP` (names only are recorded here). Vite reads it during local builds, so **never upload a locally built `dist` as the release**. Vercel builds from git and does not see this file.
- The local `dist` contains a `localhost:3000` reference. It most likely comes from `apps/web/.env.local`. This was not traced further.

## 8. F1. Render environment checklist (service `dsa-api`)

Names and rules only. No value is printed in this report.

| Name | Required value or rule | Observed 2026-11-04 | Action |
|---|---|---|---|
| `NODE_ENV` | `production` | Not visible from outside | Confirm in dashboard |
| `LOG_LEVEL` | `info` (optional) | Not visible | Optional |
| `DATABASE_URL` | Supavisor pooler URL, transaction mode, port 6543, connecting as `dsa_api`. Never `postgres`, `supabase_admin` or `service_role` | 8 Supavisor sessions as `dsa_api` | Confirm the role in the dashboard value |
| `SUPABASE_URL` | `https://mlpkwwhnagxzinaohdxg.supabase.co` | Not visible | Confirm |
| `SUPABASE_JWT_SECRET` | Only if the project uses a shared secret; blank for asymmetric keys | Not visible | Confirm; never print |
| `APP_SIGNING_SECRET` | At least 32 characters, identical on every instance. Changing it makes encrypted documents unreadable. Keep an offline backup | Not visible | Confirm; never print |
| `CORS_ALLOWED_ORIGINS` | Exact Vercel production origin(s), comma-separated, no trailing slash | Preflight allowed the Vercel origin on 2026-11-03 | Re-check once the Vercel domain is final |
| `CLAMAV_ADDRESS` | `host` or `host:port` of a running clamd. Required before partner uploads | Not visible. `render.yaml` names the variable (line 26) and defines no ClamAV service | Provision ClamAV, then set |
| `DOCUMENT_STORE` | `s3` | Not visible; code default `local` | Set `s3` (section 5) |
| `DOCUMENT_S3_ENDPOINT` | `https://` URL of the S3 API | Not set in repo config | Set |
| `DOCUMENT_S3_BUCKET` | Private bucket | Not set in repo config | Set |
| `DOCUMENT_S3_ACCESS_KEY_ID` | Bucket-scoped key, not the service-role key | Not set in repo config | Set |
| `DOCUMENT_S3_SECRET_ACCESS_KEY` | As above | Not set in repo config | Set; never print |
| `DOCUMENT_S3_REGION` | Optional; default `us-east-1` | Not set | Set if the provider needs it |
| `SUPABASE_MFA_ENABLED` | `true` | **`false`** (live) | Change after the section 6 prerequisites |
| `DISABLE_MFA` | Absent or `false` | Inferred `false` (the service runs) | Ensure absent |
| `TEST_AUTH_ENABLED` | Absent or `false` | Live: test-users route returns 404 | Ensure absent |
| `TEST_BYPASS_OTP`, `TEST_DATABASE_HOSTS`, `BYPASS_JWT_SECRET`, `TEST_TOKENS`, `ENABLE_MOCK_PROVIDERS` | Absent | Not visible | Ensure absent (`ENABLE_MOCK_PROVIDERS` is refused in production) |
| `DOCUMENT_STORAGE_DIR` | Absent once `DOCUMENT_STORE=s3` | Not visible | Ensure absent |
| `PORT` | Do not set | Render sets it | Do not set |

Render blueprint note: `render.yaml` does not list `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED`, `DISABLE_MFA` or `TEST_AUTH_ENABLED`. Adding them is a configuration change that needs approval.

## 9. F2. Vercel environment checklist (project, Production scope)

| Name | Required value or rule | Observed 2026-11-04 | Action |
|---|---|---|---|
| `VITE_API_BASE_URL` | `https://dsa-agent-0it9.onrender.com`. Origin only, no trailing slash, no `/v1` | Render host present once in the served bundle | Confirm the exact value in the dashboard |
| `VITE_SUPABASE_URL` | `https://mlpkwwhnagxzinaohdxg.supabase.co` | Project host present in the served bundle | Confirm |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key (`sb_publishable_...`). Never a `sb_secret_` key or the service-role key | One publishable value present; no secret-shaped key | Confirm which key is set, without copying it into any document |
| `VITE_TEST_BYPASS_OTP` | **Must not be set** | **Name present in the served bundle** | Remove from Vercel; rebuild; re-check the bundle |
| `VITE_TEST_AUTH`, `VITE_DISABLE_MFA`, `VITE_TEST_TOKENS` | **Must not be set** | Not in the served bundle | Ensure absent |
| Production branch | The release branch that contains this work. Not `main` until `main` carries it | `main` at `d423452` per 2026-11-03; the served bundle predates the MFA change | Decide the branch |
| Root directory and build | One consistent setting: root `apps/web` (per `docs/DEPLOYMENT.md`), or the repository root with `npm run build:web` (per `vercel.json`) | Not verified (dashboard) | Confirm and use one |
| Output | `dist` | Per `vercel.json` | Confirm |

## 10. F3. Cleanup SQL (for review; not executed)

The full file is `C:\Users\Vaibhav\AppData\Local\Temp\claude\c9fa3db893ba6b84\1f41b188-21cc-477a-8d75-6869578a14d6\scratchpad\audit\cleanup-review.sql`. The SQL is reproduced here:

```sql
-- Step 1 (read-only): preconditions.
select u.usename as role_name, u.valuntil,
       (select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'cli_login_postgres') as owned_relations,
       (select count(*) from pg_namespace n join pg_roles r on r.oid = n.nspowner where r.rolname = 'cli_login_postgres') as owned_schemas,
       (select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = 'cli_login_postgres') as owned_functions,
       (select count(*) from pg_stat_activity where usename = 'cli_login_postgres') as open_sessions,
       now() as checked_at
from pg_user u where u.usename = 'cli_login_postgres';

-- Step 2 (hosted write; only after approval and with no CLI command running).
do $$
declare
  v_role constant text := 'cli_login_postgres';
  v_valid timestamptz;
  v_owned bigint;
begin
  select u.valuntil into v_valid from pg_user u where u.usename = v_role;
  if v_valid is null then
    raise notice 'role % is not present; nothing to do', v_role;
    return;
  end if;
  if v_valid > now() then
    raise exception 'role % is valid until %; refusing until it expires', v_role, v_valid;
  end if;
  if exists (select 1 from pg_stat_activity where usename = v_role) then
    raise exception 'role % has open sessions; refusing', v_role;
  end if;
  select (select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = v_role)
       + (select count(*) from pg_namespace n join pg_roles r on r.oid = n.nspowner where r.rolname = v_role)
       + (select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = v_role)
    into v_owned;
  if v_owned > 0 then
    raise exception 'role % owns % objects; refusing', v_role, v_owned;
  end if;
  execute format('drop role %I', v_role);
end $$;

-- Step 3 (read-only): confirm. The role may reappear the next time the CLI runs.
select rolname from pg_roles where rolname like 'cli_login%' order by rolname;
```

Do not run any other drop. Do not use `DROP OWNED` or `REASSIGN OWNED`.

## 11. F4. Ledger reconciliation plan (for approval; no step executed)

Goal: a ledger that matches what is applied, recorded only on evidence, with no history row written blind.

1. **Freeze the CLI on hosted.** No `supabase db push` and no `supabase migration repair --linked` until steps 2 to 6 are approved. `db push` would treat all 92 files as pending.
2. **Marker map for the 42 files that create no table.** For each file, read its own DDL and list one check per effect: a function, a column, a constraint, a grant row, or a seeded row. Put the map in a reviewed read-only SQL file under `tools/sql/`. Run it on hosted and record the result per file. A failing marker is not recorded. It is escalated.
3. **Decide the baseline with the owner.** Record a version only when its marker map passes. The table checks for the 50 table-creating files already pass. The marker map still has to cover the 42 files that create no table, which includes 0095 to 0097.
4. **Rehearse the ledger on a disposable Supabase project.** Confirm what `supabase migration repair --status applied` does when the ledger is absent: whether it creates `supabase_migrations.schema_migrations`, and with which columns. This audit did not verify that. If it does not create the table, create it exactly as the CLI expects, as observed in the rehearsal.
5. **Record the verified versions in order** with `--status applied`, on hosted, after written approval from the hosted-database owner. Record 0098 to 0102 as well, and reference their wrapper files and SHA-256 values in the release notes, because the ledger has no column for them.
6. **Post-check:** `npx supabase migration list --linked` shows local and remote matching for every recorded version. `npx supabase db push --dry-run` reports nothing pending. Only then may `db push` be used for future migrations.
7. **Rollback:** `supabase migration repair --status reverted <version>` for any version recorded in error. Dropping the ledger table is a separate approval.

Approvals: the hosted-database owner (named by the owner) and the security owner, with the marker results attached.

## 12. F5. Remaining blockers and risks

### Blockers (stop deployment)

| # | Blocker | Where | Owner | Needed |
|---|---|---|---|---|
| B1 | **Hard-coded upload-session signing secret. Live on Render** through `/public/v1/upload/:token`. Local storage and magic-byte scan only | `document-sharing-service.ts` lines 30, 52, 66; `app.ts` line 132 | Security owner and developer | Decide now: switch the public sharing router off, or fix it. Then move the secret to an environment variable and rotate it. History is not rewritten without approval |
| B2 | **Gateway signing key (AUD-P0-03)** was in source and is in history. Not rotated | `docs/AUDIT_REPORT_2026-10-26.md` (redacted); commits `912a261`, `4000af4`, `71613d7` | Security owner | Rotation at every consumer, per `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md` |
| B3 | **Second factor off in production, live.** Payout and approval step-ups are not enforced | Render `/public/v1/auth/config` | Security owner | Section 6: enrol the 20 users who hold an MFA-required role, confirm TOTP in Supabase, set `true` |
| B4 | **Documents may be lost on redeploy.** 13 origination documents and 2 sharing rows; bytes location unknown; `DOCUMENT_STORE` unverified | Section 5 | Operations and developer | Confirm where the bytes are before any redeploy. Configure S3 and migrate |
| B5 | **Sharing path ignores `DOCUMENT_STORE`** and `CLAMAV_ADDRESS` | `document-sharing-service.ts` lines 38 to 41; `router.ts` line 165 | Developer | Route through the configured backends, or keep the sharing router off |
| B6 | **Served frontend carries the test-login variable name** | Served bundle; `apps/web/.env.local` | Developer | Remove `VITE_TEST_BYPASS_OTP` from Vercel. Rebuild from the release commit. Check the bundle |
| B7 | **Migration ledger absent.** The CLI cannot reconcile; `db push` is unsafe | Section 3, A2 | Hosted-database owner | Section 11, with approval |
| B8 | **Vercel production branch** may be `main`, which is behind `beta` | Section 9 | Owner | Decide the branch before any Vercel deploy |
| B9 | **Vercel root and build setting** conflict between `docs/DEPLOYMENT.md` and `vercel.json` | Section 9 | Owner | Confirm one |
| B10 | **Backups** are not encrypted, lack the `auth` schema, and inherit broad access | Section 4 | Owner | Recommendations 1 to 4 in section 4 |
| B11 | **Connector consent (AUD-P1-07)** has no product path for verification or activation | `docs/CONNECTOR_VERIFICATION_DECISION.md` | Compliance owner | Choose Option A, B, C or D |

### Risks (accept, schedule, or fix before go-live)

| # | Risk | Reference |
|---|---|---|
| R1 | Possible fabricated payments on hosted: payouts marked `PAYMENT_RECORDED` with a `CMS` reference, and connectors set ACTIVE through the old status route. **Not checked in this audit.** The owner must run the read-only checks in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md` Step 2 against bank statements | AUD-P0-01, AUD-P0-02 |
| R2 | Manual payment recording accepts a staff-typed reference with no bank verification | AUD-P1-10 |
| R3 | Payout requests not tied to an approved bank account | AUD-P1-02 |
| R4 | The consent OTP is never delivered; the code is stored only as a hash | AUD-P1-01 |
| R5 | Connector approvals do not require step-up (bank accounts, attribution, status, dispute resolution) | AUD-P1-08 |
| R6 | Rate card and commission are separate; a partner may see a rate that is not the one paid | AUD-P1-06 |
| R7 | Connector scope enforced in application code only | AUD-P2-05 |
| R8 | Signed document links are bearer links; lifetime and single use not reviewed | AUD-P2-06 |
| R9 | Stale rehearsal test model: fresh-to-hosted order not proven by CI | AUD-P1-09 |
| R10 | Bhushan's 18 deletions are unconfirmed on `beta` (readiness reports, a backup spreadsheet, a seed script, `pnpm-lock.yaml`) | `76010cf`, `ea987c0` |
| R11 | Restore test is a local emulation, not a Supabase scratch restore | Section 4 |
| R12 | Render auto-deploy for `beta` is paused. The owner confirmed it; the dashboard was not re-checked here | Section 1 |
| R13 | Playwright e2e and browser checks not run | Section 1 |
| R14 | `localhost:9999` literal in the served bundle, source not traced | Section 7 |
| R15 | `dsa_api` has one session idle in transaction | Section 3 |
| R16 | Auth users (21) and app users (22) differ by one; not investigated | Section 6 |
| R17 | Lint: one pre-existing error in `e2e/helpers/mock-session.ts` | Section 1 |

### Verified in this audit

- Render `/health` returns 200 with `{"status":"ok"}`.
- Render `/public/v1/auth/config` returns `{"mfaEnabled":false}`.
- Render `/public/v1/auth/test-users` returns 404 (test login is off).
- Render `/public/v1/upload/:token` is live (a bogus token returns a structured 404).
- Hosted: the test-login SQL functions are absent.
- Hosted: the API connects as `dsa_api`.
- Hosted: migrations 0098 to 0102 applied; the 144 migration tables are present; markers for 0065, 0100 and 0101 pass; snapshots match.
- Served Vercel bundle: Render API host present; no `service_role`; no secret-shaped key; one `anon` JWT and one publishable key.
- Backup files exist with the hashes above; none is inside the repository; no secret-shaped content found in them.

## 13. Approvals needed

| Approval | Owner |
|---|---|
| Disable or fix the public upload router (B1), and remove the literal from source | Security owner and developer |
| Rotate the upload-session secret and the gateway key (B1, B2) | Security owner |
| `SUPABASE_MFA_ENABLED=true`, with the enrolment plan (B3) | Security owner |
| `DOCUMENT_STORE=s3`, provider choice, and migration of existing bytes (B4, B5) | Operations and developer |
| Ledger reconciliation (B7, section 11) | Hosted-database owner and security owner |
| Vercel production branch and root setting (B8, B9) | Owner |
| Connector consent option (B11) | Compliance owner |
| Restore or keep Bhushan's deletions (R10) | Author of `76010cf`, and owner |
| Encryption, access and retention for the backups (B10) | Owner |

## 14. Not done in this audit

- No deployment, no Render or Vercel change, no environment-variable change.
- No hosted write, delete, migration, ledger change, or role drop. The cleanup SQL is for review only.
- No key or secret rotation, and no history rewrite.
- No commit or push.
- No browser or e2e run.
- The R1 hosted data check (section 12) was not run. It needs the owner.
- Hosted TOTP configuration in the Supabase dashboard was not checked (section 6).
- The Render dashboard values were not checked. Anything marked "not visible" depends on the dashboard.
- The sharing router was not exercised with a valid token. No attempt was made to forge or replay a token.
