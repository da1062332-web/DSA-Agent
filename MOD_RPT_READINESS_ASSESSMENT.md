# Implementation Readiness Assessment: MOD-RPT (Reporting and Analytics)

**Module:** `MOD-RPT — Reporting and Analytics`  
**Domain:** `DOM-L — Reporting and Analytics`  
**Squad:** Data squad  
**CRM PM:** Business owner — CEO  
**MVP Owner:** None  
**Task Code:** `TASK-414`  
**Evaluation Date:** 2026-10-14  
**Active Branch:** `samarth`  
**Evaluation Type:** Read-Only Implementation Readiness & Architecture Gap Assessment  
**Document Status:** `FINAL READINESS ASSESSMENT`  

---

## 1. Executive Summary

This document provides a detailed implementation readiness assessment of `MOD-RPT` (Module 31 — Reporting and Analytics) against the canonical specification in the DSA CRM repository.

In the project specification, `MOD-RPT` is formally classified as **Deferred under TASK-414** across all 5 submodules. 

During the recent delivery of `MOD-PERF` (Team Performance and Targets), a lightweight, operational reporting foundation was introduced to satisfy immediate performance dashboard and target matching requirements (Migrations `M-029` and `M-031`, canonical metric catalog in `app.metric_definition`, daily operational projection in `app.rpt_daily_operational_summary`, `GET /v1/metrics`, `GET /v1/dashboards/TEAM_PERFORMANCE`, and `POST /v1/reporting/refresh`).

However, an exhaustive inspection of the repository against the full Module 31 enterprise specification reveals that **the broader reporting and analytics platform remains largely deferred and unbuilt**. Critical enterprise capabilities—including an event-driven read-replica store (`rpt_` schema), asynchronous projection workers, report catalogue runner, scheduled distributions, record-level S3 exports, step-up export permissions, and daily control totals (`FR-RPT-008`)—are absent.

### Submodule Readiness Scorecard

| Submodule | Specified Status | Actual Repository Status | Implementation Level | Readiness Verdict |
|---|---|---|---|---|
| **SUB-RPT.01 — Metric Registry** | Deferred (`TASK-414`) | Partially Implemented (Operational Subset) | ~35% | **NOT READY FOR PRODUCTION REGISTRY** (Lacks formula JSONB, versioning, global definitions, tenant overrides, audit) |
| **SUB-RPT.02 — Reporting Store** | Deferred (`TASK-414`) | Prototype OLTP Projection Table Only | ~20% | **NOT READY** (Lacks read replica, `rpt_` schema, outbox projection workers, daily control totals FR-RPT-008) |
| **SUB-RPT.03 — Dashboards** | Deferred (`TASK-414`) | Partially Implemented (Team & Leaderboard only) | ~30% | **NOT READY FOR ENTERPRISE SUITE** (Lacks Executive, Branch, Operations, Finance, and Connector dashboard categories) |
| **SUB-RPT.04 — Report Catalogue** | Deferred (`TASK-414`) | Unbuilt / Completely Absent | 0% | **NOT IMPLEMENTED (DEFERRED)** |
| **SUB-RPT.05 — Exports & Schedules** | Deferred (`TASK-414`) | Unbuilt / Completely Absent | 0% | **NOT IMPLEMENTED (DEFERRED)** |
| **Overall MOD-RPT** | **Deferred (`TASK-414`)** | **Partially Implemented (Foundation Prototype)** | **~17% Overall** | **DEFERRED — IMPLEMENTATION AUTHORIZATION REQUIRED** |

---

## 2. Repository Inspection Scope

The assessment performed a thorough, read-only inspection of the repository across:
1. **Shared Contracts & Typing:** `packages/contracts/src/` (`reporting.ts`, `permissions.ts`, `events.ts`, `kernel.ts`).
2. **Database Schema & Migrations:** `supabase/migrations/` (`20261001000029_reporting.sql`, `20261001000031_report_manage_permission.sql`, `20261001000002_kernel_infra.sql`), `supabase/MANIFEST.md`.
3. **Backend API Services & Modules:** `apps/api/src/modules/reporting/` (`service.ts`, `repository.ts`, `router.ts`, `openapi.ts`, `types.ts`, `index.ts`), `apps/api/src/modules/crm/targets/`.
4. **Kernel Infrastructure:** `packages/kernel/` (outbox, audit, context, MFA step-up auth, RLS utilities).
5. **Frontend Applications:** `apps/web/src/features/performance/`, `apps/web/src/shell/Sidebar.tsx`.
6. **Integration & Automated Tests:** `apps/api/test/reporting.spec.ts`, `apps/api/test/reporting.pg.int.spec.ts`, `apps/web/src/features/performance/PerformancePage.spec.tsx`.
7. **Database Verification Suite:** `tools/verify-migrations.ts`, `tools/verify-db.ts`.

