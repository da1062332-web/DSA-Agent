# Release Notes — DSA CRM v0.1.0-rc.1

- **Candidate Version:** `v0.1.0-rc.1`
- **Release Target:** Internal pilot candidate — **Synthetic data only; not production-ready**
- **Date:** 2026-10-14
- **Release Owner / MVP Owner:** Dev 1 (Platform squad — Release notes and tagging only)
- **Reference Tracking:** REL-003 (Pre-release Verification Gate) & REL-004 (Release Tagging & Artifact Packaging)

---

## 1. Executive Summary and Scope

`v0.1.0-rc.1` represents the internal pilot release candidate of the **Workflow A walking-skeleton MVP** for the DSA CRM platform, built across a 4-day integration schedule.

The primary objective of this release candidate is to demonstrate end-to-end traversal of Workflow A using synthetic data, validating:
1. Lead capture with mandatory consent recording.
2. In-memory BRE deduplication, eligibility, and task routing.
3. First-contact task dispatch and SLA lifecycle management.
4. Lead qualification and atomic conversion into customer and loan application entities.
5. Document checklist requirements and completeness tracking.
6. Lender case packaging and simulated status roll-up.
7. Multi-tenant isolation at the database layer (PostgreSQL RLS with `dsa_api` NOBYPASSRLS).

**Important Operating Restriction:** Candidate `v0.1.0-rc.1` runs with synthetic data only and strictly forbids real customer PII or S3-class financial identifiers (PAN, Aadhaar reference, DOB, UTR, bank account details) in accordance with architecture decision ADR-4D-04.

---

## 2. Included and Partially Implemented Functionality

### 2.1 Administration and Platform Operations (MOD-ADM)
In accordance with the Module 30 specification and the Implementation Readiness Assessment ([`MOD_ADM_READINESS_ASSESSMENT.md`](./MOD_ADM_READINESS_ASSESSMENT.md)), platform operational scope for `v0.1.0-rc.1` is restricted as follows:

- **SUB-ADM.08 — Release Management:** **Partially Implemented**
  - **Immutable Migration System:** Enforced by [`supabase/MANIFEST.md`](./supabase/MANIFEST.md); migrations follow strict numerical ordering and owner allocation; merged migrations are never edited in place.
  - **Rule-Pack Immutability:** Enforced by [`supabase/migrations/20261001000010_rules_core.sql`](./supabase/migrations/20261001000010_rules_core.sql); rule set versions (`rule_set_version`) increment monotonically through draft, submitted, approved, published, and retired states without in-place edits.
  - **REL-001 (Platform, Auth & Migration Baseline):** Verified via [`tools/verify-migrations.ts`](./tools/verify-migrations.ts) verifying RLS policies, zero DELETE privileges for role `dsa_app`, and fail-closed isolation checks.
  - **REL-002 (OpenAPI Contract Verification):** Verified in GitHub Actions CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) asserting that generated OpenAPI artifacts match committed schemas.
  - **Tenant Administration Screens:** Implemented for tenant-level operational entities (`apps/web/src/features/admin/`): Organization settings, branch management, internal team rosters, and operational work queues.

### 2.2 Core Workflow A Capabilities (Walking Skeleton)
- **Platform & Security (Dev 1 / MOD-02):**
  - Express 5 API modular monolith with fixed middleware chain (helmet, cors, correlation ID, rate-limit, auth, zod validation, error handler).
  - Supabase Auth integration with JWT asymmetric verification and mandatory `app_metadata.tenant_id` claim.
  - Transaction-local tenant binding (`SET LOCAL app.tenant_id`) preventing cross-tenant leakage.
- **Business Rule Engine (Dev 2 / MOD-BRE):**
  - In-process, synchronous rule evaluation (`ADR-4D-01`) with compiled in-memory IR caching (`ADR-4D-02`).
  - Immutability guards and separation of duties for rule authoring and publication.
- **Applications & Catalogue (Dev 3 / MOD-APP, MOD-PRD):**
  - Loan application lifecycle, applicant party tracking, and document checklist generator.
  - Loan product catalogue and versioning with effective date scheduling.
- **Lender Cases & Integration (Dev 4 / MOD-LC, MOD-LND):**
  - Lender directory, empanelment status gates, and submission package generation.
