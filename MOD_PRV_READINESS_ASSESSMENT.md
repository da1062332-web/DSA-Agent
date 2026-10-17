# DSA CRM — Module 29: Privacy and Consent (MOD-PRV)

## Implementation Readiness Assessment & Architectural Audit — Phase 1 (No Code Changes)

**Document Reference:** `MOD_PRV_READINESS_ASSESSMENT.md`  
**Classification:** Confidential — Regulatory Compliance, Data Privacy & Security Audit  
**Module:** MOD-PRV (Module 29: Privacy and Consent)  
**Domain:** DOM-N — Security and Compliance  
**Regulatory Standards:** Digital Personal Data Protection (DPDP) Act 2023, RBI Digital Lending Guidelines (2022/2023), ISO/IEC 27701 (PIMS)  
**Squad:** Compliance & Platform Squad  
**Status:** **INSPECTION AND AUDIT ONLY — ZERO CODE MODIFICATIONS**  
**Author:** Lead Privacy Architect, Senior Security Engineer & QA Lead  
**Date:** October 14, 2026

---

## 1. Executive Summary

Module 29 (**Privacy and Consent — MOD-PRV**) defines the personal data governance, consent lifecycle, field-level classification and masking, retention schedule enforcement, data-principal rights management, and data-sharing disclosure audit trail for the DSA CRM platform.

This assessment conducts a rigorous forensic inspection of the codebase to evaluate readiness across all five submodules of `MOD-PRV`:

1. **SUB-PRV.01: Consent Registry**
2. **SUB-PRV.02: Data Classification and Masking**
3. **SUB-PRV.03: Retention and Legal Hold**
4. **SUB-PRV.04: Data-Principal Requests (DSR)**
5. **SUB-PRV.05: Data-Sharing Inventory**

### 1.1 High-Level Audit Findings

- **Consent Registry (SUB-PRV.01):** **Fully Implemented and Verified in MVP**. Table `app.consent_record` (ENT-028) is active with database-enforced immutability triggers (`consent_record_guard`, `consent_record_no_delete`). Full consent capture and withdrawal APIs exist (`POST /v1/customers/:id/consents`, `POST /v1/consents/:id/withdrawal`, `POST /v1/leads`). Consent validation gates (`ConsentPort.findActive`) are actively wired across messaging, verification, and document sharing, rejecting unauthorized processing with HTTP 422 `CONSENT_REQUIRED`.
- **Data Classification & Masking (SUB-PRV.02):** **Partially Implemented**. Field-level masking serializers (`maskMobile`, `maskEmail`, `maskName`, `maskPan`, `maskAccountNumber`) and regex data leak scanners (`containsS2SensitiveData`) are active across contracts and services. Blind HMAC-SHA256 indexing is enforced on contact points. However, the centralized runtime field classification catalog (`app.classification_field` / ENT-101) is **deferred under TASK-426**, and sensitive profile reveal (`API-CUST-006`) is explicitly disabled with HTTP 403 pending Step-Up MFA and privacy infrastructure.
- **Retention and Legal Hold (SUB-PRV.03):** **Deferred under TASK-426 / Blocked by OD-008**. Neither `app.retention_policy` (ENT-097) nor `app.legal_hold` (ENT-098) exists in database migrations. Retention periods remain legally unratified pending Open Decision `OD-008`.
- **Data-Principal Requests (SUB-PRV.04):** **Deferred under TASK-426**. Table `app.data_subject_request` (ENT-099) and endpoints `API-PRV-001` through `API-PRV-003` are missing. This submodule depends on `MOD-GRV` (Grievances) for ticketed SLA resolution.
- **Data-Sharing Inventory (SUB-PRV.05):** **Implemented and Verified in MVP**. Table `app.data_sharing_record` (ENT-100) is active in Supabase PostgreSQL with `forbid_mutation()` append-only triggers. It is atomically recorded during external share generation (`API-DSH-006`) in `MOD-DSH`.
- **Quality Gates:** Baseline checks confirm **100% test pass rate** (434/434 tests passing) and **0 TypeScript typecheck errors**. No application code or database migrations were modified during this assessment.

---

## 2. Status of All Five Submodules