---

## 3. Submodule-by-Submodule Assessment

### 3.1 SUB-RPT.01 — Metric Registry
- **Specification Requirements:**
  - Component: `CMP-RPT.01.1` Metric registry UI.
  - API: `API-RPT-001: GET /v1/metrics` (Requires `report.read`).
  - Database Entity: `ENT-094: metric_definition` (Fields: `code`, `version`, `formula (jsonb)`, `date_basis`, `grain`, `filters`, `owner`, `effective_from`; Unique constraint: `(code, version)`; Global definitions with tenant overrides; Classification: S0; Retention: permanent; Auditing: required).
- **Existing Implementation in Repository:**
  - `API-RPT-001: GET /v1/metrics`: Implemented in `apps/api/src/modules/reporting/` requiring `report.read`. Computes operational actuals for 9 canonical metrics and matches with active approved targets.
  - `API-RPT-003: GET /v1/metric-definitions` (or `/v1/metrics/definitions`): Implemented, returning seeded metric metadata.
  - Table `app.metric_definition`: Created in `supabase/migrations/20261001000029_reporting.sql` (`M-029`). Has columns: `tenant_id`, `code`, `name`, `description`, `category`, `unit`, `aggregation_type`, `source_domain`, `created_at`. Primary key: `(tenant_id, code)`.
- **Missing Functionality & Gaps:**
  - **Schema Divergence:** `app.metric_definition` lacks specified fields: `version`, `formula (jsonb)`, `date_basis`, `grain`, `filters`, `owner`, and `effective_from`.
  - **Versioning & Constraints:** Lacks `(code, version)` unique composite key.
  - **Global Definitions & Tenant Overrides:** Currently creates redundant rows per tenant via cross-join seed rather than maintaining a clean global catalog table with tenant-specific override layers.
  - **Auditing & Retention:** Changes to metric definitions do not write audit records to `app.audit_event`.
  - **UI Registry Component:** `CMP-RPT.01.1` (Metric Registry admin view) is absent.

### 3.2 SUB-RPT.02 — Reporting Store
- **Specification Requirements:**
  - Component: `CMP-RPT.02.1` Projection workers.
  - Architecture: Projections built from events; uses a dedicated read replica; reporting data resides in `rpt_` schema on replica; every row has `tenant_id`; RLS enforced; reporting role must NOT have `BYPASSRLS`; daily control totals compared with OLTP data (`FR-RPT-008`); depends on outbox.
- **Existing Implementation in Repository:**
  - Outbox infrastructure: `app.outbox_event` (`ENT-108`) exists in PostgreSQL (`M-002`), and application services emit transactional outbox events (`lead.created`, `sanction.recorded`, etc.).
  - Operational table: Table `app.rpt_daily_operational_summary` exists in schema `app`. Includes `tenant_id`, enforces RLS (`rpt_summary_tenant_isolation`), and passes fail-closed tenant checks.
  - Privilege checks: `tools/verify-migrations.ts` confirms that neither `dsa_app` nor `dsa_api` hold `BYPASSRLS`.
- **Missing Functionality & Gaps:**
  - **No Read Replica:** The database connection in `packages/kernel` connects solely to a single primary PostgreSQL connection pool (`DATABASE_URL`). There is no read-replica pool or connection configuration.
  - **No `rpt_` Schema:** Projections reside directly in the OLTP `app` schema on the primary database, violating the read-replica isolation design.
  - **No Projection Workers (`CMP-RPT.02.1`):** There are no event consumption workers. Projections are populated exclusively via synchronous, on-demand SQL queries triggered by `POST /v1/reporting/refresh`.
  - **Outbox Relay Missing:** Outbox events remain unconsumed in `app.outbox_event` (relay is deferred to `TASK-403`).
  - **Daily Control Totals (`FR-RPT-008`):** No automated reconciliation job exists to compare projection totals against OLTP sources.

