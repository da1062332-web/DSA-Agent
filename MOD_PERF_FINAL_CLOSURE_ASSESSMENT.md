# MOD-PERF Final Closure Assessment

**Project:** DSA CRM for NBFCs  
**Domain:** `DOM-I — Team Hierarchy and Performance`  
**Module:** `MOD-PERF`  
**Evaluation Date:** 2026-10-14  
**Active Branch:** `samarth`  
**Evaluation Lead:** Senior Full-Stack Engineer, Domain Architect, and QA Automation Lead  
**Document Status:** `FINAL CLOSURE ASSESSMENT`  

---

## 1. Executive Summary

This document provides the definitive final closure assessment of `MOD-PERF` (Team Hierarchy and Performance) and its prerequisites (`MOD-RPT`, `TASK-428`, `TASK-414`, and `MOD-ORG`) within the DSA CRM codebase.

### Overall Assessment Verdict: **`PARTIALLY COMPLETE`**

- **SUB-PERF.01 (Targets):** **`COMPLETE`** — Fully implemented, secured with dual-control separation of duties (`SOD-04`), audited, and verified against hosted PostgreSQL.
- **SUB-PERF.02 (Performance Dashboards):** **`COMPLETE`** — Fully implemented using canonical `MOD-RPT` reporting APIs (`API-RPT-001`, `API-RPT-002`), displaying 5-stage conversion funnels, target-vs-actual matching, branch scoping, and aggregate-only privacy.
- **SUB-PERF.03 (Leaderboards):** **`PARTIALLY COMPLETE`**
  - **Reporting Infrastructure & Display:** **`COMPLETE`** — Operational participant metrics (Leads Handled, Sanctions Issued, Disbursed Amount, Conversion Rate) displayed with `INSUFFICIENT_DATA` guardrails for low-volume participants (< 10 leads or < 5 sanctions).
  - **Competitive Ranking Logic:** **`BLOCKED — APPROVAL REQUIRED`** — Safely disabled (`rank: null`, `score: null`). Zero approved scoring rules exist in the repository. Formal approval package [ADR-012](docs/adr/ADR-012-leaderboard-scoring-policy.md) is recorded with status `PROPOSED — NOT APPROVED` awaiting committee sign-off.
- **MOD-CPT (Connectors):** **`DEFERRED TO RELEASE 3`** — Confirmed zero connector endpoints or dependencies introduced.

---

## 2. Verification of Prerequisites: TASK-428, TASK-414, and MOD-ORG

