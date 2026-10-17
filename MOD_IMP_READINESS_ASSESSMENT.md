# MOD-IMP — Import and Export Framework Readiness Assessment

**Module:** `MOD-IMP — Import and Export Framework`  
**Domain:** `DOM-O — Operations & Administration`  
**Squad:** Platform squad  
**MVP Owner:** None (Formally deferred under `TASK-413`)  
**Assessment Date:** 2026-10-14  
**Active Branch:** `samarth`  
**Assessment Type:** Readiness Assessment & Implementation Gap Analysis (Assessment Only — No Implementation Modifications)

---

## A. Executive Summary

### Overall Verdict: **NOT IMPLEMENTED**

The Import and Export Framework (`MOD-IMP`) remains **DEFERRED** under **`TASK-413`** and is **NOT IMPLEMENTED** in the DSA CRM codebase.

#### Detailed Evidence & Summary:

1. **SUB-IMP.01 (Import Framework): Completely Absent (0% Implemented).**
   - The required database entity `ENT-110 import_batch` does not exist in any Supabase migration or PostgreSQL table schema.
   - None of the required REST API endpoints (`POST /v1/imports`, `POST /v1/imports/{id}/mapping`, `POST /v1/imports/{id}/commit`, `POST /v1/imports/{id}/rollback`, `GET /v1/imports/{id}`) exist in Express routing, controllers, or OpenAPI specifications (`openapi/openapi.yaml`).
   - Neither the frontend wizard (`CMP-IMP.01.1`) nor the background worker (`CMP-IMP.01.2`) exists. In `apps/web/src/shell/Sidebar.tsx` (line 148), "Import and export" is configured with `task: 'MOD-IMP'` and explicitly rendered disabled with a `"Soon"` chip and tooltip `"Not built yet (MOD-IMP)"`.
   - Core domain entity tables (such as `lead` in migration `M-003`) lack `import_batch_id` foreign keys, rendering batch attribution and 24-hour rollback architecturally impossible in the current schema.

2. **SUB-IMP.02 (Export Framework): Architecturally Blocked / Incomplete Stub Only.**
   - While migration `M-032` (`20261001000032_reporting_enterprise_suite.sql`) created table `app.export_job` (`ENT-111`) and permission `export.run` under `MOD-RPT` / `TASK-414`, the existing implementation in `apps/api/src/modules/reporting/` is a synchronous, reporting-specific mock stub rather than an entity-agnostic bulk export engine.
   - **Step-Up Authentication is Absent:** `apps/api/src/modules/reporting/service.ts` does not invoke `deps.authz.requireStepUp(ctx, 900)` on `POST /v1/exports`, violating the core mandatory control for record exports.
   - **Asynchronous Worker Infrastructure is Missing:** The API immediately sets `status: 'COMPLETED'` with hardcoded `row_count: 120`. No background worker, queue (BullMQ/pg-boss), or job dispatcher exists in the repository.
   - **Object Storage is Absent / Disabled:** Supabase Storage is explicitly disabled in `supabase/config.toml` (`[storage] enabled = false`), and no S3/R2/Blob storage adapter or presigned URL generator is integrated.
   - **Phantom Download URLs:** The service generates a synthetic download URL `/v1/exports/${id}/download?exp=...`, but no corresponding `/download` route exists in Express, returning `404 Not Found`. `downloaded_at` is never recorded, and no 24-hour file cleanup job exists.
   - **Zero Data Masking & Audit Logging:** No masking engine is applied to export payloads, and no audit events are written to `app.audit_event`.
   - **Authorization Bypass:** Branch managers (`ROLE-BRANCH-MGR`) can bypass branch-scoping by submitting `scopeType: 'TENANT'`.

Consequently, `MOD-IMP` cannot be marked complete, cannot be enabled in production, and must remain formally deferred under `TASK-413` until infrastructure dependencies (object storage and asynchronous background workers) are provisioned and approved.

---

## B. Submodule Status Matrix