### 3.3 SUB-RPT.03 — Dashboards
- **Specification Requirements:**
  - Component: `CMP-RPT.03.1` Dashboard framework.
  - API: `API-RPT-002: GET /v1/dashboards/{code}` (Returns dashboard data with freshness metadata; requires `report.read`).
  - Categories: 1. Executive, 2. Branch, 3. Team, 4. Operations, 5. Finance, 6. Connector dashboards.
  - Data & Authorization: Reads from `rpt_` projections and `ENT-094`; scope rules from `MOD-ACL`; restricted by `report.read` and role scope.
- **Existing Implementation in Repository:**
  - `API-RPT-002: GET /v1/dashboards/{code}` is implemented in `apps/api/src/modules/reporting/` with `report.read` authorization and `asOf` UTC freshness metadata.
  - Implemented Dashboard Codes:
    - `TEAM_PERFORMANCE`: Activity-vs-outcome funnel, summary KPI cards, target-vs-actual matching, and branch breakdown.
    - `LEADERBOARD`: Operational participant metrics with `guardrailStatus: 'INSUFFICIENT_DATA'` and unranked records (`rank: null`, `score: null` pending [ADR-012](docs/adr/ADR-012-leaderboard-scoring-policy.md)).
  - Security: Restricts branch managers from accessing unassigned branches (returns 403 `FORBIDDEN`). Ensures aggregate-only reporting without customer PII leakage.
- **Missing Functionality & Gaps:**
  - **Missing Dashboard Categories:** 4 out of 6 specified categories are completely unbuilt:
    - Executive Dashboard (missing)
    - Operations Dashboard (missing)
    - Finance Dashboard (missing)
    - Connector Dashboard (missing)
  - Querying any unrecognized dashboard code returns 404 `NOT_FOUND`.
  - Generic frontend dashboard layout/widget framework (`CMP-RPT.03.1`) is absent.

### 3.4 SUB-RPT.04 — Report Catalogue
- **Specification Requirements:**
  - Component: `CMP-RPT.04.1` Report runner.
  - APIs:
    - `API-RPT-003: POST /v1/reports/{code}/runs` (Starts asynchronous report run, requires `report.read`).
    - `API-RPT-004: GET /v1/report-runs/{id}` (Returns report-run status and results).
  - Data handling: Reads from `rpt_` projections; run results stored as export objects.
- **Existing Implementation in Repository:**
  - None.
- **Missing Functionality & Gaps:**
  - **Endpoints Absent:** Neither `POST /v1/reports/{code}/runs` nor `GET /v1/report-runs/{id}` exists in router or OpenAPI definitions.
  - **Asynchronous Engine Absent:** No background job queue (e.g. pg-boss, BullMQ, or worker pool) exists to process report generation runs asynchronously.
  - **Catalogue Definitions Absent:** No data entities or seed catalogs exist for parameterized tabular reports.
  - **Component Absent:** `CMP-RPT.04.1` Report runner UI does not exist.

### 3.5 SUB-RPT.05 — Exports and Schedules
- **Specification Requirements:**
  - Components: `CMP-RPT.05.1` Export job, `CMP-RPT.05.2` Scheduler.
  - APIs:
    - `API-RPT-005: POST /v1/report-schedules` (Requires `report.schedule`, validates recipient scope).
    - `API-RPT-006: POST /v1/exports` (Asynchronous record-level exports, requires `export.run`, requires step-up MFA, logged).
    - `API-RPT-007: GET /v1/exports/{id}` (Returns status and expiring download access).
  - Database Entity: `ENT-111: export_job` (Fields: `requester`, `scope`, `filters`, `row_count`, `file_key`, `expires_at`, `downloaded_at`; retention `R-AUD`, 24-hr file expiry, audited).
  - Role Requirements: `export.run` for `ROLE-ORG-OWNER` (tenant), `ROLE-BRANCH-MGR` (branch), `ROLE-FINANCE-EXEC` (finance); read access for `ROLE-COMPLIANCE`, `ROLE-AUDITOR`.
  - Dependencies: `MOD-IMP` (Import/Export), `MOD-AUD` (Audit).
- **Existing Implementation in Repository:**
  - MFA Step-up: Kernel has `aal2` TOTP challenge validation and `StepUpDialog` in frontend.
  - Audit logging: Kernel provides `AuditPort.record` writing to `app.audit_event`.