- **Leads, Customers & Consent (Dev 5 / MOD-CRM, MOD-PRV):**
  - Lead capture, consent ledger, customer profile linking, and masked data projections.
- **Tasks & Governance (Dev 6 / MOD-TSK):**
  - Task assignment, queue member routing, and append-only audit event logging.

---

## 3. Explicitly Deferred Functionality (TASK-420)

The following seven submodules of **Module 30 (MOD-ADM)** are **deferred under TASK-420** and are **NOT IMPLEMENTED, NOT ACTIVE, AND NOT PRODUCTION-READY** in `v0.1.0-rc.1`:

| Submodule | Canonical Code | Deferred Component / Capabilities |
| :--- | :--- | :--- |
| **Platform Console** | `SUB-ADM.01` | Component `CMP-ADM.01.1` (Platform console UI), endpoint `API-TEN-002` (`GET /platform/v1/tenants`), permission `platform.console`, and cross-tenant metadata reporting. |
| **Feature Flags** | `SUB-ADM.02` | Component `CMP-ADM.02.1` (Flag service), endpoints `API-ADM-001` / `API-ADM-002`, entity `ENT-016 feature_flag`, permission `platform.flags`, and global/tenant flag overrides. |
| **Master Data Management** | `SUB-ADM.03` | Component `CMP-ADM.03.1` (Master data manager), import preview endpoint `API-ADM-003`, entity `ENT-017 master_data_item`, and permission `platform.master_data`. |
| **Background Jobs** | `SUB-ADM.04` | Component `CMP-ADM.04.1` (Job console), job inspection `API-ADM-004`, queue pause endpoint `API-ADM-005`, entity `ENT-070 dead_letter`, and permission `platform.jobs`. Blocked by architecture decision ADR-4D-02 (no Redis or asynchronous queue engine). |
| **System Health** | `SUB-ADM.05` | Component `CMP-ADM.05.1` (Health dashboard), status page, and deep dependency health probes (only a static `GET /health` endpoint exists). |
| **Support Access** | `SUB-ADM.06` | Component `CMP-ADM.06.1` (Access grant service), break-glass endpoints `API-ADM-006` / `API-ADM-007`, entity `ENT-018 support_access_grant`, permission `platform.support_access`, and separation-of-duties rule `SOD-06`. |
| **Data Correction** | `SUB-ADM.07` | Component `CMP-ADM.07.1` (Correction request workflow), correction endpoints `API-ADM-008` / `API-ADM-009`, entity `ENT-112 data_correction_request`, separation-of-duties rule `SOD-08`, and service-identity execution. |

---

## 4. Reported Verification Results

The verification results reported in [`MOD_ADM_READINESS_ASSESSMENT.md`](./MOD_ADM_READINESS_ASSESSMENT.md) reflect the current state of the candidate branch:

### 4.1 Passed Checks
- **TypeScript Typecheck (`npm run typecheck`):**  
  **Exit Code 0 (PASS)** across all monorepo workspaces: `@dsa/api`, `@dsa/web`, `@dsa/bre-core`, `@dsa/contracts`, `@dsa/kernel`, and `@dsa/tools`.
- **Automated Tests (`npm test`):**  
  **Exit Code 0 (PASS)** — 444 test cases passed across all test suites:
  - `@dsa/api`: 329 passed
  - `@dsa/web`: 69 passed
  - `@dsa/contracts`: 28 passed
  - `@dsa/kernel`: 18 passed
- **Database Migration & RLS Verification (`npm run db:verify`):**  
  **Exit Code 0 (PASS)** — All 5 security and migration checks passed:
  - Check (a): RLS lint returned zero unprotected tables (NFR-SEC-003).
  - Check (b): Zero DELETE privileges granted to `dsa_app`.
  - Check (c): All non-tenant tables reside on the global allow-list (`tenant`, `permission`, `decision_definition`).
  - Check (d): Fail-closed test under unconfigured tenant session verified 0 rows returned.
  - Check (e): Zero schema `app` tables exposed to Supabase Data API (`anon`/`authenticated`).
- **OpenAPI Specification Generation (`npm run gen:openapi`):**  
  **Exit Code 0 (PASS)** — Contract registry generated cleanly to `openapi/openapi.yaml`.