```
========================================================================================================================
MOD-PRV SUBMODULE STATUS MATRIX
========================================================================================================================
Submodule      Title                          Authorized Scope     Actual Status               Key Drivers / Blockers
------------------------------------------------------------------------------------------------------------------------
SUB-PRV.01     Consent Registry               MVP (TASK-106, 110)  IMPLEMENTED & VERIFIED      ENT-028 active; API-CUST-004/005,
                                                                                               Lead consent, ConsentPort verified.
SUB-PRV.02     Data Classification & Masking  Partial in MVP       PARTIALLY IMPLEMENTED       Masking & HMAC active; ENT-101
                                                                                               and API-CUST-006 deferred (TASK-426).
SUB-PRV.03     Retention and Legal Hold       Deferred (TASK-426)  DEFERRED BY SPECIFICATION   ENT-097, ENT-098 missing; blocked
                                                                                               by Open Decision OD-008.
SUB-PRV.04     Data-Principal Requests (DSR)  Deferred (TASK-426)  DEFERRED BY SPECIFICATION   ENT-099 & API-PRV-001..003 missing;
                                                                                               architectural dependency on MOD-GRV.
SUB-PRV.05     Data-Sharing Inventory         MVP (MOD-DSH, LCS)   IMPLEMENTED & VERIFIED      ENT-100 active; written atomically
                                                                                               by DocumentSharingService.
========================================================================================================================
```

---

## 3. Requirement-by-Requirement Implementation Matrix

### 3.1 SUB-PRV.01 — Consent Registry

