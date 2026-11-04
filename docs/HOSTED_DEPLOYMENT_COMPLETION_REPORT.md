# Hosted deployment completion report

**Date:** 2026-11-04
**Status:** Not deployed. Hosted Supabase was not changed. No migration was applied. No key was rotated.
**Branch:** `beta`. `origin/beta` is at `4727297`, which was pushed as a fast-forward from `ea987c0`.

This report states what was verified locally, what was not verified, and what needs an owner's approval. Where a value could only be checked in a dashboard or on hosted, it is marked **unverified**.

## 1. Git

| Item | Status |
|---|---|
| Pushed to `origin/beta` | `46df303`, `7e37492`, `c030b04`, `3eb5aa3`, `8d4fc31` (signing-key redaction), `4727297` (merge with `origin/beta`) |
| Upstream changes from Bhushan Shimpi | `76010cf` and `ea987c0` are kept. Their 18 deletions are kept as they are on `origin/beta`. They were **not** restored and their intent is **not confirmed** |
| Force push or history rewrite | None |
| Signing-key literal | Redacted in the current tree (`docs/AUDIT_REPORT_2026-10-26.md`). Still present in git history (commits `912a261`, `4000af4`, `71613d7`). Not rewritten |
| Commits after `4727297` | The modified connector work and this report are committed after it. See `git log` for their hashes |

## 2. Verification of the modified tree

| Check | Result |
|---|---|
| Root typecheck | Pass |
| Kernel unit | 31 of 31 |
| Web unit | 752 of 752 |
| API unit | 1411 of 1411 |
| Integration, focused (connector, portal, verification, document, payout, dispute, attribution, invitation, audit, migration, lead) | 207 pass, 34 skipped. Three migration-rehearsal files fail at setup (see section 3) |
| Tenant isolation sweep | 549 of 549 |
| Web and API production builds | Pass |
| Lint | 958 problems: 1 error (`e2e/helpers/mock-session.ts`, predates this work), 957 warnings |

The Playwright e2e suite was not run. It needs browsers and the public Vercel URL.

## 3. Migrations

**Local (verified):**
- 92 migration files. Every hash matches `supabase/migrations.lock.json`. No duplicate version prefixes.
- All 92 files apply in order on a fresh database, with the test fixtures.
- Migration 0099 verify script: PASS.
- Migration 0098 verify script: the first run on a fixture-built database reports 29 missing backfill grants. Re-applying 0098 clears them. The migration's own notes say re-running is idempotent. The grants were missing because the fixtures create roles after the migrations run, so this does not show what hosted will report.
- Dependency: 0098 inserts grants for permission codes defined by migrations 54–65. Applying 0098 without them fails on a foreign key. The rehearsal tests (`migration-sequence`, `migration-batch-partial`, `migration-batch-runbook`) skip 54–65 as pending while still applying 0098, so they fail. This is a stale test model, not a defect in the migrations. Those three files are unchanged by this work.

**Hosted (unverified):**
- `docs/MIGRATION_MATRIX.md` records migrations 54, 57, 59, 60, 61, 58, 55, 63, 64 and 65 as applied on 2026-10-17. This is a document claim, not a check.
- `docs/HOSTED_MIGRATION_RUNBOOK.md` expects hosted at version 0097, with 0098 and 0099 not yet applied.
- 0100, 0101 and 0102 are pending owner approval.
- No hosted ledger query was run. No approval for one has been given.

## 4. Render (API)

- Blueprint `render.yaml`: service `dsa-api`, root `apps/api`, build `npm install && npm run build`, start `npm start`, health check `/health`. The route exists in `apps/api/src/app.ts`.
- Auto-deploy for `beta`: paused, as confirmed by the owner on 2026-11-04. **Not re-verified** in the dashboard by this session.
- **No deploy was performed.**
- Before resuming deploys, the following must hold:
  - Hosted has 0098 and 0099 applied and verified. If 54–65 are not on hosted, they come first. Applying them needs approval.
  - `DOCUMENT_STORE` is a deliberate choice. The blueprint does not set it, so the code defaults to `local`. Document files are lost on redeploy.
  - `SUPABASE_MFA_ENABLED` matches the intended Supabase MFA policy. Its value is **unverified**.
  - `DISABLE_MFA` and `TEST_AUTH_ENABLED` are off. Neither appears in the blueprint, so their dashboard values are **unverified**.