| Prerequisite | Status in Codebase & Manifest | Verification Details & Evidence |
|---|---|---|
| **TASK-428** (MOD-PERF SUB-PERF.01 Targets) | **`COMPLETED`** | Registered in [supabase/MANIFEST.md](supabase/MANIFEST.md#L26) under Migration `M-028` (`20261001000028_targets.sql`). Implemented in `apps/api/src/modules/crm/targets/` and `apps/web/src/features/targets/`. 17 API unit/contract tests and 6 live PostgreSQL tests pass. |
| **TASK-414** (MOD-RPT Canonical Reporting) | **`COMPLETED`** | Registered in [supabase/MANIFEST.md](supabase/MANIFEST.md#L27) under Migration `M-029` (`20261001000029_reporting.sql`) and `M-036` (`20261001000036_report_manage_permission.sql`). Implemented in `apps/api/src/modules/reporting/` and consumed by `apps/web/src/features/performance/`. 16 API tests and 4 live PostgreSQL tests pass. |
| **MOD-ORG** (Platform & Organizational Hierarchy) | **`COMPLETED`** | Implemented under Module 2 in `apps/api/src/modules/platform/` (`organisation.ts`, `branches.ts`, `teams.ts`, `queues.ts`). Verified in `apps/api/test/platform.spec.ts`. Supplies organizational and branch scoping consumed by target and reporting authorization. |

---

## 3. Submodule Verification against Specification

### 3.1 SUB-PERF.01 — Targets (`COMPLETE`)

- **Component:** `CMP-PERF.01.1` Target Editor ([TargetsPage.tsx](apps/web/src/features/targets/TargetsPage.tsx), [TargetManagementPanel.tsx](apps/web/src/features/targets/TargetManagementPanel.tsx), [CreateTargetDialog.tsx](apps/web/src/features/targets/CreateTargetDialog.tsx)).
- **API-PERF-001 (`POST /v1/targets`):**
  - Requires `target.manage` permission (tested: 403 returned on unauthorized principal, `TC-PERF-002`).
  - Requires `Idempotency-Key` header (tested: 422 returned on missing header, `TC-PERF-003`; identical cached replay returns 201 with identical target, `TC-PERF-004`).
  - Supports creation and revision (revising approved target creates version 2 in `PENDING_APPROVAL`, `TC-PERF-010`).
  - Validates period (`YYYY-MM`, `YYYY-Q#`), dimension type (`ORGANIZATION`, `BRANCH`, `USER`), canonical metric code, and non-negative target value (`TC-PERF-005`, `TC-PERF-006`).
  - Enforces organizational scope and records creator (`created_by`).
- **API-PERF-002 (`GET /v1/targets`):**
  - Requires `report.read` permission.
  - Returns targets alongside actuals when reporting projection is available; preserves `actualValue: null` and `achievementPercentage: null` without fabricating data when actuals are missing (`TC-PERF-013`).
  - Applies tenant isolation (404 across tenant boundary, `TC-PERF-011`) and branch scoping (only allowed branch targets returned, `TC-PERF-012`).
- **API-PERF-003 (`POST /v1/targets/{id}/approval`):**
  - Requires `target.manage` permission.
  - Verifies target exists and belongs to caller's tenant.
  - **Separation of Duties (`SOD-04`):** Self-approval by creator is rejected with 403 `SOD_VIOLATION` at application layer (`TC-PERF-007`) and rejected by PostgreSQL check constraint `target_creator_approver_diff_chk` (`PG-PERF-002`).
  - Approval by different authorized user succeeds and records approver (`TC-PERF-008`).
  - Optimistic concurrency locking enforced via `lock_version` and `If-Match` header; stale version returns 409 `VERSION_CONFLICT` (`TC-PERF-009`).
  - Approval action writes transactional audit event `TARGET_APPROVED` to `app.audit_event` (`PG-PERF-004`).
- **Database Entity `ENT-037` (`app.target`):**
  - Schema: `period`, `dimension_type`, `dimension_id`, `metric_code`, `target_value` (numeric), `version`, `approved_by`, `status`, `created_by`, `lock_version`, `tenant_id`.
  - Uniqueness: Partial unique index `target_current_approved_idx` prevents duplicate active targets for the same `(tenant_id, period, dimension_type, dimension_id, metric_code)` (`PG-PERF-001`).
  - Security: Row-Level Security policy `target_tenant_isolation` enforced (`PG-PERF-003`).

### 3.2 SUB-PERF.02 — Performance Dashboards (`COMPLETE`)

- **Component:** `CMP-PERF.02.1` Team Dashboard ([PerformanceDashboardPage.tsx](apps/web/src/features/performance/PerformanceDashboardPage.tsx)).
- **Canonical API Reuse:** Consumes `GET /v1/dashboards/TEAM_PERFORMANCE` (`API-RPT-002`) and `GET /v1/metrics` (`API-RPT-001`). Zero duplicate reporting endpoints created.
- **Activity vs. Outcome Funnel:** Displays 5-stage operational progression (`Leads Created` → `Qualified Leads` → `Converted Leads` → `Sanctions Issued` → `Disbursements`) with stage-to-stage conversion efficiency percentages (`TC-RPT-007`).
- **Target vs. Actual Matching:** Pairs operational actuals with approved target records (`ENT-037`) for Leads, Sanctions, and Disbursements. Displays achievement chips and progress bars; displays `'None'` without fabricating percentages when targets are absent.
- **Freshness & Period Boundaries:** Returns deterministic `asOf` UTC timestamp metadata and computes UTC boundaries for monthly (`YYYY-MM`) and quarterly (`YYYY-Q#`) periods (`TC-RPT-002`).
- **Division-by-Zero Safeguard:** Calculates conversion rates using `NULLIF(lead_count, 0)` with safe fallback.
- **Branch Scope & Drill-Down Security:**
  - Branch-scoped users requesting out-of-scope branches receive 403 `FORBIDDEN` (`TC-RPT-010`).
  - Users without explicit branch parameters receive data automatically scoped to their assigned branch.
- **Privacy & Aggregate-Only Access:** Reporting endpoints return aggregate counts and sums. Zero borrower PII, loan account numbers, or KYC documents are exposed (`TC-PERF-033`).

### 3.3 SUB-PERF.03 — Leaderboards (`PARTIALLY COMPLETE`)

- **Component:** `CMP-PERF.03.1` Leaderboard ([LeaderboardPage.tsx](apps/web/src/features/performance/LeaderboardPage.tsx)).
- **Canonical API Exposure:** Consumes `GET /v1/dashboards/LEADERBOARD` (`API-RPT-002`).
- **Operational Metrics Display:** Displays real operational metrics (Leads Handled, Sanctions Issued, Disbursed Amount, Conversion Rate) for participants.
- **Insufficient-Data Guardrails:** Participants with fewer than 10 leads or fewer than 5 sanctions are tagged with `guardrailStatus: 'INSUFFICIENT_DATA'` rather than fabricating scores or assigning zero ranks (`TC-PERF-031`, `TC-RPT-009`).
- **Disabled Competitive Ranking:**
  - `rankingStatus`: `'BLOCKED_PENDING_APPROVAL'`
  - All participant entries return `rank: null` and `score: null`.
  - Frontend renders a prominent governance warning banner informing users that ranking is disabled pending committee approval.
- **Branch Authorization:** Branch-scoped users requesting leaderboards for unassigned branches receive 403 `FORBIDDEN` (`TC-RPT-011`); unparameterized requests default to the caller's assigned branch (`TC-RPT-012`).
- **Cross-Tenant Isolation:** Verified cross-tenant queries return zero records from foreign tenants (`TC-RPT-013`).

---

## 4. Inspection of ADR-012: The Nine Unapproved Policy Decisions

Inspection of [docs/adr/ADR-012-leaderboard-scoring-policy.md](docs/adr/ADR-012-leaderboard-scoring-policy.md) confirms that all nine scoring policy decisions remain with status `PROPOSED — NOT APPROVED`:

| # | Governance Decision Dimension | Proposed Specification in ADR-012 | Designated Decision Owner | Current Policy Status |
|---|---|---|---|---|
| **1** | **Scorecard Weights** | Activity: 20%, Outcomes: 50%, Quality: 30% | Product Head & Sales Strategy | `PROPOSED — NOT APPROVED` |
| **2** | **Minimum Volume Threshold** | Minimum 10 Leads Handled AND 5 Closed Outcome Records per period; below threshold labeled `INSUFFICIENT_DATA` | Product Head | `PROPOSED — NOT APPROVED` |
| **3** | **Early Default Rate (EDR) Penalty** | EDR > 2.0% on 90-day portfolio: -15% score haircut if 2-4% EDR; disqualification if > 4% EDR | Head of Credit & Risk | `PROPOSED — NOT APPROVED` |
| **4** | **First Payment Default (FPD) Rule** | Zero tolerance: immediate disqualification from leaderboard awards on confirmed FPD | Credit Policy Committee | `PROPOSED — NOT APPROVED` |
| **5** | **Application Rejection Rate Haircut** | Declines > 20%: -10% deduction from Outcome score | Operations Head | `PROPOSED — NOT APPROVED` |
| **6** | **Deterministic Tie-Breaking** | 1st: Quality Score, 2nd: Outcome Score, 3rd: Shared Rank | Product Head | `PROPOSED — NOT APPROVED` |
| **7** | **Role & Peer Visibility** | Full name/volume visible within own branch; peer records anonymized outside branch | Compliance & HR | `PROPOSED — NOT APPROVED` |
| **8** | **Product Normalization** | Target-relative achievement percentage used for scoring rather than raw rupee volume (LAP vs Business Loans) | Sales Strategy | `PROPOSED — NOT APPROVED` |
| **9** | **Cycle Reset & Carry-Over** | Independent monthly and quarterly cycles; zero carry-over of rank or score between periods | Performance Committee | `PROPOSED — NOT APPROVED` |

---

## 5. Security Controls, Governance, and Database Integrity Evidence

### 5.1 Target Creator-Approver Separation of Duties (`SOD-04`)
- **Application Layer:** `TargetService.approveTarget` verifies `target.createdBy !== ctx.principal.userId`, throwing 403 `SOD_VIOLATION` (`apps/api/test/targets.spec.ts:TC-PERF-007`).
- **Database Layer:** Check constraint `target_creator_approver_diff_chk` in `app.target` table prevents `approved_by = created_by` at the SQL level (`apps/api/test/targets.pg.int.spec.ts:PG-PERF-002`).

### 5.2 Tenant Isolation and RLS
- **PostgreSQL RLS:** Row-Level Security enabled on `app.target` and `app.rpt_daily_operational_summary`.
- **Fail-Closed Verification:** Queries executed as `dsa_api` without `app.tenant_id` set return 0 rows (`PG-RPT-003`, `PG-PERF-003`).
- **Database Exposure Check:** Verification confirms `anon` and `authenticated` Supabase roles have zero access to schema `app` (`tools/verify-migrations.ts` check e).

### 5.3 Least-Privilege Refresh Authorization
- `POST /v1/reporting/refresh` requires `report.manage` or `config.manage` permission (`M-031`).
- Callers possessing only `report.read` receive 403 `FORBIDDEN` (`TC-RPT-014`).

### 5.4 Audit Trail Integrity
- Target creation writes `TARGET_CREATED` audit event (`PG-PERF-004`).
- Target approval writes `TARGET_APPROVED` audit event (`PG-PERF-004`).
- Audit rows are written within the same database transaction to `app.audit_event` (Retention: `R-OPS`).

---

## 6. Discrepancy Analysis: Implementation Report vs. Actual Repository

An audit was conducted comparing [reports/qa/mod-perf-implementation-report.md](reports/qa/mod-perf-implementation-report.md), [reports/qa/mod-perf-test-cases.csv](reports/qa/mod-perf-test-cases.csv), and the actual codebase.

| Audit Dimension | Implementation Report Claim | Actual Repository State | Discrepancy Found? |
|---|---|---|---|
| **API Test Suite Count** | 406 passed across 31 files | 406 passed across 31 files (`npm test -w @dsa/api`) | **None — Exact Match** |
| **Live PG Integration Test Count** | 10 passed across 2 files | 10 passed across 2 files (`npm run test:int -- test/reporting.pg.int.spec.ts test/targets.pg.int.spec.ts`) | **None — Exact Match** |
| **Web Frontend Test Count** | 96 passed across 20 files | 96 passed across 20 files (`npm test -w @dsa/web`) | **None — Exact Match** |
| **Database Verification Checks** | 5/5 checks passed | 5/5 checks passed (`npm run db:verify`) | **None — Exact Match** |
| **OpenAPI Specification** | Up to date in `openapi/openapi.yaml` | Matches endpoints and schemas (`npm run gen:openapi`) | **None — Exact Match** |
| **Workspace Typecheck** | 0 errors across 6 workspaces | 0 errors (`npm run typecheck`) | **None — Exact Match** |
| **Production Build** | `@dsa/api` and `@dsa/web` built | Build succeeds (`npm run build`) | **None — Exact Match** |
| **Git Tracking of QA Reports** | Reports documented in `reports/qa/` | `reports/` is listed in `.gitignore` (line 25), so reports exist locally on disk but are not tracked in git commits | **Documented Architecture Pattern** |
| **Repository ESLint Status** | All performance/reporting code clean | All MOD-PERF, MOD-RPT, and Targets files pass ESLint with 0 errors. Pre-existing lint errors exist in legacy modules (`lender-cases`, `users`, `tasks`) | **Documented Pre-existing Condition** |

---

## 7. Concrete Verification Command Outputs

All checks were executed directly against the workspace. Actual outputs and exit codes:

### 7.1 Workspace Typecheck
```
$ npm run typecheck
> dsa-crm@0.0.0 typecheck
> npm run typecheck --workspaces --if-present

> @dsa/api@0.0.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
> @dsa/web@0.0.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
> @dsa/bre-core@0.0.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
> @dsa/contracts@0.1.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
> @dsa/kernel@0.0.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
> @dsa/tools@0.0.0 typecheck (tsc -p tsconfig.json) -> Exit code 0
Exit code: 0
```

### 7.2 API Test Suite (`@dsa/api`)
```
$ npm test -w @dsa/api
> vitest run
 Test Files  31 passed (31)
      Tests  406 passed (406)
   Duration  11.00s
Exit code: 0
```

### 7.3 Live PostgreSQL Integration Tests
```
$ npm run test:int -- test/reporting.pg.int.spec.ts test/targets.pg.int.spec.ts
> vitest run --config vitest.int.config.ts test/reporting.pg.int.spec.ts test/targets.pg.int.spec.ts
 ✓ test/reporting.pg.int.spec.ts (4 tests) 835ms
 ✓ test/targets.pg.int.spec.ts (6 tests) 1342ms
 Test Files  2 passed (2)
      Tests  10 passed (10)
Exit code: 0
```

### 7.4 Web Test Suite (`@dsa/web`)
```
$ npm test -w @dsa/web
> vitest run
 Test Files  20 passed (20)
      Tests  96 passed (96)
   Duration  7.14s
Exit code: 0
```

### 7.5 Database Verification (`tools/verify-migrations.ts`)
```
$ npm run db:verify
> @dsa/tools@0.0.0 verify:migrations
PASS  (a) RLS lint: must return zero rows (NFR-SEC-003)
PASS  (b) No DELETE privilege for dsa_app anywhere: must return zero rows
PASS  (c) Tables without tenant_id must be on the global allow-list {tenant, permission, decision_definition}
PASS  (e) Supabase exposure check: must return zero rows (anon/authenticated have no access to schema app)
PASS  (d) Fail-closed check, run as dsa_api without SET app.tenant_id: every count must be 0
Exit code: 0
```

### 7.6 Production Build
```
$ npm run build
> @dsa/api@0.0.0 build (tsup): dist/server.js 791.82 KB
> @dsa/web@0.0.0 build (vite): dist/index.html 0.32 kB, dist/assets/index-D01bs6TF.js 1,293.32 kB
✓ built in 6.66s
Exit code: 0
```

### 7.7 ESLint on Changed Performance & Reporting Workspaces
```
$ npx eslint apps/api/src/modules/reporting apps/api/src/modules/crm/targets apps/web/src/features/performance apps/web/src/features/targets packages/contracts/src/reporting.ts packages/contracts/src/target.ts
Exit code: 0 (0 errors, 0 warnings)
```

---

## 8. Verified Completed vs. Outstanding Requirements

### 8.1 Verified Completed Requirements
1. **Target Management (`SUB-PERF.01`):** Complete target creation, revision, retrieval, and approval lifecycle (`API-PERF-001`, `002`, `003`).
2. **Dual Control (`SOD-04`):** Separation of duties enforced both in API service and PostgreSQL check constraint.
3. **Idempotency & Concurrency:** Target creation enforces `Idempotency-Key`; target approval enforces optimistic locking via `lock_version`.
4. **Audit Trail:** Target state transitions recorded in `app.audit_event`.
5. **Team Performance Dashboard (`SUB-PERF.02`):** Real-time activity-versus-outcome KPI cards, 5-stage funnel, and branch breakdown with target matching.
6. **Least-Privilege Projection Refresh:** `POST /v1/reporting/refresh` locked down with `report.manage` (`M-031`).
7. **Tenant Isolation & RLS:** All reporting and target queries isolated by tenant; verified fail-closed behavior.
8. **Branch Authorization:** Branch-scoped users restricted to authorized branches on all performance and leaderboard endpoints.
9. **Operational Leaderboard Display (`SUB-PERF.03`):** Real operational metrics displayed with `INSUFFICIENT_DATA` labeling for participants with < 10 leads or < 5 sanctions.
10. **Connector Deferral (`MOD-CPT`):** Confirmed deferred to Release 3 with zero connector dependencies.

### 8.2 Outstanding Requirements & Approval Dependencies
1. **Competitive Ranking Calculation (`SUB-PERF.03`):** Blocked pending formal approval of the 9 scoring decisions in [ADR-012](docs/adr/ADR-012-leaderboard-scoring-policy.md).
2. **Approval Committee:** Head of Product, Head of Credit & Risk, Sales Operations Head, Performance Committee.
3. **Shortest Next Action:** Following formal review and sign-off on [ADR-012](docs/adr/ADR-012-leaderboard-scoring-policy.md), activate composite scoring and rank calculations in `ReportingService.getLeaderboardDashboard`.