- **Production Bundle Build (`npm run build`):**  
  **Exit Code 0 (PASS)** — `@dsa/api` built via `tsup` and `@dsa/web` built via `vite`.

### 4.2 Outstanding / Failed Checks
- **Code Linting (`npm run lint`):**  
  **Exit Code 1 (FAIL)** — 149 errors and 2 warnings reported. Failures are pre-existing issues primarily related to `@typescript-eslint/no-explicit-any` usage and unused variable declarations in `apps/web` and `packages/contracts`.
- **Tenant Isolation Suite (`npm run test:isolation`):**  
  **Exit Code 1 (FAIL)** — Testcontainers was unable to locate an active Docker container runtime on the host environment; additionally, `inventory.spec.ts` reported missing isolation test cases for newer endpoints.

---

## 5. Release Readiness Requirements for Gate 4

Before candidate `v0.1.0-rc.1` can be formally tagged, published, or deployed to staging, the following four release requirements must be fulfilled:

1. **Resolve Reported Lint Errors:**  
   Clean up the 149 ESLint errors in `apps/web` and `packages/contracts` so that `npm run lint` completes with exit code 0.
2. **Execute Full Isolation & Integration Suites in Docker:**  
   Run `npm run test:isolation` and `npm run test:int` in an environment with Docker available, ensuring all tenant-boundary test scenarios succeed.
3. **Formal Release Note Sign-Off from Dev 1:**  
   Dev 1, as the designated MVP owner for release notes and tagging, must formally review and approve these release notes.
4. **Confirm Candidate Readiness Prior to Tagging:**  
   Verify that all CI gates in `.github/workflows/ci.yml` pass on the candidate branch before creating or pushing the Git tag.

---

## 6. Release Procedures: REL-003 and REL-004

### 6.1 REL-003: Pre-Release Quality Gate Checklist
REL-003 governs the pre-release quality verification gate. The checklist consists of:
- [x] All 6 monorepo workspaces pass `npm run typecheck`.
- [x] All 444 unit and route tests pass `npm test`.
- [x] Migration verification passes `npm run db:verify` on a target database instance.
- [x] OpenAPI specification is synchronized (`npm run gen:openapi`) and diff-free (`REL-002`).
- [x] Production build succeeds (`npm run build`).
- [ ] Codebase passes `npm run lint` with 0 errors.
- [ ] Tenant isolation test suite passes (`npm run test:isolation`).
- [ ] Staging database migration push verified without data loss (`REL-001`).

### 6.2 REL-004: Release Tagging and Packaging Procedure
REL-004 governs the tagging convention and artifact generation for candidate releases:
- **Branch Target:** Cut release branch `release/0.1` from `main` or merge approved release PR into `main`.
- **Tag Naming Convention:** Exact semantic version with pre-release identifier: `v0.1.0-rc.1`.
- **Tag Type:** Annotated Git tag signed or authored by Dev 1.
- **Current Status:** **NOT YET TAGGED**. (Verified via `git tag -l` — 0 tags currently exist).
- **Authorized Execution Commands (Hold until Gate 4 approval is granted):**
  ```bash
  # Step 1: Create annotated tag on the release commit
  git tag -a v0.1.0-rc.1 -m "Release v0.1.0-rc.1: Internal pilot candidate (Workflow A walking skeleton)"

  # Step 2: Push tag to origin remote (requires authorization)
  git push origin v0.1.0-rc.1
  ```

---

## 7. Ambiguity and Gaps Requiring Dev 1 Confirmation

1. **Formal Gate Approval Mechanism:**  
   The repository does not contain a machine-readable config or checklist template for REL-003 / REL-004 approvals (such as a GitHub Release action or sign-off issue template). Dev 1 should confirm whether manual sign-off in `docs/runbook.md` is sufficient for Gate 4.
2. **Release Branch Cutting:**  
   `docs/runbook.md#L26` mentions cutting `release/0.1` prior to tagging `v0.1.0-rc.1`. Dev 1 should confirm whether tagging will occur directly on `main` or if branch `release/0.1` should be cut first.

---

## 8. Integrity Confirmation

- Seven deferred submodules (`SUB-ADM.01` through `SUB-ADM.07`) were **not implemented or modified**.
- No database migrations, API contracts, RLS policies, permissions, or application code were altered.
- No Git tags were created, moved, or pushed.
