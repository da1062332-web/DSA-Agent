# DSA CRM — Principal Engineer and Security Audit Report

| | |
|---|---|
| **Date** | 2026-10-26 |
| **Repository state** | branch `beta` @ `c476d02`, plus the uncommitted working tree (12 modified files, 6 untracked) |
| **Prior audit baseline** | 2026-10-19 @ `4e1c3ca` (277 commits ago) |
| **Method** | Static review of the highest-risk files, repository-wide pattern scans, a dynamic zero-permission probe of all 417 `/v1` routes, executed gates (typecheck, lint, unit tests, `npm audit`), and three runnable reproductions |
| **Code modified by this audit** | None. This report is the only file added. It is untracked and uncommitted. |

---

## 0. How to read this report

**"Verified"** means I observed it by running something or by reading the exact lines cited. **"Potential"** means the code pattern is there but I could not complete the proof (for example, it needs a database or a hosted project I did not touch). Nothing here is claimed on the strength of a comment or a name.

**What this audit is not.** You asked for a line-by-line review of every file. That is about 215,000 lines (API 72k, web 70k, tests 50k+, migrations 7k, tools/e2e/seeds 16k, packages 12k). I did not read every line, and no report from a single session honestly could. Section 9 lists exactly what was read in full, what was covered only by tooling, and what was not covered. Treat the coverage claims in this report as bounded by that section.

---

## 1. Executive summary

**Verdict: not ready for even an internal pilot.** The core product is broad and, in most places, well built. The defects that stop a release are concentrated in authentication, secrets handling and a few public endpoints, and they were introduced recently.

**What is solid (verified):**

- Row-level security is on and forced for **139 of 142** tables (the 3 exceptions are global registries). Tenancy comes only from the token. Audit and outbox rows are written in the caller's transaction.
- Of 417 `/v1` routes, **302 refuse a user with no permissions (403/401) before touching data**, and every one of the 417 is now documented in OpenAPI (the 10-19 audit found 177 undocumented).
- Merged migrations are immutable against the lock file (77 files checked).
- Unit tests: **1,504 of 1,505 pass** across six workspaces. Typecheck passes for API, web, kernel, contracts and bre-core.
- Several security-sensitive flows are implemented correctly, for example the connector-portal consent OTP, inbound webhook HMAC verification, and signed document links.
- The Notion spec for MOD-LEAD is met 13 of 13 endpoints (sampled; see section 9).

**What blocks release (4 Critical, 9 High):**

1. **Anyone on the internet can log in as any user without a password, with MFA satisfied** (AUD-001). Enter an email and `000000`. The endpoint is not gated by environment, and the web login page falls back to it when the real password check fails.
2. **Anyone can forge a valid, MFA-satisfied access token** (AUD-002). The token verifier accepts a secret hardcoded in source in every environment. I reproduced this.
3. **The production `service_role` key is in git history and was never rotated** (AUD-003). The key committed in `c4c263f` is byte-identical to the live key in `apps/api/.env`.
4. **A new untracked script embeds a `postgres` superuser pooler credential and the same `service_role` key** (AUD-004), and it reuses the API's own database password for a different role.
5. The upload-link OTP lockout **never persists** (AUD-005, reproduced), the upload session is signed with a hardcoded key (AUD-006), messaging webhook signatures are **never verified** (AUD-007), and the browser writes KYC documents straight into a shared storage bucket with no tenant prefix (AUD-008).
6. A payout "gateway" that always succeeds with a fabricated bank reference is wired into a production route (AUD-009).

**Evidence-weighted completion: about 63% (plausible range 55–70%).** This is a judgement formula, not a measurement; the rubric is in section 8. I am not claiming more because integration tests, the tenant-isolation suite, and the Playwright journeys either could not run or do not exercise the real stack.

**Counts:** Critical 4 · High 9 · Medium 16 · Low 9. Each has an ID below.

**Do these first (today):** rotate the `service_role` key and database passwords (AUD-003/004); remove the test-login bypass, its migration functions and the hardcoded secrets (AUD-001/002); then fix AUD-005 to AUD-009. Section 7 has the full plan.

---