| Submodule                         | Spec Status                               | Verified Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Missing Requirements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dependencies                                                                            | Recommended Action                                                                                                                          |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **SUB-IMP.01** — Import Framework | **Deferred** (`TASK-413`, Priority P0/R1) | **0% — NOT IMPLEMENTED**.<br>Frontend sidebar entry disabled with `"Soon"` / `"Not built yet (MOD-IMP)"` tooltip ([Sidebar.tsx:L148-L195](file:///d:/DSA-CRM/DSA-Agent/apps/web/src/shell/Sidebar.tsx#L148-L195)).                                                                                                                                                                                                                                                                                                | • `ENT-110 import_batch` table & RLS policies.<br>• `import_batch_id` on target entities (`lead`, `customer`, etc.).<br>• Endpoints: `POST /v1/imports`, `POST /v1/imports/:id/mapping`, `POST /v1/imports/:id/commit`, `POST /v1/imports/:id/rollback`, `GET /v1/imports/:id`.<br>• Import wizard component (`CMP-IMP.01.1`).<br>• Asynchronous import worker (`CMP-IMP.01.2`).<br>• Multipart file upload middleware & quarantine storage.<br>• Column mapping engine, validation report generator, and preview.<br>• 24-hour batch rollback logic & 7-day source file retention.                                                                            | `TASK-413`<br>Approved Object Storage<br>Async Queue / Worker<br>Target Entity Schemas  | Maintain **DEFERRED** status.<br>Await formal un-deferral and architecture approval for storage and async processing.                       |
| **SUB-IMP.02** — Export Framework | **Deferred** (`TASK-413`, Priority P0/R1) | **PARTIALLY PRESENT AS MOCK IN MOD-RPT**.<br>• `ENT-111 export_job` created in `M-032` ([migration 32:L135-151](file:///d:/DSA-CRM/DSA-Agent/supabase/migrations/20261001000032_reporting_enterprise_suite.sql#L135-L151)).<br>• `export.run` permission seeded ([permissions.ts:L57](file:///d:/DSA-CRM/DSA-Agent/packages/contracts/src/permissions.ts#L57)).<br>• Routes `POST /v1/exports` & `GET /v1/exports/:id` mounted in `reporting/router.ts`.<br>• Frontend Export tab present in `ReportingPage.tsx`. | • Step-up MFA verification (`aal2` TOTP ≤ 900s) on `POST /v1/exports`.<br>• Real asynchronous worker execution (currently synchronous mock).<br>• Generic, entity-agnostic record extraction (currently report-specific).<br>• Sensitive data masking engine (Aadhaar, PAN, phone, account).<br>• Object storage provider and presigned URL generation.<br>• Actual `/v1/exports/:id/download` route (currently 404).<br>• 24-hour physical storage cleanup worker / TTL lifecycle.<br>• Updating `downloaded_at` timestamp on download.<br>• Audit event creation (`MOD-AUD`).<br>• Enforcement preventing branch managers bypassing scope via `TENANT` flag. | `TASK-413`<br>`MOD-ACL`<br>`MOD-AUD`<br>Approved Object Storage<br>Async Queue / Worker | Maintain **DEFERRED** status for generic exports.<br>Remediate security flaws (MFA, scoping, audit) in existing reporting export endpoints. |

---

## C. API and Database Inventory

### 1. Endpoints & API Contracts

| Route / Contract                 | Spec Reference           | Current Status in Repository    | File Location                                                                                                               | Gaps & Deficiencies                                                                                                                                               |
| -------------------------------- | ------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/imports`               | SUB-IMP.01               | **ABSENT**                      | N/A                                                                                                                         | Endpoint does not exist. No multipart upload handler, profile parser, or idempotency verification.                                                                |
| `POST /v1/imports/{id}/mapping`  | SUB-IMP.01               | **ABSENT**                      | N/A                                                                                                                         | Endpoint does not exist. No column mapping parser or preview generator.                                                                                           |
| `POST /v1/imports/{id}/commit`   | SUB-IMP.01               | **ABSENT**                      | N/A                                                                                                                         | Endpoint does not exist. No async commit orchestrator or validation report engine.                                                                                |
| `POST /v1/imports/{id}/rollback` | SUB-IMP.01               | **ABSENT**                      | N/A                                                                                                                         | Endpoint does not exist. No 24-hour rollback mechanism.                                                                                                           |
| `GET /v1/imports/{id}`           | SUB-IMP.01               | **ABSENT**                      | N/A                                                                                                                         | Endpoint does not exist. No batch status or validation report delivery.                                                                                           |
| `POST /v1/exports`               | SUB-IMP.02 / API-RPT-006 | **PARTIALLY PRESENT (MOD-RPT)** | [apps/api/src/modules/reporting/router.ts:L204](file:///d:/DSA-CRM/DSA-Agent/apps/api/src/modules/reporting/router.ts#L204) | Synchronous stub. Does not enforce step-up MFA. Generates hardcoded `rowCount: 120` without querying data. Fails to write audit logs. Allows branch scope bypass. |
| `GET /v1/exports/{id}`           | SUB-IMP.02 / API-RPT-007 | **PARTIALLY PRESENT (MOD-RPT)** | [apps/api/src/modules/reporting/router.ts:L222](file:///d:/DSA-CRM/DSA-Agent/apps/api/src/modules/reporting/router.ts#L222) | Returns `download_url: /v1/exports/${id}/download?...`, but download route does not exist. Does not log audit events.                                             |
| `GET /v1/exports/{id}/download`  | SUB-IMP.02               | **ABSENT (404)**                | N/A                                                                                                                         | Route is not registered in Express. Client receiving `download_url` cannot download any file. `downloaded_at` is never updated.                                   |

### 2. Database Entities & Schema Inventory

| Entity Code | Table Name     | Migration Reference                                                                                                                                                    | RLS & Security Status                                                                              | Fields Present                                                                                                                                                                                       | Gaps & Deficiencies                                                                                                                                                     |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENT-110`   | `import_batch` | **NONE**                                                                                                                                                               | **NOT CREATED**                                                                                    | None                                                                                                                                                                                                 | Table does not exist in any migration. Zero schema support for profiles, file keys, column mapping JSONB, batch counts, validation report keys, or rollback timestamps. |
| `ENT-020`   | `lead`         | `20261001000003_crm_leads_customers.sql`                                                                                                                               | RLS Enabled                                                                                        | Tenant isolation active                                                                                                                                                                              | **Missing `import_batch_id` column.** Leads cannot be attributed to an import batch, preventing batch rollback.                                                         |
| `ENT-025`   | `customer`     | `20261001000003_crm_leads_customers.sql`                                                                                                                               | RLS Enabled                                                                                        | Tenant isolation active                                                                                                                                                                              | **Missing `import_batch_id` column.**                                                                                                                                   |
| `ENT-111`   | `export_job`   | `20261001000032_reporting_enterprise_suite.sql` ([L135-151](file:///d:/DSA-CRM/DSA-Agent/supabase/migrations/20261001000032_reporting_enterprise_suite.sql#L135-L151)) | `ENABLE ROW LEVEL SECURITY`<br>`FORCE ROW LEVEL SECURITY`<br>Policy: `export_job_tenant_isolation` | `id`, `tenant_id`, `requester_id`, `scope_type`, `scope_id`, `export_type`, `file_format`, `filters`, `row_count`, `file_key`, `status`, `download_url`, `expires_at`, `downloaded_at`, `created_at` | Table created under `MOD-RPT`, but `downloaded_at` is never updated. No foreign key or support for generic entity bulk exports.                                         |

### 3. Permissions & Role Grants

| Permission Code                                                    | Introduction           | Seed Migration                                                                                                                                                         | Role Grants                                                                         | Verified Status                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export.run`                                                       | `MOD-RPT` / `TASK-414` | `20261001000032_reporting_enterprise_suite.sql` ([L209-220](file:///d:/DSA-CRM/DSA-Agent/supabase/migrations/20261001000032_reporting_enterprise_suite.sql#L209-L220)) | `ROLE-TENANT-ADMIN`<br>`ROLE-ORG-OWNER`<br>`ROLE-BRANCH-MGR`<br>`ROLE-FINANCE-EXEC` | **VERIFIED IN DB & CONTRACTS** ([permissions.ts:L57](file:///d:/DSA-CRM/DSA-Agent/packages/contracts/src/permissions.ts#L57)). Omitted from `MFA_REQUIRED_PERMISSIONS`. |
| Target Entity Permissions (`lead.create`, `customer.create`, etc.) | Core CRM               | `20261001000001_core_schema.sql`                                                                                                                                       | `ROLE-AGENT`, `ROLE-BRANCH-MGR`, `ROLE-ORG-OWNER`                                   | **VERIFIED IN DB & CONTRACTS**. But no import controller exists to enforce them.                                                                                        |

### 4. Background Workers & Frontend Components

| Component Code | Component Name | Verified Status | Evidence                                                                                                                                                                                                |
| -------------- | -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CMP-IMP.01.1` | Import Wizard  | **ABSENT**      | `apps/web/src/shell/Sidebar.tsx` line 148 has `{ label: 'Import and export', task: 'MOD-IMP' }` configured without a route (`to:`), displaying a `"Soon"` chip and tooltip `"Not built yet (MOD-IMP)"`. |
| `CMP-IMP.01.2` | Import Worker  | **ABSENT**      | No worker script, consumer daemon, or queue subscriber exists in `apps/api` or `packages`.                                                                                                              |
| `CMP-EXP.01.1` | Export Worker  | **ABSENT**      | No async worker process exists; `ReportingService.createExportJob` executes synchronously in-memory.                                                                                                    |

---

## D. Security Findings

### Finding SEC-IMP-001: Missing Step-Up MFA Verification on Record Exports

- **Affected Component:** `apps/api/src/modules/reporting/service.ts` (`createExportJob`), `POST /v1/exports`
- **Severity:** HIGH
- **Evidence:**  
  In [reporting/service.ts:L83-91](file:///d:/DSA-CRM/DSA-Agent/apps/api/src/modules/reporting/service.ts#L83-L91), `requireExportRun` only checks:
  ```typescript
  const grants = ctx.principal.grants.map((g) => g.code);
  if (!grants.includes('export.run') && !grants.includes('config.manage')) {
    throw AppError.of('FORBIDDEN', 'Principal does not have export.run permission.');
  }
  ```
  It does not invoke `deps.authz.requireStepUp(ctx, 900)`. Furthermore, in [packages/kernel/src/authz/mfa.ts:L7-19](file:///d:/DSA-CRM/DSA-Agent/packages/kernel/src/authz/mfa.ts#L7-L19), `MFA_REQUIRED_PERMISSIONS` omits `'export.run'`.
- **Impact:** Violates the mandatory specification: _"requires export.run, step-up authentication, asynchronous processing, and logging"_. An authenticated attacker holding a stolen basic session (`aal1`) can initiate bulk data exports without presenting TOTP two-factor credentials.
- **Recommended Remediation:**
  1. Add `'export.run'` to `MFA_REQUIRED_PERMISSIONS` in `packages/kernel/src/authz/mfa.ts`.
  2. Invoke `deps.authz.requireStepUp(ctx, 900)` at the beginning of `createExportJob` or the `/v1/exports` route handler.
- **Approval Required:** Security Architect / Platform Squad Lead.

---

### Finding SEC-IMP-002: Branch-Scoped Caller Authorization Bypass

- **Affected Component:** `apps/api/src/modules/reporting/service.ts` (`createExportJob`), `POST /v1/exports`
- **Severity:** HIGH
- **Evidence:**  
  In [reporting/service.ts:L897-903](file:///d:/DSA-CRM/DSA-Agent/apps/api/src/modules/reporting/service.ts#L897-L903):
  ```typescript
  const scope = this.resolveCallerScope(ctx);

  if (dto.scopeType === 'BRANCH' && dto.scopeId) {
    if (!scope.isTenantWide && !scope.allowedBranchIds.includes(dto.scopeId)) {
      throw AppError.of('FORBIDDEN', 'Principal not authorized to export for requested branch.');
    }
  }
  ```
  The check is only triggered if the caller explicitly supplies `dto.scopeType === 'BRANCH'`. If a branch manager (`ROLE-BRANCH-MGR` where `scope.isTenantWide === false`) submits `{ scopeType: 'TENANT' }`, the `if` condition evaluates to false, bypassing the branch check and creating a tenant-wide export job.
- **Impact:** Breach of tenant and branch data isolation. Branch managers can view or exfiltrate records across all branches of the tenant.
- **Recommended Remediation:**  
  Enforce scope overrides on the server: if `!scope.isTenantWide`, strictly force `scopeType = 'BRANCH'` and restrict `scopeId` to the principal's primary branch or authorized branches, rejecting any request for `TENANT` scope with `403 FORBIDDEN`.
- **Approval Required:** Security Architect / Authorization (MOD-ACL) Lead.

---

### Finding SEC-IMP-003: Complete Absence of Data Masking Engine on Exports

- **Affected Component:** Export generation pipeline (`POST /v1/exports`, `export_job`)
- **Severity:** CRITICAL
- **Evidence:**  
  The repository contains zero data-masking logic for export datasets. When records are retrieved in the reporting service, no masking is applied. If real entity records (leads, customers, financial accounts) were wired into this pipeline, unmasked Aadhaar numbers, PANs, phone numbers, and bank account numbers would be written directly to export files.
- **Impact:** Severe regulatory non-compliance with RBI guidelines, DPDP Act 2023, and internal data classification policy (Doc 12 §5 / Contracts §12).
- **Recommended Remediation:**  
  Implement a server-side record transformer that strictly masks S2/S3 classified attributes (masking all but last 4 digits of Aadhaar/PAN/account, masking mobile/email) prior to stream serialization.
- **Approval Required:** Compliance Officer / Data Protection Officer.

---

### Finding SEC-IMP-004: Missing Audit Event Emission for Export Lifecycle

- **Affected Component:** `POST /v1/exports`, `GET /v1/exports/:id`, `GET /v1/exports/:id/download`
- **Severity:** MEDIUM
- **Evidence:**  
  Neither `ReportingService.createExportJob` nor `ReportingService.getExportJob` invokes `deps.audit.record(...)`. No entries are created in `app.audit_event` on export generation or retrieval.
- **Impact:** Absence of forensic non-repudiation and audit trail for mass data export events (violating regulatory standard `R-AUD`).
- **Recommended Remediation:**  
  Emit `audit_event` with action `export.initiated` (recording requester ID, filters, scope, format, and record counts) and `export.downloaded` upon file retrieval.
- **Approval Required:** MOD-AUD / Compliance Squad.

---

### Finding SEC-IMP-005: Phantom Download URLs and Missing File Expiration Mechanism

- **Affected Component:** `apps/api/src/modules/reporting/service.ts:L921`
- **Severity:** MEDIUM
- **Evidence:**
  1. The API returns `download_url: /v1/exports/${id}/download?exp=...`, but Express has no `/v1/exports/:id/download` route registered. Navigating to this URL results in a `404 Not Found`.
  2. While `expires_at` is written to `app.export_job` as `now() + interval '24 hours'`, there is no physical file storage, no presigned storage URL, and no periodic job or cron to purge expired files.
  3. `downloaded_at` is defined as a column on `app.export_job` but is never updated.
- **Impact:** Misleading security posture. The system claims a 24-hour file expiration control, but the control is entirely fictional at the physical storage layer.
- **Recommended Remediation:**  
  Integrate an approved S3-compatible object storage provider issuing real presigned URLs with genuine 24-hour expiration tokens, or build an authenticated Express streaming endpoint that validates TTL, records `downloaded_at`, and deletes local temporary files upon expiration.
- **Approval Required:** Infrastructure Lead / Platform Squad.

---

### Finding SEC-IMP-006: Unprotected File Intake Vectors (Import Framework)

- **Affected Component:** Future `POST /v1/imports` implementation
- **Severity:** HIGH
- **Evidence:**  
  In [apps/api/src/app.ts:L89](file:///d:/DSA-CRM/DSA-Agent/apps/api/src/app.ts#L89), `/v1` routes use standard JSON parsing with a 1MB limit:
  ```typescript
  v1.use(express.json({ limit: '1mb' }));
  ```
  There is no multipart form-data middleware (such as `multer` or `busboy`), no file size limits for CSV/Excel, no file magic-byte inspection, and no antivirus scanning or quarantine isolation pipeline.
- **Impact:** Inability to ingest bulk CSV/Excel files; vulnerability to zip bombs, malicious MIME masquerading, and denial of service once multipart parsing is added.
- **Recommended Remediation:**  
  Establish an isolated file ingestion pipeline enforcing streaming multipart parsing, magic-byte header validation, 50MB file size limits, and asynchronous antivirus scanning prior to parsing.
- **Approval Required:** Platform Squad / Security Architect.

---

### Finding SEC-IMP-007: Absence of Idempotency and Race-Condition Protection on Import Batches

- **Affected Component:** `POST /v1/imports`, `POST /v1/imports/{id}/commit`
- **Severity:** HIGH
- **Evidence:**  
  Because `ENT-110 import_batch` is unbuilt, there are no database state machine constraints (`PENDING`, `PARSED`, `COMMITTING`, `COMPLETED`, `ROLLED_BACK`) and no optimistic locking (`lock_version`).
- **Impact:** Susceptible to concurrent double-commit requests causing duplicated record ingestion and database corruption.
- **Recommended Remediation:**  
  Include `lock_version` on `ENT-110 import_batch` and enforce atomic status transitions (`SELECT ... FOR UPDATE` or `UPDATE import_batch SET status = 'COMMITTING' WHERE id = $1 AND status = 'MAPPED'`) alongside mandatory `Idempotency-Key` headers.
- **Approval Required:** Platform Squad Lead.

---

### Finding SEC-IMP-008: Missing Entity Batch Identifiers Preventing Safe Rollback

- **Affected Component:** Domain entities (`lead`, `customer`, `application`, etc.)
- **Severity:** CRITICAL
- **Evidence:**  
  The specification mandates: _"Imported records retain their batch ID, for example lead.import_batch_id"_. An inspection of migration `20261001000003_crm_leads_customers.sql` ([L74-124](file:///d:/DSA-CRM/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L74-L124)) reveals that `lead` has no `import_batch_id` column.
- **Impact:** Automated 24-hour batch rollback is impossible. The system cannot distinguish imported records from organic records, making it impossible to undo an erroneous import without corrupting subsequent user edits.
- **Recommended Remediation:**  
  Add nullable foreign key columns `import_batch_id text REFERENCES import_batch(id)` to importable tables, and establish clear rollback rules (e.g. blocking rollback if a lead has already transitioned to `CONVERTED` or has attached applications).
- **Approval Required:** CRM Squad Lead / Data Architect.

---

## E. Dependency Status

| Dependency                      | Required For               | Expected Architectural State                                                                              | Current Repository State                                                                                                                 | Resolution Status                                   |
| ------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **TASK-413**                    | `MOD-IMP` submodules       | Formal task ticket authorizing platform squad to implement `MOD-IMP`.                                     | **DEFERRED**. Confirmed in `Sidebar.tsx:L148` and `MOD_RPT_READINESS_ASSESSMENT.md:L140`.                                                | **BLOCKED (Deferred)**                              |
| **MOD-ACL**                     | `SUB-IMP.01`, `SUB-IMP.02` | Server-side authorization, role grants, step-up MFA challenge (`aal2` TOTP ≤ 900s), and scope resolution. | **IMPLEMENTED IN KERNEL**. Permissions `export.run` exists, but step-up MFA is missing from the export service call.                     | **INFRASTRUCTURE PRESENT / INTEGRATION INCOMPLETE** |
| **MOD-AUD**                     | `SUB-IMP.01`, `SUB-IMP.02` | Audit logging of import/export lifecycles (`app.audit_event`).                                            | **IMPLEMENTED IN KERNEL**. `AuditPort` is active in `packages/kernel`, but export and import endpoints do not emit events.               | **INFRASTRUCTURE PRESENT / INTEGRATION MISSING**    |
| **Object Storage**              | `SUB-IMP.01`, `SUB-IMP.02` | S3-compatible bucket for 7-day source file retention and 24-hour expiring download URLs.                  | **DISABLED / ABSENT**. `supabase/config.toml` has `[storage] enabled = false`. No AWS S3/R2 client or storage port exists in `@dsa/api`. | **CRITICAL INFRASTRUCTURE BLOCKER**                 |
| **Asynchronous Worker / Queue** | `SUB-IMP.01`, `SUB-IMP.02` | Background queue and job runner for long-running imports and exports.                                     | **ABSENT**. No queue broker (BullMQ, pg-boss, RabbitMQ) exists in `package.json` or `@dsa/api`. Current endpoints are synchronous stubs. | **CRITICAL ARCHITECTURAL BLOCKER**                  |
| **MOD-RPT / ENT-111**           | `SUB-RPT.05`               | Reporting suite export endpoints.                                                                         | **PARTIALLY BUILT UNDER TASK-414**. Implemented mock export job creation in `apps/api/src/modules/reporting/`.                           | **EXISTING OVERLAPPING STUB**                       |

---

## F. Verification Evidence

The following verification commands were executed directly against the workspace to substantiate this assessment:

### 1. Database Integrity Checks (`npm run db:verify`)

- **Command:** `npm run db:verify`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Output:**
  ```
  PASS  (a) RLS lint: must return zero rows (NFR-SEC-003)
  PASS  (b) No DELETE privilege for dsa_app anywhere: must return zero rows
  PASS  (c) Tables without tenant_id must be on the global allow-list {tenant, permission, decision_definition}
  PASS  (e) Supabase exposure check: must return zero rows (anon/authenticated have no access to schema app)
  PASS  (d) Fail-closed check, run as dsa_api without SET app.tenant_id: every count must be 0
  ```
- **Environment:** Live local Supabase PostgreSQL database.

### 2. Workspace Type Checking (`npm run typecheck`)

- **Command:** `npm run typecheck`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Workspaces Checked:** `@dsa/api`, `@dsa/web`, `@dsa/bre-core`, `@dsa/contracts`, `@dsa/kernel`, `@dsa/tools`.
- **Result:** Zero TypeScript compilation errors across all packages.

### 3. Unit and Route Test Suites (`npm test`)

- **Command:** `npm test`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Test Summary:**
  - `@dsa/api`: 31 passed test files, 423 passed tests.
  - `@dsa/web`: 21 passed test files, 97 passed tests.
  - `@dsa/contracts`: 6 passed test files, 28 passed tests.
  - `@dsa/kernel`: 3 passed test files, 18 passed tests.
  - **Total:** 61 passed test files, 566 passed tests (0 failed).

### 4. Direct Database Integration Test (`apps/api/test/reporting.pg.int.spec.ts`)

- **Command:** `npx vitest run apps/api/test/reporting.pg.int.spec.ts`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Tests Executed:** 9 passed tests (including `PG-RPT-007 app.export_job (ENT-111) enforces RLS and 24-hr expiry constraint`).
- **Environment:** Live local Supabase PostgreSQL database.

### 5. OpenAPI Generation (`npm run gen:openapi`)

- **Command:** `npm run gen:openapi`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Output:** Wrote `openapi/openapi.yaml`. Verified that `/v1/exports` is documented under `Reporting` (API-RPT-006 / API-RPT-007), while `/v1/imports` is completely absent.

### 6. Production Bundle Build (`npm run build`)

- **Command:** `npm run build`
- **Working Directory:** `d:\DSA-CRM\DSA-Agent`
- **Exit Code:** `0`
- **Output:**
  - `@dsa/api` (tsup): Built `dist/server.js` (831.36 KB).
  - `@dsa/web` (vite): Built `dist/assets/index-DxfFfJGF.js` (1,328.35 KB).

### 7. Limitations & Unavailable Infrastructure

- **Integration Test Runner (`npm run test:int`):** Failed with exit code 1 (`Error: Could not find a working container runtime strategy`). Testcontainers requires a running Docker daemon, which is unavailable in the current Windows host environment. However, direct PostgreSQL tests succeeded against the local Supabase instance.
- **Object Storage Service:** Unavailable. Storage is disabled in Supabase config; no cloud S3 endpoint is configured.
- **Asynchronous Worker Runner:** Unavailable. No message broker or worker runner is configured in the codebase.

---

## G. Recommended Next Steps

### Phase 1: Actions Permitted Under Current Authorization (Immediate Hardening)

1. **Remediate Security Defects in Existing `POST /v1/exports`:**
   - Enforce step-up MFA by adding `deps.authz.requireStepUp(ctx, 900)` in `apps/api/src/modules/reporting/service.ts`.
   - Add `'export.run'` to `MFA_REQUIRED_PERMISSIONS` in `packages/kernel/src/authz/mfa.ts`.
   - Fix the branch scoping logic in `createExportJob` so non-tenant-wide principals cannot bypass branch filtering.
   - Wire `deps.audit.record` to log `export.initiated` events in `app.audit_event`.
2. **Remove or Replace Broken Download URL:**
   - Replace the phantom `/v1/exports/${id}/download` return value with an explicit status message indicating that object storage is pending provisioning, avoiding broken 404 links.

### Phase 2: Actions Requiring Formal Approval & Architecture Sign-Off

1. **Un-deferral of TASK-413:**
   - Formal approval from Platform Squad Lead and Product Owner to bring `MOD-IMP` into active implementation scope.
2. **Object Storage Architecture Decision:**
   - Decide between Supabase Storage (enabling `[storage]` in `supabase/config.toml`), AWS S3, or Cloudflare R2.
   - Specify 7-day retention lifecycle policy for import files and 24-hour expiration policy for export files.
3. **Asynchronous Worker Architecture Decision:**
   - Select a background queue mechanism consistent with architecture constraints (e.g., PostgreSQL-backed `pg-boss` or transactional polling table, avoiding MongoDB or external Redis clusters unless explicitly approved).
4. **Data Masking Policy Specification:**
   - Define exact data masking masks for customer and lead exports (Aadhaar, PAN, mobile, bank account) in coordination with the Compliance Squad.
5. **Database Migration for Import Entities:**
   - Author migration for `ENT-110 import_batch` with RLS policies and `dsa_app` grants.
   - Author migration adding `import_batch_id text REFERENCES import_batch(id)` to `lead`, `customer`, and other importable tables.
6. **Implement Import Wizard & Worker:**
   - Implement `CMP-IMP.01.1` (React Import Wizard) and `CMP-IMP.01.2` (Background Import Worker).

---

## H. Final Decision

### Status: **REMAINS BLOCKED & DEFERRED**

Module **`MOD-IMP — Import and Export Framework`** is **NOT READY FOR IMPLEMENTATION** and **MUST NOT BE MARKED COMPLETE**.

1. **SUB-IMP.01 (Import Framework)** is **0% implemented**; no tables, endpoints, workers, or UI exist.
2. **SUB-IMP.02 (Export Framework)** is **architecturally blocked** by the absence of object storage and asynchronous queue infrastructure, and existing reporting export stubs contain high-severity security vulnerabilities (missing step-up MFA, scope bypass, missing audit logging).
3. **TASK-413** remains formally deferred under project change-control rules.

The module must remain in **DEFERRED** status until formal project authorization is granted and prerequisite infrastructure (object storage and asynchronous background workers) is approved and provisioned.