- **Missing Functionality & Gaps:**
  - **Endpoints Absent:** `POST /v1/report-schedules`, `POST /v1/exports`, and `GET /v1/exports/{id}` do not exist.
  - **Database Entity Absent:** `ENT-111 (export_job)` is not defined in any migration.
  - **Permissions Absent:** Neither `report.schedule` nor `export.run` exists in `packages/contracts/src/permissions.ts` (`PERMISSION_CODES`) or database role grants.
  - **Storage & Presigned URLs Absent:** No integration exists with AWS S3 / Cloudflare R2 / Supabase Storage to store generated CSV/Excel files or issue expiring download URLs.
  - **Expiry Enforcement Absent:** No 24-hour cleanup cron exists for exported files.
  - **Dependency Blocker:** `MOD-IMP` is completely unbuilt and deferred.

---

## 4. Cross-Module and Security Assessment Matrix

| Security & Cross-Module Requirement | Specification Requirement | Repository Evidence & Verification | Status |
|---|---|---|---|
| **`report.read` Permission & Scoping** | Enforced on all reporting and metric read endpoints; respects role jurisdiction | Verified in `ReportingService.requireReportRead`. Branch managers restricted to assigned branch (403 returned on mismatch). | **IMPLEMENTED AND VERIFIED** |
| **`report.manage` Permission** | Restricts projection refreshes and reporting configuration to privileged administrators | Verified in `M-031` and `apps/api/test/reporting.spec.ts:TC-RPT-014`. Users with only `report.read` are rejected with 403. | **IMPLEMENTED AND VERIFIED** |
| **ROLE-ANALYST Aggregate-Only Access** | Receives aggregated summaries only; zero loan-level PII or KYC documents exposed | Verified in `ReportingService.getTeamPerformanceDashboard`. Endpoints return only counts, sums, and percentages. | **IMPLEMENTED AND VERIFIED** |
| **`report.schedule` Permission** | Required for scheduling recurring reports; validates recipient jurisdiction | Absent from `PERMISSION_CODES` and database seeds. | **NOT IMPLEMENTED** |
| **`export.run` Permission & Scoping** | Required for record-level data exports with role-based scope boundaries | Absent from `PERMISSION_CODES` and database seeds. | **NOT IMPLEMENTED** |
| **MOD-ACL Scope Enforcement** | Enforces tenant and branch boundaries on drill-downs and leaderboards | Parameterized scope validation enforces caller's `allowedBranchIds` in `ReportingService`. | **IMPLEMENTED AND VERIFIED** |
| **MOD-IMP & MOD-AUD Dependencies** | Relies on `MOD-IMP` for export handling and `MOD-AUD` for logging | `MOD-AUD` is active (`app.audit_event`). `MOD-IMP` is completely deferred. | **PARTIALLY BLOCKED (MOD-IMP Deferred)** |
| **Outbox Relay for Projections** | Projections continuously updated from outbox events | `app.outbox_event` records events, but outbox relay worker (`TASK-403`) is unbuilt. | **BLOCKED (TASK-403 Deferred)** |
| **Tenant Isolation & RLS** | All reporting rows contain `tenant_id`; RLS enabled and fails closed | Verified by `tools/verify-migrations.ts` and `apps/api/test/reporting.pg.int.spec.ts`. All counts return 0 without session tenant. | **IMPLEMENTED AND VERIFIED** |
| **BYPASSRLS Prohibition** | Reporting and application database roles must not hold `BYPASSRLS` | Verified by `tools/verify-migrations.ts` assertion (b). Passes with exit code 0. | **IMPLEMENTED AND VERIFIED** |
| **Audit Logging & Retention** | Administrative modifications and export runs audited under `R-AUD` / `R-OPS` | Target lifecycle audited. Metric registry updates and export actions lack audit logging because entities do not exist. | **PARTIALLY IMPLEMENTED** |
| **Step-Up MFA for Record Exports** | Calling record-level export requires elevated `aal2` TOTP session | Kernel supports MFA step-up verification, but export endpoint and permission are unbuilt. | **INFRASTRUCTURE PRESENT / INTEGRATION MISSING** |
| **24-Hour File Expiry & Presigned URLs** | Export files expire in 24 hours; download URLs expire automatically | No object storage bucket, presigned URL generator, or expiration lifecycle exists. | **NOT IMPLEMENTED** |
| **Daily Control Totals (FR-RPT-008)** | Daily automated reconciliation between reporting projections and OLTP source data | No automated reconciliation cron or control-total comparison logic exists. | **NOT IMPLEMENTED** |

---

## 5. Verification Commands Executed and Results

All checks were executed directly against the active repository without modifying any application code or configuration:

### 5.1 Typecheck Verification
```bash
npm run typecheck
```
- **Result:** Exit code **`0`**. All 6 workspaces (`@dsa/api`, `@dsa/web`, `@dsa/bre-core`, `@dsa/contracts`, `@dsa/kernel`, `@dsa/tools`) compile cleanly without TypeScript errors.

### 5.2 API Test Suite Verification
```bash
npm test -w @dsa/api
```
- **Result:** Exit code **`0`**. 31 test files passed, **406/406 unit and contract tests passed**.
- Includes `test/reporting.spec.ts` (16 tests covering `TC-RPT-001` through `TC-RPT-016`).

### 5.3 Live PostgreSQL Integration Test Verification
```bash
npm run test:int -- test/reporting.pg.int.spec.ts test/targets.pg.int.spec.ts
```
- **Result:** Exit code **`0`**. 2 test files passed, **10/10 tests passed** against live Supabase PostgreSQL.
- Verifies `app.metric_definition`, `app.rpt_daily_operational_summary` RLS isolation, fail-closed isolation, and `report.manage` permissions.

### 5.4 Database Verification Suite
```bash
npm run db:verify
```
- **Result:** Exit code **`0`**. 5/5 automated database checks passed:
  - `[PASS]` RLS lint (zero unprotected tables)
  - `[PASS]` No DELETE privilege for `dsa_app` anywhere
  - `[PASS]` Tenant table allow-list validation
  - `[PASS]` Supabase exposure check (schema `app` inaccessible to anon/authenticated)
  - `[PASS]` Fail-closed check (every table count returns 0 without `app.tenant_id`)

### 5.5 ESLint on Reporting Workspaces
```bash
npx eslint apps/api/src/modules/reporting apps/web/src/features/performance packages/contracts/src/reporting.ts
```
- **Result:** Exit code **`0`**. **0 errors, 0 warnings** in all existing reporting code.

---

## 6. Key Architecture Blockers & Open Questions

Prior to authorizing full implementation of `MOD-RPT` under `TASK-414`, the following technical and business blockers must be formally resolved:

1. **Infrastructure Blocker — Read Replica vs. Single Node:**
   - *Question for Lead Architect / DevOps:* Does the production environment budget for a dedicated PostgreSQL read replica, or should the reporting projections continue to reside in schema `app` on the primary instance with strict connection pooling?
2. **Infrastructure Blocker — Event Relay (`TASK-403`):**
   - *Question for Core Platform Lead:* When will the outbox event relay worker (`TASK-403`) be deployed to transport `app.outbox_event` records into message queues or projection handlers?
3. **Storage Blocker — Object Storage Provider:**
   - *Question for Infrastructure Lead:* What S3-compatible storage bucket (Supabase Storage, Cloudflare R2, or AWS S3) will be provisioned for `ENT-111` export jobs, and what IAM policies govern 24-hour file expiration?
4. **Governance Blocker — Competitive Leaderboard Rules ([ADR-012](docs/adr/ADR-012-leaderboard-scoring-policy.md)):**
   - *Question for Business & Risk Committee:* All 9 scoring, quality penalty, and tie-breaking decisions in `ADR-012` remain unapproved. Scoring cannot be activated until formal committee sign-off is recorded.
5. **Security Contract Blocker — Permission Expansion:**
   - *Question for Security Architect:* Adding `report.schedule` and `export.run` permissions requires formal updates to `packages/contracts/src/permissions.ts`, database grants, and role-mapping matrices.

---

## 7. Final Implementation Readiness Conclusion

### Overall Verdict: **`DEFERRED — IMPLEMENTATION AUTHORIZATION REQUIRED`**

- **Ready for Immediate Use:** The existing operational reporting subset (`API-RPT-001`, `API-RPT-002`, `M-029`, `M-031`, Team Performance Dashboard, Target matching, and unranked Leaderboard) is stable, fully tested, and verified for production use within `MOD-PERF`.
- **Not Ready for Full Delivery:** The enterprise capabilities of `MOD-RPT` (Submodules `SUB-RPT.01` through `SUB-RPT.05`: full metric registry with formula JSONB, read replica, outbox projection workers, report catalogue runner, scheduled distributions, and S3 file exports) are **completely deferred and unbuilt**.
- **Recommendation:** Keep `TASK-414` formally deferred. When authorized by the product owner, schedule implementation in two sequential phases:
  - *Phase 1:* Asynchronous projection worker and event-driven pipeline (depends on `TASK-403`).
  - *Phase 2:* Report catalogue, S3 exports, and scheduling (depends on `MOD-IMP` and storage provisioning).