## 2. Verification status

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | **FAIL** (1 error) | `tools/feed-notion-real-data.ts(237,36) TS2532` — an untracked file. API, web, kernel, contracts, bre-core pass. |
| `npm run lint` | **FAIL** (3 errors, 962 warnings) | Errors are in uncommitted e2e files: `e2e/07-sales-executive.spec.ts:132,133` (`prefer-const`), `e2e/helpers/mock-session.ts:1435` (`no-empty`). Warnings are mostly `no-explicit-any`. |
| Unit tests (`npm test`) | **1,504 / 1,505 pass** | API 984/985, web 395, contracts 78, bre-core 19, kernel 21, tools 7. The one failure is `TEST-SECRETS-01` (below). |
| `TEST-SECRETS-01` (repo's own secret scanner) | **FAIL** | Finds a database URL with password (`tools/feed-notion-real-data.ts:26`) and a JWT (`:30`). The scanner is working; the code is wrong. |
| Migration immutability (`check-migrations-immutable`) | PASS | 77 files match the lock. |
| OpenAPI drift (regenerated to a scratch path, then diffed) | **DRIFT** (24 diff lines) | Date defaults are baked in at generation time, a notification id pattern changed without regeneration, and one anchor changed. CI "fail on diff" would trip. |
| Route authorization probe (417 routes, zero-grant user, empty DB) | 302 guarded · 73 validated first · 23 open 2xx · 19 other | Section 4. |
| Static route scan (434 registrations) | 185 direct authz · 145 delegated · 104 not found | Used to triage the 73 "validated first" routes. |
| RLS scan of 77 migrations | 139/142 tables | Exceptions: `permission`, `decision_definition`, `decision_dependency` (global catalogues). |
| `npm audit` | 2 critical, 7 high, 11 moderate | Section 5, AUD-026. |
| **Not run: integration tests** (73 files, Testcontainers) | — | **Docker is not running on this machine.** |
| **Not run: tenant-isolation suite** (`tests/isolation`) | — | Needs Docker; the repo notes it takes about 23 minutes. |
| **Not run: `db:verify` / local Supabase** | — | Needs Docker. |
| **Not run: Playwright e2e** (17 specs) | — | All but one use mocked API routes anyway (AUD-024). |
| **No line coverage available** | — | `@vitest/coverage-v8` is not installed. I cannot give a coverage percentage and have not invented one. |

---

## 3. Critical findings

### AUD-001 — Password-less, MFA-bypassing login for any user (Critical, Verified)

**Where**
- `apps/api/src/http/public-auth-router.ts:24-63` (`GET /public/v1/auth/test-users`) and `:66-157` (`POST /public/v1/auth/test-login`)
- Mounted unconditionally: `apps/api/src/app.ts:131-138`
- Defaults: `apps/api/src/config.ts:55-58` (`TEST_BYPASS_OTP` default `000000`)
- Database functions: `supabase/migrations/20261001000086_test_auth_bypass.sql` (`SECURITY DEFINER`, granted to `dsa_app`)
- Web: `apps/web/src/auth/LoginPage.tsx:87-110` (falls back to test-login when the Supabase password check fails), `:140-215`; `MfaPage.tsx:91-118`; `StepUpProvider.tsx:66-90` (uncommitted); `supabase.ts:56-91`; `totp.ts:93-103`
- Introduced in `6191a1e` (2026-10-22), extended through `a33b37a`.

**Expected.** Authentication goes through Supabase Auth with a password and a TOTP factor. Test shortcuts exist only against a local stack (the code already has this rule for `DISABLE_MFA` and `TEST_TOKENS` in `config.ts:68-93`). The project's own `e2e/LIVE-SETUP.md:108` says the same: the bypass "is acceptable on this machine only. `TEST_BYPASS_OTP` must not be set on any hosted environment." That control cannot work, because the code defaults the OTP to `000000` when the variable is **absent**; leaving it unset turns the bypass on.

**Actual.**
1. `POST /public/v1/auth/test-login` takes `{ email, otp }`. If `otp` equals `TEST_BYPASS_OTP` (default `000000`) it looks the user up across **all tenants** through `app.lookup_test_user` and returns a signed access token with `aal: 'aal2'`, a fresh TOTP `amr` entry, and a **24-hour** lifetime (`:126-134`). It checks the user and tenant are `ACTIVE`, and nothing else. There is no `NODE_ENV` check anywhere.
2. `GET /public/v1/auth/test-users` returns every active user in every tenant (id, email, display name, tenant id, role code, role name, branch) to an unauthenticated caller.
3. The login page treats a **failed password** as a reason to try test-login (`LoginPage.tsx:87-110`). If the email exists, it opens the MFA modal, and `000000` completes the login. The password is never checked.
4. Step-up (`requireStepUp`) is satisfied by the minted token, so rule approval, payout dispatch and secret rotation are reachable too.
5. `lookup_test_user` has no tenant filter, so it would also return a **platform-realm** user if one exists in `app_user`. I did not confirm that on a database.

**Evidence.** `apps/api/test/public-auth.spec.ts` (passes) exercises exactly this and asserts success. Behaviour on a real database: the function selects by email or id with no tenant filter (migration 86, lines 17-24).

**Reproduce (against a deployed API with a real database).**
```
curl -s https://<api>/public/v1/auth/test-users            # every active user, all tenants
curl -s -X POST https://<api>/public/v1/auth/test-login \
  -H 'content-type: application/json' -d '{"email":"<any listed email>","otp":"000000"}'
# -> { data: { access_token: ... aal2 ... } }  usable on /v1/* and /platform/v1/*
```

**Also wrong in the web code.** `totp.ts:94` returns success for the bypass code or any bypass session, and `:99` treats any error matching "invalid JWT/signature is invalid" as a pass. The saved bypass session is written to `localStorage` (`supabase.ts:60-62`), so a stolen 24-hour aal2 token is a stolen account. The bypass code is also baked into the production bundle (`VITE_TEST_BYPASS_OTP` default in five places).

**Fix.**
- Delete the router, both migration-86 functions (new migration `DROP FUNCTION`), and every web reference. Do not gate it; remove it.
- For tests, use `mintTestToken` (already refuses non-local URLs) or Supabase local with a seeded TOTP factor. Re-point the e2e personas to that.
- Add a regression test that the app exposes **no** route under `/public/v1/auth/*`.

### AUD-002 — Anyone can forge a valid access token (Critical, Verified by reproduction)

**Where.** `packages/kernel/src/auth/verify-token.ts:55-56` and `:65-69`; `apps/api/src/config.ts:58`; `apps/api/src/app.ts:135`.

**Expected.** HS256 tokens are accepted only when the operator configured `SUPABASE_JWT_SECRET` (the file header says so, line 3), and never for a hosted project.

**Actual.** The verifier always appends a second HS256 secret, defaulting to the literal `dsa-crm-test-bypass-jwt-secret-key-2026`, and tries it on every HS256 token. `config.ts` defaults `BYPASS_JWT_SECRET` to the same literal. Anyone with read access to the source (or this repository's history) can sign a token for any tenant and any subject.

**Reproduced.** I signed a token with that literal and ran it through `createTokenVerifier` configured as a production verifier (some other Supabase URL, no JWT secret, no bypass secret). The verifier accepted it and returned `tenantId`, `aal: 'aal2'`, a current TOTP time and the email I put in. Script: `…\scratchpad\forge-repro.mts` (path in section 9).

**Consequence beyond access.** `resolve-principal.ts:53-69` binds an `INVITED` user to whatever `sub` arrives with a matching `email`, so a forged token can also **take over an invited account**.

**Fix.** Remove the bypass secret from the verifier and from config. Make `SUPABASE_JWT_SECRET` the only HS256 secret, required to be absent in production. Also drop the hardcoded issuer list (AUD-018).

### AUD-003 — Production `service_role` key committed and never rotated (Critical, Verified)

**Where.** Commit `c4c263f`, file `apps/api/test/e2e_all_modules.ts` (removed from the tree later, still in history). The commit is reachable from `origin/akash`, `origin/piyush` and `origin/samarth`.

**Evidence.** I compared SHA-256 fingerprints without printing the key: the `service_role` JWT in that commit (fingerprint `12740ab516d7`) is **identical** to the one in the current, git-ignored `apps/api/.env`. It carries role `service_role`, project ref `mlpkwwhnagxzinaohdxg`, expiry 2107183796 (about 2036). The 10-16 audit flagged this; it was never rotated.

**Impact.** The key bypasses RLS and can administer Supabase Auth for the hosted project. Anyone who has ever cloned the repository can use it.

**Fix.** Rotate in Supabase (JWT secret / new API keys), update `.env` everywhere it is used, then rewrite history on the three branches (`git filter-repo`) or treat the repository as compromised. Rotation is mandatory; history rewriting alone is not enough.

### AUD-004 — Untracked script embeds superuser credentials (Critical, Verified)

**Where.** `tools/feed-notion-real-data.ts:25-31` (untracked, **not git-ignored**; `git status` shows `??`).

**Actual.**
- Line 25-26: a fallback `DATABASE_URL` for role `postgres.<ref>` on the hosted pooler, **with its password**.
- Line 29-30: the same `service_role` JWT as AUD-003 as a fallback value.
- Line 61: it sets every demo user's Supabase password to the fixed string `DemoPassword123!` on the shared hosted project, including `admin@alpha.com` and `owner@alpha.com`.
- I compared the password in the script to the `dsa_api` password in `apps/api/.env`: they are **the same string**. Either the `postgres` superuser and the API role share one password, or the script carries a password that is wrong for its role. If the first is true, `ADR-SB-03` (the API never connects with superuser rights) is defeated in practice, because whoever holds the API's secret holds the superuser's.
- It inserts `mobile_hash` as plain SHA-256 (`:164, :204, :225`), not the app's tenant HMAC, so these rows will not match duplicate detection.

**Impact.** One `git add .` publishes superuser access. It already fails the repository's own test (section 2) and typecheck.

**Fix.** Delete the fallbacks and read from the environment only. Rotate both passwords (AUD-003). Give the two roles different passwords. Seed demo users through Supabase local, not by overwriting passwords on a shared hosted project.

---

## 4. High findings

### AUD-005 — Upload-link OTP lockout never takes effect (High, Verified by reproduction)

**Where.** `apps/api/src/modules/origination/document-sharing/document-sharing-service.ts:486-508`; OTP generation `:146`.

**Expected.** Five wrong codes lock the link (the error text and docs promise this).

**Actual.** The failed-attempt `UPDATE` runs inside `withTenantTx` and is followed by `throw AppError…`. The transaction callback throws, so Kysely rolls the transaction back and the counter is discarded. The response always says "4 attempts remaining".

**Reproduced.** I ran the real `verifyUploadOtp` against a recording driver. Output: `BEGIN … UPDATE app.upload_link SET failed_attempts … ROLLBACK … VALIDATION_ERROR: Incorrect verification code. 4 attempts remaining.` Script: `…\scratchpad\otp-repro.mts`.

**Impact.** The 6-digit OTP (900,000 values, valid 10 minutes) can be guessed, limited only by the per-IP rate limit (AUD-016), which behind a proxy is shared. The OTP is also created with `Math.random()` (`:146`), which is not a secure random source; `connector-portal.ts:150` shows the right call (`crypto.randomInt`).

**Fix.** Persist the counter and then respond: update in one transaction, commit, and return the error afterwards (the connector portal returns `{ status: 'INCORRECT' }` and does this correctly at `connector-portal.ts:181-184`). Use `crypto.randomInt`, salt the stored hash, and compare in constant time. Add a test that runs against a real transaction, because the existing mock-based tests cannot see a rollback.

### AUD-006 — Hardcoded upload-session key; the link token is never re-checked (High, Verified)

**Where.** `document-sharing-service.ts:30` (`SESSION_SECRET = 'dsa_upload_session_signing_secret_2026'`), `:49-80`, `:550-570`, `:612-617`, `:642-649`.

**Actual.**
1. The session token is an HMAC over `linkId:tenantId:expiry` with a key in source. Anyone who knows or guesses a link id and tenant id can mint one and skip the OTP step.
2. `uploadPublicFile(rawToken, sessionToken, …)` ignores `rawToken`; it trusts only the session token.
3. The upload accepts any `checklistItemId` when the link has no item list (`link.items.length === 0`) and also a hardcoded list `chk_pan_card, chk_bank_statement, …` (`:615`). The `UPDATE checklist_item` at `:642-649` filters by tenant and item id but **not by the link's application**, so a link for application A can mark an item of application B as `SUBMITTED` with its document.
4. The file is written to storage (`:570`) before the link's validity is checked in the transaction, leaving orphan files for every rejected request.

**Fix.** Sign with `documentLinkSecret` (already required in production). Re-resolve the link from the raw token on every call. Constrain the item to `link.application_id` and the link's item list. Check validity before writing to storage.

### AUD-007 — Messaging webhook signature is never verified (High, Verified)

**Where.** `apps/api/src/modules/crm/messaging/messaging-service.ts:943-981` (check at `:959-961`); router `crm/messaging/router.ts:161-176`.

**Actual.** The code only requires that an `X-Provider-Signature` header **exists** when the connection has a secret. No HMAC is computed or compared (a search for `hmac`/`createHmac` in the messaging module finds nothing). If the connection has no secret, no header is needed at all. A caller who knows a `connectionPathId` can mark any message DELIVERED or FAILED. The sibling `integrations/inbound-webhooks.ts` shows the correct pattern (timestamp window, HMAC over raw body, constant-time compare, replay guard).

**Fix.** Reuse `verifyInboundSignature`. Refuse connections that have no secret.

### AUD-008 — Browser writes documents straight to a shared storage bucket (High, Verified in code; bucket policy not inspected)

**Where.** `apps/web/src/features/documents/api.ts:91-106, 153-218`; `apps/web/src/auth/supabase.ts:26-43`; commit `6f9031a` (2026-10-24).

**Expected.** `CLAUDE.md`: "The browser uses `supabase-js` for `auth.*` only; all data goes through the Express API." Documents go through upload intents, size/hash checks and a scan (the API path in the same file does this correctly).

**Actual.** `uploadChecklistDocument` first **mirrors every checklist upload** to bucket `Media` at `Documents/<checklistItemId>_<fileName>` with `upsert: true`, then runs the API flow. There is no tenant prefix, so two tenants' files share a namespace and can overwrite each other. `listSupabaseStorageFiles` lists the whole `Documents/` folder. For bypass sessions the code deliberately switches to an **unauthenticated anon-key client** to make uploads work, which implies the bucket accepts anon writes. No storage policy SQL exists in the repository, so I cannot tell you what the bucket allows, and neither can the repository. The mirrored files skip the scan, the consent check, the audit event and the S3-data rules.

**Fix.** Remove the direct path. If Supabase Storage is wanted as the file store, call it from the API with a service credential, keyed by `tenant/<id>/…`, behind signed URLs the API issues. Check the live bucket now and make it private.

### AUD-009 — A payment "gateway" that always succeeds is wired into production (High, Verified)

**Where.** `apps/api/src/modules/finance/payment-gateway.ts:36-77`; `finance-service.ts:1113-1192`; route `finance/router.ts:703-717` (`POST /v1/payout-batches/:id/dispatch-gateway`).

**Actual.**
- `disburse()` makes no external call. It fabricates a UTR (`CMS<date><mode><random>`), a transfer id and a "bank acknowledgement signature" using the literal key `BANK_GW_SECRET_INTEGRATION_KEY` (`:62`), and returns `SUCCESS`. The caller then records `PAYMENT_RECORDED` with that fake UTR (`finance-service.ts:1141`). There is no environment guard and no "simulated" marker in the response.
- No row lock on the batch or payout (`findPayoutRequestById` has no `FOR UPDATE`), no idempotency key, and no state check on the batch. Two concurrent dispatches can both read `APPROVED`.
- The gateway call sits inside the database transaction (a real gateway call would be a dual write).
- Amounts are summed as JavaScript numbers (`Number(res.amount)`, `Math.round(total*100)/100`), against the rule that money is a string.

**Impact.** A user with `payout.record_payment` plus step-up can mark commission payouts paid with an invented bank reference. In a finance product that is a falsified ledger entry.

**Fix.** Remove the route until a real adapter exists, or make the adapter refuse unless `NODE_ENV !== 'production'`. When real: lock rows, require `Idempotency-Key`, pass it to the gateway, record intent in one transaction and confirmation in another, and use decimal arithmetic.

### AUD-010 — Default cryptographic keys in source for hashing and encryption (High when real data arrives, Verified)

| File:line | Used for | Fallback |
|---|---|---|
| `crm/customers/normalizer.ts:5`, `crm/leads/normalizer.ts:5` | tenant HMAC of mobile numbers (duplicate matching) | `dsa_mobile_hmac_default_secret_key_32` |
| `finance/crypto.ts:5-6` | AES-256-GCM of payment references (UTR, account numbers) | `dsa-crm-default-finance-key-32b!` |
| `origination/connectors/connector-service.ts:34-38` | blind indexes and encryption of connector PAN, mobile, email | `dev_dsa_hmac_secret_key_32_bytes_long!!`, `dev_dsa_encryption_key_32_bytes!` |
| `reconciliation/crypto.ts:4` | loan-account hashing | `dsa_reconciliation_salt_2026` |
| `finance/payment-gateway.ts:62` | gateway signature | `BANK_GW_SECRET_INTEGRATION_KEY` |

`config.ts` validates none of these variables, so production starts happily with the defaults. A mobile-number HMAC with a known key is trivially reversible (10-digit space). **Fix:** add all of them to `EnvSchema`, required and at least 32 characters in production, and remove the literals.

### AUD-011 — Step-up can be skipped on API-client secret rotation (High, Verified)

**Where.** `apps/api/src/modules/partner-api/router.ts:323-343`.

**Actual.** The spec path `POST /api-clients/:id/rotation` calls `requireStepUp` (my probe got `401 STEP_UP_REQUIRED`), but the legacy alias `POST /api-clients/:id/rotate-secret` ("kept for existing callers") calls the same `rotateClientSecret` with **no step-up** (my probe got `403 FORBIDDEN`, i.e. permission only). A user with `api.manage` rotates a credential with a password-only session.

**Fix.** Delete the alias, or require step-up in `PartnerApiService.rotateClientSecret` so every path inherits it.

### AUD-012 — Partner API-key authentication cannot work in production, and its design is unsafe (High for function, Medium for security; Verified by code path)

**Where.** `partner-api/router.ts:60-77`, `auth-middleware.ts:119-185`, `service.ts:159-190`, `packages/contracts/src/partner-api.ts:17`.

- The partner routes live under `/v1/partner`. `/v1` is mounted behind `supabaseAuth` (`app.ts:168-175`), which rejects any request without a JWT-shaped bearer token before the API-key middleware runs. A partner using `X-API-Key` or `Bearer dsa_live_…` gets `401`. The partner API is unreachable by its intended clients.
- Keys are held in `InMemoryApiKeyStore` because production wiring never passes `db` (`router.ts:66`), so they vanish on restart and differ per instance. A separate, database-backed `api_client` store exists, so there are two unrelated credential systems.
- `CreateApiKeySchema.scopes` is `z.array(z.string())` (contracts `:17`): any string is accepted and later cast to a `PermissionCode` at TENANT scope (`auth-middleware.ts:170`). A holder of `api.manage` **or `config.manage`** (`service.ts:161`) can mint a key with `user.manage` or `rule.approve`.
- The IP allowlist uses substring matching: `clientIp.includes(ip)` (`auth-middleware.ts:163`), so allowing `10.0.0.1` also allows `110.0.0.12`.

**Fix.** Decide the partner auth model. Mount partner routes before the Supabase gate with their own authentication, persist keys, validate scopes against an allow-list of partner scopes, and compare IPs exactly.

### AUD-013 — Production persistence is local disk or process memory (High for pilot readiness, Verified)

`origination/applications/documents.ts:97` (`LocalDocumentObjectStore`, default `./uploads/documents-v2`), `document-sharing-service.ts:41` (`LocalDocumentStorage`), `storage/object-storage.ts:141` (imports/exports under `./uploads/storage`), `finance/finance-service.ts:104` (`InMemoryFinancialStorage` for payout files), `partner-api/router.ts:66` (API keys). On any container platform the first redeploy deletes customer KYC documents, import batches and payout files, and with two instances each sees a different set. `wiring.ts` never supplies a `documentStore`. Customer documents are also stored unencrypted on disk (only archives are sealed, `documents.ts:953`).

**Fix.** Implement an object-store port against Supabase Storage or S3 behind the API, with per-tenant keys and server-side encryption, and wire it in `wiring.ts`.

---

## 5. Medium findings

| ID | Finding | Where | Status |
|---|---|---|---|
| **AUD-014** | **Migration 87 grants `ALL` to `anon`, `authenticated`, `service_role` and `dsa_app`** on every table, routine and sequence in `public`, plus default privileges, and creates a `public` view over every `app` table. Today `anon` and `authenticated` cannot read the views because migration 0 revoked their `USAGE` on schema `app` (`…0000_roles_and_helpers.sql:15-16`), so no data leaks, but the isolation model now rests on one revoke that nothing re-checks. `GRANT ALL ON ALL ROUTINES … TO anon` hands `EXECUTE` on any function later placed in `public`. Views cover only tables that exist today. Not listed in `supabase/MANIFEST.md` or `docs/MIGRATION_MATRIX.md`. Commit `6f9031a`. | `20261001000087_expose_app_in_public.sql:18-25` | Verified |
| **AUD-015** | **`SECURITY DEFINER` function takes the tenant and approver from the caller.** `app.apply_attribution_change(p_tenant_id, p_change_request_id, p_approver_id)` runs with owner rights, trusts both parameters, does not check `app_tenant()`, has no pinned `search_path`, and is executable by `dsa_app`. Any SQL-level access as `dsa_api` can change any tenant's lead attribution and name any approver, defeating RLS and SOD-09 (the check compares against a caller-supplied id). | `…0027_connectors.sql:249-299`; caller `connector-service.ts:1199` | Verified |
| **AUD-016** | **Rate limiting is weak where it matters.** `req.ip` is the key but `trust proxy` is never set (zero occurrences), so behind a load balancer every public caller shares one bucket. Auth runs before the limiter on `/v1`, so unauthenticated floods are not throttled. The public JSON limit is 25 MB (`app.ts:118-125`) and raw uploads 52 MB (`documents.ts:828`), parsed before the token is checked. | `http/rate-limit.ts:27-30`, `app.ts:115-125,168-175` | Verified |
| **AUD-017** | **Audit redaction deletes legitimate fields.** The key pattern matches substrings, so `pincode`, `mapping`, `companyName`, `authorUserId`, `authorizedBy`, `shipping`, `panel`, `tokenCount` are all replaced with `[REDACTED]` in audit before/after (I ran the regex over sample keys). The audit trail loses who authorized and what changed. | `packages/kernel/src/audit/audit.ts:7-8,35-38` | Verified |
| **AUD-018** | **Hosted-project issuer and defaults baked into code.** The verifier accepts tokens from the hosted project and from `127.0.0.1:54321` and `localhost:54321` whatever `SUPABASE_URL` says; `app.ts:134` defaults the Supabase URL to the hosted project. A production deploy for another project would still trust tokens from the dev project. | `verify-token.ts:45-52`, `app.ts:134` | Verified |
| **AUD-019** | **Free-text S3 rule is applied in about 10 modules, not all, and copied by hand.** The PAN/Aadhaar/9-18-digit check exists in leads, customers, grievances, applications, catalogue, platform, compliance, automation, connector-portal and activities, but not in tasks (`crm/tasks/types.ts:84-88` title; `:138` `completionNote`; `tags`), lender cases, sanctions, verification notes, messaging, reconciliation disputes, invoices, payouts, workforce, targets, security. The same regex is pasted into at least 8 files. | multiple | Verified for tasks; others Potential |
| **AUD-020** | **S3-class data is present despite the MVP rule.** Connector onboarding requires a PAN (`contracts/connector.ts:72`) and bank account numbers (`:153`); finance encrypts UTR and account numbers; reconciliation hashes loan accounts; document types `PAN_CARD`, `AADHAAR_MASKED`, `BANK_STATEMENT` are marked S3 (`documents.ts:61-65`). `CLAUDE.md` says none of this belongs in the MVP and the pilot is "synthetic data only". Either the rule or the code needs updating; combined with AUD-010 and AUD-013 the code is not safe to hold real values. | listed | Verified |
| **AUD-021** | **Access token accepted in the query string.** `?token=` and `?access_token=` are read as credentials (`http/supabase-auth.ts:17-22`). Tokens in URLs leak through proxies, browser history and referrers. No client in the repo uses them. | | Verified |
| **AUD-022** | **Ten routers re-implement `requirePermission`/`requireStepUp`**, each with its own `kind === 'SERVICE'` early return (15 occurrences). `rules/api/router.ts:95-105` also reads `process.env.DISABLE_MFA` directly and uses `Date.now()` rather than `ctx.now`, unlike `kernel/authz.ts:73-79`. Divergence is how AUD-011 happened. | `platform/router.ts:61-77`, `rules/api/router.ts:77-105`, `automation/router.ts:33`, `verification/router.ts:36-52`, `crm/*/authz-helper.ts`, `catalogue/{lenders,products,contacts}.ts` | Verified |
| **AUD-023** | **Org and directory reads have no permission gate, including for external connector users.** 23 routes answer 2xx to a user with no grants: `/branches`, `/teams`, `/org-chart`, `/work-queues`, `/users` (picker view), `/settings/effective`, `/labels`, `/calendars`, `/picklists/:c`, `/lenders`, `/products`, `/document-types`, `/integrations/capabilities`, `/workforce/agents`, `/delegations`, `/attendance*`, `/notifications*`, `/partner/sandbox/echo`. Most are reference data and plausibly intended; `/workforce/agents` and `/delegations` show who is on leave and who covers whom (`workforce/service.ts:108,209` have no check). A `CONNECTOR` user holds a normal `/v1` token and can call all of them. | see list | Verified (probe) |
| **AUD-024** | **Misleading test evidence.** `e2e/17-notion-golden-path-real-db.spec.ts` is named "real DB" but stubs `/v1/leads`, `/v1/applications`, `/v1/lender-cases`, `/v1/commission` with `page.route` (lines 107-598). Three persona sets are maintained by hand in `e2e/helpers/mock-session.ts` (lines 17, 300, 634). The live e2e setup depends on the AUD-001 bypass (`e2e/LIVE-SETUP.md:36-37,108`). `playwright.config.ts` timeout went from 180 s to 600 s. | | Verified |
| **AUD-025** | **Idempotency not enforced on several money-moving POSTs.** `POST /ledger/journals` makes the key optional (`ledger/router.ts:109-112`); `finance-service.ts` never references idempotency (clawbacks, commission plans, payout dispatch, invoices). 112 of 198 POST handlers show no idempotency handling in the handler text. The service layer may cover some; the spec's "Idem" marker list was not cross-checked. | | Potential |
| **AUD-026** | **Dependency advisories** (`npm audit`: 2 critical, 7 high, 11 moderate). Runtime-relevant: `kysely@0.27.6` (JSON-path injection and `sql.lit` advisories; the codebase uses `Kysely<Database>` where `Database` is `{}`, which is the "untyped" case the advisory names); `body-parser` 2.0–2.3 (request-body DoS); `zod@3.25.76` (memory exhaustion on oversized collections); `undici` (transitive). Dev-only but critical: `vitest`, `tinypool`; `vite` has Windows `server.fs.deny` bypass. | `package-lock.json` | Verified |
| **AUD-027** | **Quality gates are red**, so a normal CI run would fail: typecheck (1 error), lint (3 errors), `TEST-SECRETS-01`, and OpenAPI regeneration drift. Two contract schemas call `new Date()` inside a default (`contracts/commission.ts:93`, `payouts.ts:88`), so the spec embeds the day it was generated and drifts every day. | section 2 | Verified |
| **AUD-028** | **Principal lookup is ambiguous.** `resolve-principal.ts:49-51` matches a user by subject, or internal id, or email, with no `ORDER BY`; two matching rows in a tenant would resolve to an arbitrary one. | `packages/kernel/src/auth/resolve-principal.ts:51-52` | Potential |
| **AUD-029** | **Email and OTP are logged at HEAD.** The committed `public-auth-router.ts:73` logs `Received login request for email: "…", otp: "…"`. The working tree removes it, uncommitted. `CLAUDE.md` forbids logging emails and tokens. | `git diff` | Verified |

---

## 6. Low findings

| ID | Finding | Where |
|---|---|---|
| AUD-030 | `GET /me` wraps its database read in `try { … } catch { // tx fallback }`, so on a database failure it returns **200** with empty email, roles and preferences, which the UI then renders as a valid identity. | `platform/router.ts:140-173` |
| AUD-031 | `POST /partner/sandbox/echo` reflects `req.headers` back, including `Authorization`. | `partner-api/router.ts:247` |
| AUD-032 | Swagger UI and the spec are public at `/docs`, `/api-docs`, `/swagger`, `/openapi.json`; Helmet's CSP is turned off globally. | `app.ts:58,106-112` |
| AUD-033 | Public OTP stored as unsalted SHA-256 and compared with `===`. | `document-sharing-service.ts:45-47,488` |
| AUD-034 | 18 ad-hoc database scripts under `apps/api/scratch/` and one in `scratch/` are tracked (permission grants, schedule fixes). They change the hosted schema outside the migration process. `.xlsx` test workbooks sit in the repository root. | `git ls-files` |
| AUD-035 | `Database` is an empty interface (`packages/contracts/src/db.ts:6`), so SQL is untyped; 406 `any` occurrences across API, web and packages. | |
| AUD-036 | `CLAUDE.md` "Known gaps" and `supabase/MANIFEST.md` are stale: MANIFEST stops at M-084 and does not mention M-085, M-086 or M-087. | |
| AUD-037 | `pg` pool errors go to `console.warn` instead of the structured logger. | `kernel-min/db.ts:19,25` |
| AUD-038 | `DISABLE_MFA` is read straight from `process.env` in `kernel/authz.ts:74` and `rules/api/router.ts:96`, without the local-only guard in `mfa-switch.ts`. Safe today only because `loadConfig` refuses to start with it set outside local. | |

---

## 7. Prioritised remediation plan

**P0 — today, before anything is deployed or pushed**
1. Rotate the `service_role` key and the `dsa_api` / `postgres` database passwords; update every `.env` (AUD-003, AUD-004). Do not commit `tools/feed-notion-real-data.ts` as written.
2. Remove the test-login router, both migration-86 functions (new migration), the web fallback, `totp.ts` fail-open paths, and the bypass secret/OTP from `config.ts`, `app.ts`, `verify-token.ts` (AUD-001, AUD-002). Rebuild e2e login on `mintTestToken`.
3. Check the live `Media` bucket and make it private (AUD-008).
4. Rewrite history on `akash`, `piyush`, `samarth` (and `beta` if it ever carried the key) after rotation.

**P1 — this week**
5. Fix the OTP lockout and session signing (AUD-005, AUD-006); add a rollback-aware test.
6. Verify messaging signatures (AUD-007). Remove the browser direct-upload path (AUD-008). Remove or disable the payout gateway route (AUD-009).
7. Move all keys into validated config (AUD-010). Add step-up to every secret-rotation path (AUD-011).
8. Decide the partner auth model (AUD-012). Implement a real object store behind the API (AUD-013).
9. New migration revoking migration 87's grants and dropping its views; harden `apply_attribution_change` (AUD-014, AUD-015).

**P2 — before the pilot candidate**
10. `trust proxy`, per-route body limits, limiter before auth (AUD-016). Fix audit redaction (AUD-017). Remove hardcoded issuers/URLs (AUD-018). One shared S3 free-text validator in `packages/contracts`, applied everywhere (AUD-019). Resolve the S3 policy (AUD-020). Delete the query-string token path (AUD-021). Collapse the ten authz helpers into the kernel (AUD-022). Gate the directory reads (AUD-023). Make idempotency mandatory on money POSTs (AUD-025). Upgrade `kysely`, `body-parser`, `zod` (AUD-026). Get CI green and make OpenAPI generation deterministic (AUD-027). Rename and either un-mock or relabel spec 17 (AUD-024).

**P3 — hygiene.** Section 6.

**To earn a real completion number:** start Docker and run `npm run test:int` and `npm run test:isolation`; install `@vitest/coverage-v8`; add one end-to-end test through the real API with a real database and a seeded TOTP user; run the tenant-isolation sweep after AUD-001/002 are removed.

---

## 8. Module-wise results

### 8.1 API modules (route authorization, from the zero-grant probe)

Columns: routes in the module, how many answered 403/401 with no permissions, how many answered 422 (validation ran first, so authorization is **unconfirmed**), how many answered 2xx to a user with no permissions, other (404/409).

| Module | Routes | Guarded | Validated first | Open 2xx | Other | Notes |
|---|---:|---:|---:|---:|---:|---|
| platform | 58 | 43 | 1 | 10 | 4 | Largest file (1,994 lines). AUD-022, AUD-023, AUD-030. |
| rules/api | 29 | 29 | 0 | 0 | 0 | Step-up and SOD present on approve/publish/suspend. Local helper (AUD-022). |
| finance | 27 | 22 | 5 | 0 | 0 | AUD-009, AUD-025. Commission plan / clawback POSTs authorize inside the service. |
| origination/applications | 27 | 25 | 1 | 1 | 0 | Documents v2 design is good (signed links, size and hash check, `nosniff`). AUD-013. |
| automation | 23 | 23 | 0 | 0 | 0 | Not reviewed beyond the probe. |
| partner-api | 23 | 15 | 7 | 1 | 0 | AUD-011, AUD-012, AUD-031. |
| origination/catalogue | 20 | 11 | 0 | 2 | 7 | Reads open to any signed-in user. |
| reporting | 19 | 15 | 4 | 0 | 0 | 4 POST/GET validated first, unconfirmed. |
| origination/connectors | 17 | 9 | 8 | 0 | 0 | AUD-010, AUD-015, AUD-020. |
| reconciliation | 14 | 6 | 8 | 0 | 0 | AUD-010. 8 unconfirmed. |
| crm/leads | 13 | 8 | 4 | 0 | 1 | MOD-LEAD spec 13/13. Public apply link is rate-limited and honeypotted. |
| origination/sanctions | 12 | 6 | 6 | 0 | 0 | 6 unconfirmed (disbursement approvals). |
| crm/customers | 11 | 6 | 4 | 0 | 1 | |
| compliance | 11 | 9 | 2 | 0 | 0 | `consent-check` x2 unconfirmed. |
| crm/workforce | 10 | 0 | 3 | 5 | 2 | Writes check `user.manage` in the service; reads do not (AUD-023). |
| ledger | 9 | 7 | 2 | 0 | 0 | Journal idempotency optional (AUD-025). |
| origination/lender-cases | 9 | 4 | 5 | 0 | 0 | |
| audit | 9 | 9 | 0 | 0 | 0 | AUD-017. |
| imports | 7 | 3 | 3 | 0 | 1 | |
| platform-admin | 7 | 7 | 0 | 0 | 0 | DB-enforced realm; relies on AUD-001 being removed. |
| crm/tasks | 7 | 4 | 1 | 0 | 2 | AUD-019. |
| invoices | 6 | 4 | 2 | 0 | 0 | |
| origination/document-sharing | 6 | 6 | 0 | 0 | 0 | AUD-005, AUD-006 (public routes sit outside this count). |
| verification | 6 | 6 | 0 | 0 | 0 | |
| security | 6 | 6 | 0 | 0 | 0 | |
| integrations | 5 | 4 | 0 | 1 | 0 | Inbound webhook verification is correct. |
| crm/activities | 5 | 1 | 2 | 1 | 1 | Free-text S3 rule applied in the contract. |
| crm/grievances | 5 | 5 | 0 | 0 | 0 | |
| crm/targets | 5 | 3 | 2 | 0 | 0 | `POST /targets`, approval unconfirmed. |
| crm/messaging | 4 | 3 | 1 | 0 | 0 | AUD-007 (public webhook not counted). |
| crm/notifications | 4 | 0 | 2 | 2 | 0 | Per-user inbox; no permission by design. |
| origination/verifications | 3 | 3 | 0 | 0 | 0 | |
| **Total** | **417** | **302** | **73** | **23** | **19** | |

**Still to confirm by hand (about 16 routes).** Validation answers first on these and my static scan found no authorization call in the handler or the service method it names: `POST /compliance/consent-check` (and `/privacy/…`), `GET /timeline`, `POST /messages`, `POST /notifications/read`, `PATCH /me` (two registrations), `POST /targets`, `POST /targets/:id/approval`, `PATCH /me/availability`, portal `POST /disputes`, `POST /partner/sandbox/simulate-event`, `POST /api-clients`, `GET /metrics`, `POST /reporting/refresh`, `POST /report-schedules`. Most probably check inside a service method with a name my pattern did not catch; none are confirmed unsafe.

**Public (unauthenticated) endpoints** — `app.ts:114-139`:

| Route | Result |
|---|---|
| `/public/v1/auth/test-login`, `/auth/test-users` | **Critical** (AUD-001) |
| `/public/v1/upload/:token*` | AUD-005, AUD-006, AUD-033 |
| `/public/v1/webhooks/messaging/…` | AUD-007 |
| `/public/v1/webhooks/:provider/:id` | Correct: timestamp window, HMAC over raw body, constant-time compare, replay guard |
| `/public/v1/apply/:token` | Reasonable: 10/min limiter, honeypot, link resolves tenant |
| `/public/v1/document-uploads/:token`, `/document-files/:token` | Reasonable: token hash lookup, size+sha256 match, `nosniff`; body limit 52 MB parsed first (AUD-016) |

### 8.2 Database (model-wise)

- **142 tables** across 77 migrations. **139** call `enable_tenant_rls` (RLS enabled **and forced**, `tenant_id = app_tenant()` for USING and WITH CHECK). Exceptions: `permission`, `decision_definition`, `decision_dependency` — global catalogues; `permission` text-matches `tenant_id` in my scan, so confirm that is a comment or an FK rather than a missing policy.
- **19 `SECURITY DEFINER` functions.** 18 pin `search_path`; `apply_attribution_change` does not (AUD-015). The two test-auth functions must go (AUD-001). The public resolvers (`resolve_public_entry`, `resolve_public_upload_link`, `resolve_upload_intent`, `resolve_public_apply_link`) are cross-tenant by design and look up by token hash, which is acceptable.
- Role model: `dsa_app` NOLOGIN NOBYPASSRLS; `dsa_api` is a member. Migration 87 widens grants (AUD-014).
- Migration hygiene: lock matches; MANIFEST and MIGRATION_MATRIX do not list M-086/M-087 (AUD-036). No evidence either was applied to hosted.
- **Not verified:** actual hosted grants, policies on Supabase `storage.objects`, and whether anything has drifted from the repo. I did not connect to the hosted project.

### 8.3 Web app

- 346 files, 70k lines, 36 features. 395 unit tests pass; no coverage figure available.
- No `dangerouslySetInnerHTML`, `innerHTML =` or `eval`. `window.open` uses `noopener`. Tokens are held in memory (`auth/token.ts`), apart from the saved bypass session (AUD-001).
- Authorization in the UI is advisory; the server remains the authority, which is correct.
- Direct Supabase Storage writes (AUD-008) and the bypass paths (AUD-001) are the material defects.

### 8.4 Spec conformance

- Prior audit (10-19): 84 of 293 Notion endpoints missing. Remediation claimed all but API-AUTH-005/006. **Sampled check today:** MOD-LEAD 13 of 13 present. The repository now documents 456 operations against the spec's 293. The other 40 module pages were **not** re-compared today; treat that figure as unverified.
- `API-AUTH-005/006` (session list / revoke) remain unimplemented, per `CLAUDE.md`.

---

## 9. Scope, coverage and limits (read this before relying on the numbers)

**Read in full, line by line:** `app.ts`, `server.ts`, `config.ts`, `wiring.ts`, `http/{public-auth-router,supabase-auth,rate-limit,mfa-switch,error-handler,module-gate}.ts`, `kernel-min/{db,tx-runner}.ts`, `packages/kernel/src/{auth/verify-token,auth/resolve-principal,authz/authz,audit/audit,outbox/outbox,testing/test-token}.ts`, `storage/object-storage.ts`, `document-sharing-service.ts` (lines 1-80, 418-680), `documents.ts` (60-200, 805-966), `connector-portal.ts` (150-215), `inbound-webhooks.ts`, `lead-extras.ts` (560-end), `finance/{crypto,payment-gateway}.ts`, `reconciliation/crypto.ts`, `partner-api/{router 55-110 & 225-345, auth-middleware 1-60 & 115-200}`, `platform/router.ts` (1-330, 1340-1475), the two newest migrations, the web files `documents/api.ts`, `auth/{supabase,totp,StepUpProvider}.ts(x)`, `LoginPage.tsx` (1-215), and all uncommitted diffs.

**Covered by tooling, not by reading:** every other source file via typecheck, lint, 1,505 unit tests, repository-wide pattern searches (secrets, `console.*`, raw SQL, `process.env`, `any`, escape hatches, in-memory fallbacks), static route and If-Match/idempotency scans, an RLS scan of all migrations, the zero-grant route probe, OpenAPI regeneration, and `npm audit`.

**Not covered.** Most service and repository files (finance, reporting, automation, reconciliation, lender cases, sanctions, customers, tasks, grievances, security, integrations adapters); the BRE engine and `bre-core`; every web feature beyond the files named; test quality beyond the cases cited; hosted Supabase configuration (signup, MFA enforcement, storage policies, backups); Playwright; and everything that needs Docker.

**Why the "validated-first" routes are listed, not judged.** My probe sends `{}` bodies, so POST routes whose schema fails first never reach their permission check. I report them as unconfirmed rather than as guarded or open.

**The completion figure** is a weighted judgement, shown so you can change the weights:

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Functional breadth against the spec | 35% | 0.92 | MOD-LEAD 13/13; 417 routes, all documented; prior audit's remediation; other modules not re-compared |
| Verified correctness | 25% | 0.55 | Unit tests green; integration, isolation and real-stack e2e not run or not real |
| Security and data protection | 25% | 0.35 | 4 Critical and 9 High open; strong RLS and tenancy foundation |
| Delivery quality gates | 15% | 0.55 | Typecheck, lint, secrets test and OpenAPI diff red; migrations and docs mostly in order |
| **Weighted total** | 100% | **≈ 0.63** | Plausible range 0.55–0.70 |

**Artifacts for reproduction** (outside the repository, in the session scratchpad `C:\Users\Bhush\AppData\Local\Temp\claude\c--Users-Bhush-Desktop-DSA-Agent\0831071a-ce72-47e3-8610-cb0c7dd27fae\scratchpad\`): `forge-repro.mts` (AUD-002), `otp-repro.mts` (AUD-005), `route-probe.mts` with results in `probe-zero.json`, `authz-static.mjs` with `authz-static.json`, `rls-scan.mjs`, `gen-openapi-scratch.mts` with `openapi.generated.yaml`, plus `typecheck.log`, `lint.log` and `test.clean.log`. Run the `.mts` scripts from `apps/api` with `npx tsx <path>`.