## 5. Vercel (web)

- `vercel.json`: framework Vite, build `npm run build:web`, output `apps/web/dist`.
- **No deploy was performed.**
- The local production build defaults `VITE_API_BASE_URL` to `http://localhost:3000`. The Vercel production environment must set it to the Render API URL before any frontend deploy. **Unverified.**
- Bundle check of the local build: no service-role key. The one JWT present has the `anon` role. The `localhost` reference is the default described above, which the deployed build must not contain.

## 6. Environment configuration (names only, values unverified)

| Where | Names configured in repo config |
|---|---|
| Render | `NODE_ENV`, `LOG_LEVEL`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `APP_SIGNING_SECRET`, `CLAMAV_ADDRESS` |
| Render (not in blueprint, check in dashboard) | `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED`, `DISABLE_MFA`, `TEST_AUTH_ENABLED` |
| Vercel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` |

No value was printed or checked.

## 7. Smoke tests

**Not run.** There is no deployed environment to test, and no hosted data may be used for test transactions. The corresponding behaviour is covered by the local integration and isolation suites listed in section 2. A browser pass was not run because no browser tool is available.

## 8. Remaining security risks

1. **AUD-P0-03, signing key.** The key is in git history and was used by the removed fabricated-acknowledgement code. Rotation has not been performed. No consumer of the key remains in the code.
2. **Hosted may hold fabricated payments.** Any hosted `payout_request` marked `PAYMENT_RECORDED` with a `CMS` reference, and any connector set ACTIVE through the status route before the fix, needs a read-only check against bank statements and verification records.
3. **Manual payment recording** accepts a staff-typed reference with no bank verification (AUD-P1-10). It is now the only way a payout becomes paid.
4. **Payout requests are not tied to an approved bank account** (AUD-P1-02).
5. **The consent OTP is never delivered** (AUD-P1-01). The code is stored only as a hash, so a delivery consumer alone cannot send it. Delivery has to happen in the request itself, which is a design change.
6. **Connector approvals do not require step-up** (AUD-P1-08): bank accounts, attribution, status changes and dispute resolution.
7. **Rate card and commission are separate** (AUD-P1-06). A partner may see a rate that is not the one paid.
8. **Connector scope is enforced in application code only** (AUD-P2-05). Row-level security checks the tenant.
9. **Signed document links are bearer links.** Their lifetime and single use have not been reviewed (AUD-P2-06).
10. **Documents are stored locally on Render** unless `DOCUMENT_STORE` is set. They would be lost on redeploy.
11. **No connector consent exists**, so connector verification and activation cannot happen through the product (AUD-P1-07). This is a compliance decision.
12. **The rehearsal test model is stale** (AUD-P1-09). Fresh-to-hosted migration order is not proven by CI until it is fixed.
13. **Bhushan's 18 deletions** are unconfirmed. They remove readiness reports, a backup spreadsheet, a seed script and `pnpm-lock.yaml` from `beta`.

## 9. Work that needs administrator or business approval

- **Hosted:** approval for a read-only ledger and data check, and approval to apply 0098 and 0099 (and 54–65 and 0100–0102 if needed), with their verify scripts.
- **Render:** decide `DOCUMENT_STORE` (and set S3 if required), confirm `SUPABASE_MFA_ENABLED`, and confirm the auto-deploy policy before resuming deploys.
- **Vercel:** confirm `VITE_API_BASE_URL` for the production environment.
- **Key rotation (AUD-P0-03):** security owner, coordinated with every consumer of the key. History rewrite is not approved.
- **Connector consent (AUD-P1-07):** compliance choice between Option A, B, C or D in `docs/CONNECTOR_VERIFICATION_DECISION.md`.
- **Payment evidence (AUD-P1-10):** finance decision on what a payout needs before it can be marked paid.
- **Step-up policy (AUD-P1-08):** security owner.
- **OTP delivery (AUD-P1-01):** product and messaging owner.
- **Upstream deletions (Bhushan):** the author or owner of `76010cf` to confirm, then restore or keep.

## 10. Remaining open items from the connector audit

Fixed in code and tested in this change set: AUD-P0-01, AUD-P0-02, AUD-P1-03, AUD-P1-04 (lead creation only), AUD-P1-05, AUD-P2-01, AUD-P3-01, AUD-P3-02. Remaining open items are listed in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`.