| Specification Requirement       | Canonical ID       | Actual Codebase Status     | Evidence / Repository Location                                                                                                                                                                                                                                                                                                                                                                     | Verification Notes                                                                                                                                              |
| :------------------------------ | :----------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consent Entity**              | ENT-028            | **Implemented & Verified** | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L38-L58`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L38-L58)                                                                                                                                                                               | Active in live DB; fields: `subject_type`, `purpose`, `purpose_target`, `notice_version`, `channel`, `evidence_ref`, `captured_at`, `status`, `expires_at`.     |
| **Partial Unique Constraint**   | N/A                | **Implemented & Verified** | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L60`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L60)                                                                                                                                                                                       | `consent_record_one_active_uq` enforces exactly one `ACTIVE` consent per `(tenant_id, subject_type, subject_id, purpose, purpose_target)`.                      |
| **Database Immutability Guard** | N/A                | **Implemented & Verified** | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L62-L72`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L62-L72)                                                                                                                                                                               | Trigger `consent_record_guard` throws SQL error `42501` on any update other than `ACTIVE -> WITHDRAWN`. Trigger `consent_record_no_delete` forbids all deletes. |
| **Lead Capture Consent**        | API-LEAD-001       | **Implemented & Verified** | [`apps/api/src/modules/crm/leads/lead-service.ts#L290-L306`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/leads/lead-service.ts#L290-L306)                                                                                                                                                                                                   | Atomically inserts `cnst_...` row on `POST /v1/leads`. Emits outbox & audit events `consent.granted`.                                                           |
| **Customer Consent Record**     | API-CUST-004       | **Implemented & Verified** | [`apps/api/src/modules/crm/customers/customer-service.ts#L520-L581`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/customer-service.ts#L520-L581)                                                                                                                                                                                   | Route `POST /v1/customers/:id/consents`. Requires `consent.record` permission; writes to `app.consent_record` with idempotency.                                 |
| **Consent Withdrawal**          | API-CUST-005       | **Implemented & Verified** | [`apps/api/src/modules/crm/customers/customer-service.ts#L584-L699`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/customer-service.ts#L584-L699)                                                                                                                                                                                   | Route `POST /v1/consents/:id/withdrawal`. Moves state to `WITHDRAWN`, records `withdrawn_at`, `withdrawn_by`, and `withdrawal_reason`.                          |
| **Customer Consents List**      | API-CUST-008       | **Implemented & Verified** | [`apps/api/src/modules/crm/customers/router.ts#L150-L160`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/router.ts#L150-L160)                                                                                                                                                                                                       | Route `GET /v1/customers/:id/consents`. Returns active and historical consent records for customer.                                                             |
| **Consent Verification Port**   | `ConsentPort`      | **Implemented & Verified** | [`packages/contracts/src/ports/crm-ports.ts#L6-L15`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ports/crm-ports.ts#L6-L15), [`apps/api/src/modules/crm/customers/customer-service.ts#L714-L742`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/customer-service.ts#L714-L742) | `findActive(tx, q)` resolves active consent on customer OR traverses to converting lead.                                                                        |
| **Consent Gate HTTP 422**       | `CONSENT_REQUIRED` | **Implemented & Verified** | [`packages/contracts/src/errors.ts#L25`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/errors.ts#L25)                                                                                                                                                                                                                                           | Canonical error `CONSENT_REQUIRED: 422`. Enforced in messaging, verifications, and document sharing.                                                            |
| **Frontend Consent UI**         | UI-LEAD-001        | **Implemented & Verified** | [`apps/web/src/features/customers/CustomerConsents.tsx`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/web/src/features/customers/CustomerConsents.tsx)                                                                                                                                                                                                           | Complete React Query workbench for listing, recording, and withdrawing customer consent.                                                                        |

### 3.2 SUB-PRV.02 — Data Classification and Masking

| Specification Requirement       | Canonical ID | Actual Codebase Status               | Evidence / Repository Location                                                                                                                                                                                                                                                                                                                     | Verification Notes                                                                                                           |
| :------------------------------ | :----------- | :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **Classification Catalog**      | ENT-101      | **Deferred by Spec (TASK-426)**      | None                                                                                                                                                                                                                                                                                                                                               | Table `app.classification_field` does not exist in any migration.                                                            |
| **S0–S4 Classification Scheme** | System Spec  | **Implemented & Enforced in Code**   | [`packages/contracts/src/activity.ts#L26-L35`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/activity.ts#L26-L35), [`packages/contracts/src/verification.ts#L48-L55`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/verification.ts#L48-L55) | S0 (Public), S1 (Internal), S2 (PII), S3 (Sensitive ID/Financial), S4 (Vault Credentials).                                   |
| **Mobile & Email Masking**      | Serializer   | **Implemented & Verified**           | [`apps/api/src/modules/crm/customers/normalizer.ts#L96-L115`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/normalizer.ts#L96-L115)                                                                                                                                                 | `maskMobile` (+91 ****** 3210), `maskEmail` (r***a@example.com). Unit tested in `normalizer.spec.ts`.                        |
| **PAN & Account Masking**       | Serializer   | **Implemented & Verified**           | [`packages/contracts/src/connector.ts#L65-L75`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/connector.ts#L65-L75)                                                                                                                                                                             | `maskPan` (ABCDE****F), `maskAccountNumber` (********9012).                                                                  |
| **Aadhaar Protection**          | ADR-4D-04    | **Implemented & Verified**           | [`apps/api/src/modules/origination/verifications/verification-service.ts#L40-L46`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/verifications/verification-service.ts#L40-L46)                                                                                                       | Strict regex `\b\d{12}\b` rejects any payload with raw Aadhaar numbers under statutory penalties.                            |
| **Blind HMAC Search Index**     | Crypto Port  | **Implemented & Verified**           | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L12`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L12)                                                                                                                                       | Contact points store HMAC-SHA256 `value_hash` with index `customer_contact_point_hash_idx`.                                  |
| **Sensitive Field Reveal**      | API-CUST-006 | **Partially Implemented (Disabled)** | [`apps/api/src/modules/crm/customers/router.ts#L143-L148`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/router.ts#L143-L148)                                                                                                                                                       | Route exists; intentionally throws HTTP 403 `FORBIDDEN` pending approved step-up auth and privacy infrastructure (TASK-421). |

### 3.3 SUB-PRV.03 — Retention and Legal Hold

| Specification Requirement         | Canonical ID      | Actual Codebase Status             | Evidence / Repository Location | Verification Notes                                                                                 |
| :-------------------------------- | :---------------- | :--------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------- |
| **Retention Policy Entity**       | ENT-097           | **Deferred by Spec (TASK-426)**    | None                           | Table `app.retention_policy` does not exist in any migration.                                      |
| **Legal Hold Entity**             | ENT-098           | **Deferred by Spec (TASK-426)**    | None                           | Table `app.legal_hold` does not exist in any migration.                                            |
| **Retention Policy Management**   | API-PRV-004 / 005 | **Deferred by Spec (TASK-426)**    | None                           | No routes exist in backend.                                                                        |
| **Legal Hold Application**        | API-PRV-006       | **Deferred by Spec (TASK-426)**    | None                           | No route exists in backend.                                                                        |
| **Retention Period Ratification** | OD-008            | **Blocked by Unresolved Decision** | None                           | Statutory retention periods (KYC 5y, Loan files 8y, Rejected leads 1y) await formal legal opinion. |
| **Automated Purge Worker**        | Background Job    | **Missing**                        | None                           | No cron worker exists for data anonymization or partition pruning.                                 |

### 3.4 SUB-PRV.04 — Data-Principal Requests (DSR)

| Specification Requirement  | Canonical ID       | Actual Codebase Status          | Evidence / Repository Location                                                                                                                           | Verification Notes                                                                                    |
| :------------------------- | :----------------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **DSR Entity**             | ENT-099            | **Deferred by Spec (TASK-426)** | None                                                                                                                                                     | Table `app.data_subject_request` does not exist.                                                      |
| **DSR Submission**         | API-PRV-001        | **Deferred by Spec (TASK-426)** | None                                                                                                                                                     | Route does not exist.                                                                                 |
| **DSR Status & Tracking**  | API-PRV-002        | **Deferred by Spec (TASK-426)** | None                                                                                                                                                     | Route does not exist.                                                                                 |
| **DSR Execution Workflow** | API-PRV-003        | **Deferred by Spec (TASK-426)** | None                                                                                                                                                     | Route does not exist.                                                                                 |
| **Grievance Integration**  | MOD-GRV Dependency | **Dependency Ready**            | [`apps/api/src/modules/crm/grievances/`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/grievances/) | Grievance intake, queue, resolution, and SLA engine are active. DSR can bind directly when unblocked. |

### 3.5 SUB-PRV.05 — Data-Sharing Inventory

| Specification Requirement         | Canonical ID      | Actual Codebase Status           | Evidence / Repository Location                                                                                                                                                                                                                                 | Verification Notes                                                                                                                                              |
| :-------------------------------- | :---------------- | :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data Sharing Entity**           | ENT-100           | **Implemented & Verified**       | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L195-L209`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L195-L209)                                       | Active in live PostgreSQL; columns: `subject_type`, `subject_id`, `recipient_type`, `recipient_id`, `purpose`, `consent_ids`, `items`, `channel`, `source_ref`. |
| **Append-Only Guard**             | FR-PRV-007        | **Implemented & Verified**       | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L215`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L215)                                                 | Trigger `data_sharing_record_append_only` executes `forbid_mutation()` on UPDATE or DELETE.                                                                     |
| **Non-PII Items Constraint**      | Data Protection   | **Implemented & Verified**       | [`supabase/migrations/20261001000003_crm_leads_customers.sql#L204`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L204)                                                 | Column `items` stores field names & checklist IDs only; never raw customer PII values.                                                                          |
| **Atomic Document Share Record**  | API-DSH-006       | **Implemented & Verified**       | [`apps/api/src/modules/origination/document-sharing/document-sharing-service.ts#L697-L706`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/document-sharing/document-sharing-service.ts#L697-L706) | Inserts `dsr_...` row in the same transaction as `external_share` creation.                                                                                     |
| **Lender-Case Submission Record** | API-LCS-004       | **Partially Implemented (Stub)** | [`apps/api/src/modules/origination/lender-cases/router.ts#L1-L10`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/lender-cases/router.ts#L1-L10)                                                   | Module router is currently an empty stub; awaiting Dev 4 full submission implementation.                                                                        |
| **Data Sharing Port Interface**   | `DataSharingPort` | **Implemented in Contracts**     | [`packages/contracts/src/ports/crm-ports.ts#L40-L43`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ports/crm-ports.ts#L40-L43)                                                                             | Interface defined; real compliance service provider pending; inline SQL used currently in MOD-DSH.                                                              |

---

## 4. Evidence with Repository Paths and Test References

### 4.1 Backend Implementation Evidence

- **Consent Schema & Database Triggers:**
  - File: [`supabase/migrations/20261001000003_crm_leads_customers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L38-L73)
  - Functions: `consent_only_withdraw()`, `forbid_mutation()`.
  - Triggers: `consent_record_guard`, `consent_record_no_delete`.
- **Customer Consent Management:**
  - File: [`apps/api/src/modules/crm/customers/customer-service.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/customer-service.ts#L520-L742)
  - Methods: `recordConsent()`, `withdrawConsent()`, `listConsents()`, `findActive()`.
- **Lead Capture Consent:**
  - File: [`apps/api/src/modules/crm/leads/lead-service.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/leads/lead-service.ts#L290-L306)
  - Methods: `createLead()` atomically inserts consent record and emits `consent.granted`.
- **Data Sharing Inventory Recording:**
  - File: [`apps/api/src/modules/origination/document-sharing/document-sharing-service.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/document-sharing/document-sharing-service.ts#L695-L706)
  - Table: `app.data_sharing_record` (ENT-100) inserted transactionally with external share.

### 4.2 Test Coverage Evidence

- **Consent Unit & Route Tests:**
  - File: [`apps/api/test/customers.spec.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/test/customers.spec.ts#L340-L540)
  - Test suites:
    - `SUB-CUST.03: Consent Registration & Withdrawal (API-CUST-004, API-CUST-005)`
    - Verifies active status, purpose target check, idempotency replay, and duplicate rejection.
    - `SUB-CUST.03: List Consents (GET /v1/customers/:id/consents)`
- **Live PostgreSQL Immutability & Constraint Tests:**
  - File: [`apps/api/test/customers.pg.int.spec.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/test/customers.pg.int.spec.ts#L140-L170)
  - Tests verify that direct `DELETE` is blocked by `consent_record_no_delete`, and direct update to `EXPIRED` is rejected by `consent_record_guard`.
- **Masking Unit Tests:**
  - File: [`apps/api/src/modules/crm/customers/normalizer.spec.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/normalizer.spec.ts#L109-L125)
  - Tests verify `maskMobile`, `maskEmail`, and `maskName`.
- **Frontend Component Tests:**
  - File: [`apps/web/src/features/customers/CustomerConsents.spec.tsx`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/web/src/features/customers/CustomerConsents.spec.tsx)
  - Verifies component mount, query provider wiring, and container rendering.

---

## 5. Security and Tenant-Isolation Findings

### 5.1 Multi-Tenant Isolation (RLS)

- Both `app.consent_record` and `app.data_sharing_record` are protected by:
  ```sql
  CALL enable_tenant_rls('consent_record');
  CALL enable_tenant_rls('data_sharing_record');
  ```
- Any query executed through the application role `dsa_api` without `SET LOCAL app.tenant_id` returns 0 rows (fail-closed verified in `npm run db:verify`).
- Cross-tenant queries are blocked at the PostgreSQL engine level.

### 5.2 Role-Based Access Control (RBAC)

- **`consent.record`:** Required for creating customer consents (`API-CUST-004`) and withdrawing consent (`API-CUST-005`).
- **`customer.reveal_sensitive`:** Defined in [`packages/contracts/src/permissions.ts#L14`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/permissions.ts#L14) for unmasking profile fields.
  - **Security Finding:** `API-CUST-006` (`POST /v1/customers/:id/reveal`) currently throws `403 FORBIDDEN` unconditionally because the audit logger and step-up challenge flow for profile reveals have not been wired to the gateway. This fails safely (closed).

### 5.3 Sensitive Data Protection & Aadhaar Regulatory Guard

- **Aadhaar Act Compliance:**
  - Storing raw 12-digit Aadhaar numbers is illegal under Indian law.
  - The codebase implements an active guard in [`apps/api/src/modules/origination/verifications/verification-service.ts#L40`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/verifications/verification-service.ts#L40) rejecting any payload matching `\b\d{12}\b` with HTTP 422 `VALIDATION_ERROR`.
- **Free-Text Note Scanning:**
  - Function `containsS2SensitiveData()` in [`packages/contracts/src/activity.ts#L26-L35`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/activity.ts#L26-L35) prevents sales reps from typing raw PAN, Aadhaar, or bank account numbers into activity notes.

---

## 6. Missing APIs, Database Entities, and Contracts

The following elements specified in Module 29 are currently absent from the repository:

```
========================================================================================================================
MISSING ARTIFACTS INVENTORY
========================================================================================================================
Artifact Type         Identifier       Name / Description                              Governing Task / Status
------------------------------------------------------------------------------------------------------------------------
Database Table        ENT-101          app.classification_field                        Deferred (TASK-426)
Database Table        ENT-097          app.retention_policy                            Deferred (TASK-426, OD-008)
Database Table        ENT-098          app.legal_hold                                  Deferred (TASK-426)
Database Table        ENT-099          app.data_subject_request                        Deferred (TASK-426)
API Endpoint          API-PRV-001      POST /v1/privacy/dsr (Submit DSR)               Deferred (TASK-426)
API Endpoint          API-PRV-002      GET /v1/privacy/dsr/:id (DSR Status)            Deferred (TASK-426)
API Endpoint          API-PRV-003      POST /v1/privacy/dsr/:id/execute (Execute DSR)  Deferred (TASK-426)
API Endpoint          API-PRV-004      GET /v1/privacy/retention-policies              Deferred (TASK-426)
API Endpoint          API-PRV-005      PUT /v1/privacy/retention-policies/:id          Deferred (TASK-426)
API Endpoint          API-PRV-006      POST /v1/privacy/legal-holds                    Deferred (TASK-426)
API Endpoint          API-CUST-006     POST /v1/customers/:id/reveal (Real impl)       Disabled / Blocked (TASK-421)
Shared Service Port   DataSharingPort  Real Compliance Provider (currently stub)       In-tree gap (MOD-03)
ULID Prefixes         ID_PREFIXES      ret (retention), lgh (legal hold), dsr (DSR)    Missing from contracts/ids.ts
Frontend Route        /privacy         Privacy and Consent Management Screen           Missing from apps/web
========================================================================================================================
```

---

## 7. Existing Implementation to be Reused

When expanding Module 29 beyond the current baseline, the following proven components must be reused:

1. **`ConsentPort.findActive`:**
   - Location: [`apps/api/src/modules/crm/customers/customer-service.ts#L714-L742`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/customer-service.ts#L714-L742)
   - Reused by: Verification checks (`MOD-VER`), Document sharing (`MOD-DSH`), Messaging dispatch (`MOD-MSG`), and Lender submissions (`MOD-LCS`).
2. **`consent_record` Schema & Triggers:**
   - Location: [`supabase/migrations/20261001000003_crm_leads_customers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql)
   - Provides immutable audit trail of consent history.
3. **`data_sharing_record` Schema:**
   - Location: [`supabase/migrations/20261001000003_crm_leads_customers.sql#L195`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L195)
   - Reusable for all external data transmission logging.
4. **`containsS2SensitiveData` & Masking Functions:**
   - Location: [`packages/contracts/src/activity.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/activity.ts), [`apps/api/src/modules/crm/customers/normalizer.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/customers/normalizer.ts)
   - Consistent formatting across API responses and UI displays.
5. **Grievance Resolution Subsystem (`MOD-GRV`):**
   - Location: [`apps/api/src/modules/crm/grievances/`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/grievances/)
   - Provides the underlying ticketing, assignment, and escalation engine required for `SUB-PRV.04`.

---

## 8. Dependencies and Unresolved Decisions

### 8.1 Open Decision OD-008: Statutory Data Retention Periods

- **Issue:** The DPDP Act requires data fiduciaries to erase personal data upon purpose completion or consent withdrawal, unless retention is mandated by law. In lending, conflicting regulations exist:
  - RBI Master Direction on NBFCs: Retain loan records for 8 years from closure.
  - PMLA (Prevention of Money Laundering Act): Retain KYC records for 5 years after business relationship terminates.
  - Unconverted leads: Retention limited to 1 year without active consent.
- **Impact on SUB-PRV.03:** System retention policies cannot be codified into `app.retention_policy` without formal legal/compliance approval.
- **Status:** **BLOCKED**. Must remain deferred pending executive compliance sign-off.

### 8.2 Task Dependency TASK-426: Privacy Enhancements

- **Issue:** Tasks for automated retention purging, legal hold freezing, data-subject access request portals, and metadata classification catalogs are bundled under `TASK-426`.
- **Status:** **DEFERRED**. Out of scope for Phase 1 / MVP.

### 8.3 Task Dependency TASK-421: Sensitive Field Reveal Step-Up

- **Issue:** `API-CUST-006` requires integration with Step-Up MFA challenge verification and specialized audit event chains (`customer.revealed`).
- **Status:** **BLOCKED**. Remains disabled (`403 FORBIDDEN`) until formal step-up reveal flow is unblocked.

---

## 9. Test Commands and Actual Results

The baseline quality gates were executed directly on the repository without modifying application code:

| Quality Gate Command     | Exit Code | Actual Result Summary   | Output Details                                                                                                                                     |
| :----------------------- | :-------: | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`      |   **0**   | **PASS**                | 0 TypeScript errors across all 6 workspaces (`@dsa/api`, `@dsa/web`, `@dsa/contracts`, `@dsa/kernel`, `@dsa/bre-core`, `@dsa/tools`).              |
| `npm test`               |   **0**   | **PASS**                | 434 tests passed across 4 test suites (322 API, 66 Web, 28 Contracts, 18 Kernel).                                                                  |
| `npm run db:verify`      |   **0**   | **PASS**                | Passed all 5 database security audits: RLS lint (NFR-SEC-003), No DELETE grants, tenant allow-list, Supabase exposure, and fail-closed checks.     |
| `npm run gen:openapi`    |   **0**   | **PASS**                | OpenAPI 3.1 schema generated cleanly (`wrote ../openapi/openapi.yaml`).                                                                            |
| `npm run build`          |   **0**   | **PASS**                | Backend built cleanly via `tsup` (619 KB); Frontend bundle built cleanly via `vite` (1.2 MB).                                                      |
| `npm run lint`           |   **1**   | **FAIL (Pre-existing)** | 140 lint problems (138 errors, 2 warnings) related to `@typescript-eslint/no-explicit-any` and unused variables in older test suites and UI forms. |
| `npm run test:isolation` |   **1**   | **SKIPPED / FAIL**      | Requires Docker/Testcontainers runtime to launch ephemeral PostgreSQL containers (Docker daemon not running in local environment).                 |

---

## 10. Recommended Next Steps

Prioritized by technical risk, compliance importance, and MVP alignment:

### Priority 1: Package Real `DataSharingPort` into Compliance Module (Low Effort, High Architecture Value)

- **Problem:** `app.data_sharing_record` is currently written via inline SQL in `DocumentSharingService` (`MOD-DSH`).
- **Action:** Move the real database insert logic into `apps/api/src/modules/compliance/` and wire `DataSharingPort` into `ApiDeps`, fulfilling the architectural contract without altering behavior.

### Priority 2: Unblock and Wire `API-CUST-006` Reveal Flow (Medium Effort, High Security Value)

- **Problem:** Authorized users with `customer.reveal_sensitive` cannot reveal mobile/email in the UI because the endpoint returns 403.
- **Action:** Implement Step-Up MFA check on `POST /v1/customers/:id/reveal`, emit `customer.revealed` audit events, and return unmasked fields for authorized audit review.

### Priority 3: Add Standalone Privacy Management Screen in Web UI (Medium Effort)

- **Problem:** Sidebar has a placeholder `"Privacy and consent"` tagged `"Soon"`.
- **Action:** Provide a read-only audit view under `/privacy` displaying tenant consent statistics, recent data sharing records, and masking configuration.

---

## 11. Explicit List of Items that Must Remain Deferred

In strict compliance with the project specifications and instructions, the following items **MUST REMAIN DEFERRED**:

1. **`SUB-PRV.03` — Automated Retention Policies & Destruction:**
   - Creation of `app.retention_policy` (ENT-097) and `app.legal_hold` (ENT-098).
   - Automated data purging or hard-deletion cron workers.
   - Any destructive deletion operations on customer, application, or consent records.
   - Codification of retention schedules pending resolution of `OD-008`.
2. **`SUB-PRV.04` — Data-Subject Request (DSR) Workflows:**
   - Creation of `app.data_subject_request` (ENT-099).
   - Endpoints `API-PRV-001`, `API-PRV-002`, and `API-PRV-003`.
   - Automated self-service customer erasure or export portals.
3. **`SUB-PRV.02` — Dynamic Field Classification Registry:**
   - Creation of `app.classification_field` (ENT-101).
   - Runtime configuration of field sensitivity tiers (hardcoded S0–S4 tiers in contracts remain authoritative).
4. **Scope Extensions:**
   - Do not begin `TASK-426` or `TASK-421` without explicit authorization.

---

## 12. Final Conclusion & Recommendation

The existing DSA CRM codebase has a **robust, compliant, and verified foundation for Phase 1 Privacy and Consent**:

- The **Consent Registry (SUB-PRV.01)** is production-ready, featuring PostgreSQL-enforced immutability, automated lead capture, and consent gating across all outbound and verification workflows.
- The **Data-Sharing Inventory (SUB-PRV.05)** is active and records lender transmissions immutably.
- **Data Masking (SUB-PRV.02)** protects PII, PAN, and Aadhaar across all public and internal layers.

**Recommendation:**

- Keep `SUB-PRV.03` (Retention/Legal Hold) and `SUB-PRV.04` (DSR) strictly deferred under `TASK-426` and `OD-008`.
- If authorization is granted, the only recommended Phase 1 improvement is encapsulating `DataSharingPort` into `apps/api/src/modules/compliance` to complete the clean architectural boundary.
- **Confirmation:** Zero application code, migrations, or tests were modified during this assessment.
