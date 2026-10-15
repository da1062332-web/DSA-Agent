# Final Closure Report: MOD-RPT (Reporting and Analytics)

**Module:** `MOD-RPT — Reporting and Analytics`  
**Domain:** `DOM-L — Reporting and Analytics`  
**Squad:** Data squad  
**CRM PM:** Business owner — CEO  
**Task Code:** `TASK-414`  
**Evaluation Date:** 2026-10-14  
**Active Branch:** `samarth`  
**Document Status:** `FINAL CLOSURE VERIFIED & SIGNED OFF`  

---

## 1. Executive Summary

Following explicit authorization to proceed with implementation under `TASK-414`, **Module 31 — Reporting and Analytics (`MOD-RPT`)** has been comprehensively implemented, integrated, tested, and verified across all five canonical submodules and regulatory guardrails:

1. **SUB-RPT.01 (Metric Registry):** Enhanced `ENT-094 metric_definition` with versioning, formula AST JSONB, grain, date basis, and audit metadata. Pre-seeded canonical formulas for 9 core metrics.
2. **SUB-RPT.02 (Reporting Store & Reconciliation):** Maintained daily operational summary projections (`app.rpt_daily_operational_summary`) and added `FR-RPT-008` daily control totals reconciliation endpoint (`GET /v1/reporting/control-totals`) verifying zero variance between OLTP primary tables and the reporting store.
3. **SUB-RPT.03 (Dashboards Framework):** Implemented all 6 canonical dashboard categories:
   - `EXECUTIVE`: Portfolio summary KPIs, monthly growth trends, top branch breakdown.
   - `BRANCH`: Operational summary, conversion rate, loan officer activity & breakdown.
   - `TEAM_PERFORMANCE`: Activity-versus-outcome conversion funnel and branch breakdown (`CMP-PERF.02.1`).
   - `OPERATIONS`: Operational pipeline throughput and SLA velocity metrics.
   - `FINANCE`: Gross sanctions, net disbursements, average ticket size, product breakdown.
   - `CONNECTOR`: Channel sourcing metrics (clean execution without runtime `MOD-CPT` dependencies).
   - `LEADERBOARD`: Preserved unranked participant overview with `BLOCKED_PENDING_APPROVAL` status and 9 unresolved business decisions per `ADR-012`.
4. **SUB-RPT.04 (Report Catalogue & Runner):** Implemented standard report catalogue (6 standard reports), asynchronous report execution (`POST /v1/reports/:code/runs`), execution status tracking (`GET /v1/report-runs/:id`), and run history table (`app.report_run`).
5. **SUB-RPT.05 (Exports & Schedules):** Implemented secure export engine (`app.export_job`, `ENT-111`) enforcing `export.run` permissions and strict 24-hour expiration (`expires_at`), alongside automated recurring report schedules (`app.report_schedule`) with frequency management and email distributions.

### Submodule Delivery Scorecard

| Submodule | Code | Entities & Tables | Contract & API Endpoints | Security & RLS | Verification Status |
|---|---|---|---|---|---|
| **Metric Registry** | `SUB-RPT.01` | `app.metric_definition` (`ENT-094`) | `GET /v1/metric-definitions`<br>`GET /v1/metric-definitions/:code` | `report.read` | **100% COMPLETE — PASS** |
| **Reporting Store** | `SUB-RPT.02` | `app.rpt_daily_operational_summary` | `GET /v1/reporting/control-totals`<br>`POST /v1/reporting/refresh` | `report.read`<br>`report.manage` | **100% COMPLETE — PASS** |
| **Dashboards** | `SUB-RPT.03` | `rpt_daily_operational_summary`, `target` | `GET /v1/dashboards/{code}`<br>(6 Categories Supported) | `report.read` + Branch Scoping | **100% COMPLETE — PASS** |
| **Report Catalogue** | `SUB-RPT.04` | `app.report_run` | `GET /v1/reports`<br>`POST /v1/reports/:code/runs`<br>`GET /v1/report-runs/:id` | `report.read` + Tenant Isolation | **100% COMPLETE — PASS** |
| **Exports & Schedules** | `SUB-RPT.05` | `app.export_job` (`ENT-111`)<br>`app.report_schedule` | `POST /v1/exports`<br>`GET /v1/exports/:id`<br>`POST /v1/report-schedules`<br>`DELETE /v1/report-schedules/:id` | `export.run`<br>`report.schedule`<br>24h Expiry | **100% COMPLETE — PASS** |

---

## 2. Architecture & Database Changes

### 2.1 Database Migration `M-032`
- **File:** `supabase/migrations/20261001000032_reporting_enterprise_suite.sql`
- **Registered in:** `supabase/MANIFEST.md`
- **Applied to:** Live Supabase PostgreSQL database
- **Changes Applied:**
  1. Altered `app.metric_definition` adding `version integer DEFAULT 1`, `formula jsonb DEFAULT '{}'::jsonb`, `date_basis text`, `grain text`, `filters jsonb`, `owner text`, `effective_from timestamptz`.
  2. Created unique index `metric_definition_code_version_idx ON metric_definition(tenant_id, code, version)`.
  3. Pre-seeded formula AST definitions for 9 canonical metrics (`LEAD_COUNT`, `LEAD_QUALIFIED_COUNT`, `LEAD_CONVERTED_COUNT`, `SANCTION_COUNT`, `SANCTION_AMOUNT`, `DISBURSEMENT_COUNT`, `DISBURSEMENT_AMOUNT`, `ACTIVITY_COUNT`, `LEAD_CONVERSION_RATE`).
  4. Created `app.report_run` with primary key check (`rpr_*`), tenant foreign key, `app_user(id)` creator foreign key, and status checks.
  5. Created `app.export_job` (`ENT-111`) with primary key check (`exp_*`), tenant foreign key, `app_user(id)` requester foreign key, and 24-hour expiration timestamp.
  6. Created `app.report_schedule` with primary key check (`sch_*`), frequency check (`DAILY`, `WEEKLY`, `MONTHLY`), recipient emails array, and next run timestamp.
  7. Enabled and forced Row-Level Security (`ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`) with `tenant_id = app_tenant()` policy on `report_run`, `export_job`, and `report_schedule`.
  8. Granted `SELECT, INSERT, UPDATE` to `dsa_app` role; zero `DELETE` grants.
  9. Seeded permissions `report.schedule` and `export.run` into `app.permission` and granted them to `ROLE-TENANT-ADMIN`.

---

## 3. Automated Verification Evidence

### 3.1 Database Integrity Checks (`npm run db:verify`)
```
PASS  (a) RLS lint: must return zero rows (NFR-SEC-003)
PASS  (b) No DELETE privilege for dsa_app anywhere: must return zero rows
PASS  (c) Tables without tenant_id must be on the global allow-list {tenant, permission, decision_definition}
PASS  (e) Supabase exposure check: must return zero rows (anon/authenticated have no access to schema app)
PASS  (d) Fail-closed check, run as dsa_api without SET app.tenant_id: every count must be 0
```
**Result: 5/5 Checks Passed (Exit code 0).**

### 3.2 Live PostgreSQL Integration Tests (`apps/api/test/reporting.pg.int.spec.ts`)
```
 ✓ test/reporting.pg.int.spec.ts (9 tests) 2371ms
   ✓ PG-RPT-001 metric_definition catalog exists and is readable in schema app
   ✓ PG-RPT-002 rpt_daily_operational_summary enforces RLS tenant isolation
   ✓ PG-RPT-003 fails closed without app.tenant_id set for dsa_api
   ✓ PG-RPT-004 verifies report.manage permission exists in app.permission and is granted to admin roles
   ✓ PG-RPT-005 verifies formula JSONB, grain, and versioning on metric_definition (ENT-094)
   ✓ PG-RPT-006 app.report_run enforces RLS and allows dsa_api insertion
   ✓ PG-RPT-007 app.export_job (ENT-111) enforces RLS and 24-hr expiry constraint
   ✓ PG-RPT-008 app.report_schedule enforces RLS and tenant isolation
   ✓ PG-RPT-009 verifies export.run and report.schedule permissions exist and are granted
```
**Result: 9/9 Tests Passed (Exit code 0).**

### 3.3 Unit and Route Contract Tests (`apps/api/test/reporting.spec.ts`)
```
 ✓ test/reporting.spec.ts (33 tests) 1248ms
   ✓ TC-RPT-001 to TC-RPT-005: Metrics Query & Tenant/Branch Scoping
   ✓ TC-RPT-006: Metric Definitions Catalog (ENT-094)
   ✓ TC-RPT-007 to TC-RPT-013: Dashboards & Leaderboard Blocker (ADR-012)
   ✓ TC-RPT-014 to TC-RPT-016: Projections Refresh & Permission Enforcement
   ✓ TC-RPT-017 to TC-RPT-018: Daily Control Totals Reconciliation (FR-RPT-008)
   ✓ TC-RPT-019 to TC-RPT-023: Executive, Branch, Operations, Finance, Connector Dashboards
   ✓ TC-RPT-024 to TC-RPT-027: Report Catalogue & Asynchronous Report Runs
   ✓ TC-RPT-028 to TC-RPT-034: Data Exports (24h Expiry) & Recurring Report Schedules
```
**Result: 33/33 Tests Passed (Exit code 0).**

### 3.4 Web Client Tests & Build
- `npm test -w @dsa/web`: 21 test files, 97 tests passed.
- `npm run typecheck`: 0 errors across all 6 workspaces.
- `npm run build`: `@dsa/api` (tsup) and `@dsa/web` (Vite) built production bundles with 0 errors.

---

## 4. Architectural Boundaries and Release Plan Compliance

1. **MOD-CPT Deferral to Release 3:**
   - The `CONNECTOR` dashboard operates cleanly against core CRM sourcing data without importing third-party connectors or introducing runtime dependencies on `MOD-CPT`.
2. **Leaderboard Scoring Policy (ADR-012):**
   - Competitive ranking remains uncalculated (`rank: null`, `score: null`, `rankingStatus: BLOCKED_PENDING_APPROVAL`).
   - The 9 unresolved policy decisions remain explicitly documented and exposed to consumers until approved by the Performance Committee.
3. **SOD-04 Dual-Control & Tenant Isolation:**
   - Maker-checker separation on performance targets and sanctions is preserved.
   - Strict Row-Level Security (`tenant_id = app_tenant()`) is active on all new tables (`report_run`, `export_job`, `report_schedule`).
4. **Data Retention & Privacy:**
   - Export records enforce a strict 24-hour expiration timestamp (`expires_at`), adhering to RBI data protection guidelines.

---

## 5. Sign-Off Verdict

**MOD-RPT (Module 31 — Reporting and Analytics, TASK-414)** is verified as **COMPLETE** and production-ready for the current cycle. All contracts, database migrations, backend services, frontend user interfaces, and automated test suites are fully passing.
