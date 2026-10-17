# DSA CRM — Module 28: Integration Management (MOD-INT)

## Submodule SUB-INT.01: Adapter Framework — Implementation Readiness Assessment & Architectural Blueprint

**Document Reference:** `MOD_INT_01_ADAPTER_FRAMEWORK_READINESS.md`  
**Classification:** Technical Assessment & Architectural Blueprint (Confidential)  
**Module:** MOD-INT (Module 28: Integration Management)  
**Submodule:** SUB-INT.01 — Adapter Framework  
**Domain:** DOM-M — Integrations and API Management  
**Squad:** Platform Squad  
**MVP Owner:** Dev 1 for outbox rows only  
**Priority:** P0 / Release R1  
**Status:** **INSPECTION AND PLANNING ONLY (Deferred under TASK-419)**  
**Author:** Senior Backend Engineer, Integration Architect, Security Engineer & QA Engineer  
**Date:** October 14, 2026

---

## 1. Executive Summary

Module 28 (**Integration Management — MOD-INT**) provides the centralized infrastructure for connecting the DSA CRM platform to external service providers across all functional domains, including messaging gateways (SMS/WhatsApp/Email), identity and fraud verification APIs (PAN, GSTIN, Aadhaar Vault, Bureau), document extraction, and banking APIs.

Submodule **SUB-INT.01 (Adapter Framework)** is designed to establish a standardized, provider-independent abstraction layer. Its goals are:

1. Decoupling core business logic from vendor-specific REST/SOAP/RPC schemas.
2. Managing provider capability descriptors so that unsupported operations fail cleanly without runtime surprises.
3. Enforcing rigorous tenant isolation and Separation of Duties (SOD).
4. Providing strict sandbox vs. production environment boundaries to prevent test transactions from executing against live financial or customer channels.
5. Securing third-party credentials by storing only opaque references (`credential_ref`), never plaintext secrets, within application databases.

### 1.1 Key Inspection Findings

- **Implementation Status:** `SUB-INT.01` is **completely deferred under TASK-419**. Neither `API-INT-001` (`GET /v1/integrations`), `API-INT-002` (`PUT /v1/integrations/{provider}`), nor the underlying entity `ENT-103` (`app.integration_connection`) exists in the repository.
- **Foundation Reuse:** The repository contains robust foundational substrate that must be reused:
  - Multi-tenant RLS helpers in [`supabase/migrations/20261001000000_roles_and_helpers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000000_roles_and_helpers.sql) (`app_tenant()`, `enable_tenant_rls()`).
  - Tenant transaction runner in [`apps/api/src/kernel-min/tx-runner.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/kernel-min/tx-runner.ts) (`TxRunner.withTenantTx`).
  - Optimistic concurrency in [`apps/api/src/http/request.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/http/request.ts) (`ifMatchVersion`).
  - Idempotency engine in [`packages/kernel/src/idempotency/idempotency.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/idempotency/idempotency.ts) (`withIdempotency`).
  - Audit logging in [`packages/kernel/src/audit/audit.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/audit/audit.ts) (`createAuditPort`).
  - Mandatory Step-Up Authentication (MFA) in [`packages/kernel/src/authz/mfa.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/authz/mfa.ts) (`requiresMfa` and `config.manage` enforcement).
- **Outbox Status:** `outbox_event` (ENT-108) exists and receives rows from CRM modules, but the outbound relay worker remains **deferred under TASK-403**.
- **Critical Security Blocker:** No approved enterprise secrets manager or vault integration (AWS Secrets Manager, HashiCorp Vault, KMS) currently exists in the codebase. Line 57 of [`supabase/config.toml`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/config.toml) has `# [db.vault]` commented out. Real credentials cannot be stored until an approved vault integration strategy is formally unblocked.

---

## 2. Existing Architecture & Repository Audit

A forensic inspection of the codebase was conducted across all workspaces.

```
====================================================================================================
FOUNDATION REUSE MAP FOR MOD-INT
====================================================================================================
Subsystem / Layer          Source File Path                                      Status & Capabilities
----------------------------------------------------------------------------------------------------
Monorepo Workspaces        package.json                                          EXISTING (apps/api, apps/web, packages/contracts, packages/kernel, packages/bre-core, tools)
Database Tenancy & RLS     supabase/migrations/20261001000000_roles_and_helpers.sql EXISTING (app_tenant(), enable_tenant_rls(), forbid_mutation())
Database Roles & Grants    supabase/migrations/20261001000002_kernel_infra.sql   EXISTING (dsa_app restricted role, dsa_api application role)
Transaction Runner         apps/api/src/kernel-min/tx-runner.ts                  EXISTING (TxRunner.withTenantTx sets session-local app.tenant_id)
Authentication Gateway     apps/api/src/http/supabase-auth.ts                    EXISTING (Verifies JWT, extracts principal, enforces aal2 step-up)
RBAC / Permissions         packages/kernel/src/authz/authz.ts                    EXISTING (requirePermission, requireOnRecord, scopeFilter)
Audit Logging              packages/kernel/src/audit/audit.ts                    EXISTING (AuditPort.record writes to app.audit_event in same tx)
Idempotency Store          packages/kernel/src/idempotency/idempotency.ts        EXISTING (withIdempotency enforces replay and request hashing)
Optimistic Concurrency     apps/api/src/http/request.ts                          EXISTING (ifMatchVersion parses If-Match ETag against lock_version)
Outbox Event Table         supabase/migrations/20261001000002_kernel_infra.sql   PARTIAL (app.outbox_event written; publisher deferred under TASK-403)
Ad-hoc Channel Adapter     apps/api/src/modules/crm/messaging/channel-adapter.ts EXISTING (Ad-hoc message adapter; lacks multi-tenancy & vault)
Frontend Shell & Nav       apps/web/src/shell/Sidebar.tsx                        PARTIAL (Shows "Integrations" tagged "Soon" without route)
Secrets Vault Client       supabase/config.toml                                  BLOCKED (No approved vault integration present in repo)
====================================================================================================
```

### 2.1 Monorepo Structure and Workspace Organization

The project uses `npm` workspaces:

- `apps/api`: Express 4 TypeScript backend application running under Node.js 22+.
- `apps/web`: React 18 single-page application using Vite, Material UI (MUI 6), and React Router 6.
- `packages/contracts`: Pure TypeScript shared types, Zod schemas, error models, and permission constants.
- `packages/kernel`: Security runtime, authentication verifiers, RBAC, audit logging, idempotency, and transaction primitives.
- `packages/bre-core`: In-process Business Rules Engine.
- `tools`: Tenant provisioning, migration verification, and OpenAPI generation scripts.

### 2.2 Backend Module Registration

Module routers are declared in [`apps/api/src/modules/index.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/index.ts). The `apiModules` array registers routers mounted under `/v1`.  
**Finding:** No router or entry exists for `integrations`.

### 2.3 Shared Contracts and Identifiers

- File: [`packages/contracts/src/ids.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ids.ts)
  - Defines `ID_PREFIXES` array of Crockford ULID prefixes.
  - **Finding:** No prefix for integration connections (e.g., `itc_` or `inc_`) exists.
- File: [`packages/contracts/src/permissions.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/permissions.ts)
  - Defines `PERMISSION_CODES`.
  - **Finding:** `config.manage` exists at line 35. This satisfies the authorization requirement for `API-INT-001` and `API-INT-002`.

---

## 3. Canonical Specification Assessment for SUB-INT.01

### 3.1 API-INT-001 — List Integrations (`GET /v1/integrations`)

| Attribute                | Canonical Requirement                                                  | Current Codebase Status | Evidence / Gap                                                                                                                                                                                           |
| :----------------------- | :--------------------------------------------------------------------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Endpoint**             | `GET /v1/integrations`                                                 | **Missing**             | No route registered in [`apps/api/src/modules/index.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/index.ts) or any submodule.                      |
| **Permission**           | `config.manage`                                                        | **Ready for wiring**    | Permission `config.manage` is defined in [`packages/contracts/src/permissions.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/permissions.ts).     |
| **Tenant Scoping**       | Derived strictly from authenticated JWT (`req.ctx.principal.tenantId`) | **Ready for wiring**    | Established pattern in `requireCtx(req)` prevents cross-tenant access.                                                                                                                                   |
| **Step-Up MFA**          | `aal2` required because user holds `config.manage`                     | **Existing**            | Gateway in [`apps/api/src/http/supabase-auth.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/http/supabase-auth.ts#L21-L26) enforces `401 STEP_UP_REQUIRED`. |
| **Response Schema**      | Array of integration connections with safe metadata                    | **Missing**             | No contract defined in `packages/contracts`.                                                                                                                                                             |
| **Credential Redaction** | Absolute redaction: zero plaintext secrets                             | **Design Required**     | `credential_ref` must be returned as opaque string handle only; no API keys/tokens exposed.                                                                                                              |
| **Pagination**           | Keyset pagination using base64url cursor                               | **Ready for wiring**    | `encodeCursor` / `decodeCursor` available in [`apps/api/src/http/request.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/http/request.ts).                   |

### 3.2 API-INT-002 — Configure an Integration (`PUT /v1/integrations/{provider}`)

| Attribute                  | Canonical Requirement                                      | Current Codebase Status | Evidence / Gap                                                                                                              |
| :------------------------- | :--------------------------------------------------------- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Endpoint**               | `PUT /v1/integrations/{provider}`                          | **Missing**             | Route does not exist.                                                                                                       |
| **Permission**             | `config.manage`                                            | **Ready for wiring**    | Evaluated via `authz.requirePermission(ctx, 'config.manage')`.                                                              |
| **Optimistic Concurrency** | Mandatory `If-Match` header matching `lock_version`        | **Ready for wiring**    | Supported via `ifMatchVersion(req)`. Throws `400 MALFORMED_REQUEST` if missing; returns `409 VERSION_CONFLICT` on mismatch. |
| **Audit Logging**          | Transactional audit record in `app.audit_event`            | **Ready for wiring**    | `AuditPort.record()` writes atomically with before/after state.                                                             |
| **Payload Validation**     | Strict provider-specific schema with unknown-key rejection | **Missing**             | Requires Zod schemas for supported providers and capabilities.                                                              |
| **Idempotency**            | Optional on PUT, but supported via `Idempotency-Key`       | **Ready for wiring**    | `withIdempotency` is available in `@dsa/kernel`.                                                                            |

### 3.3 ENT-103 — Integration Connection (`app.integration_connection`)

The canonical entity specification defines the following requirements:

- `id`: ULID prefixed identifier (e.g., `itc_<ULID>`).
- `tenant_id`: Mandatory foreign key referencing `app.tenant(id)`.
- `provider`: Text string identifying the vendor (e.g., `TWILIO`, `KARZA`, `SUREPASS`, `CIBIL`).
- `capability`: Text string identifying domain operation (e.g., `SMS_DISPATCH`, `PAN_VERIFY`, `GST_VERIFY`).
- `environment`: `'SANDBOX' | 'PRODUCTION'`.
- `credential_ref`: Opaque reference string resolving in vault (Classification S4).
- `config`: Sanitized non-secret JSONB configuration (endpoints, retry limits, timeouts).
- `status`: `'ACTIVE' | 'INACTIVE' | 'DEGRADED' | 'SUSPENDED'`.
- `health`: JSONB structure recording last ping, latency ms, error rate, and timestamp.
- `lock_version`: Integer for optimistic concurrency.
- `created_at`, `created_by`, `updated_at`, `updated_by`: Standard audit stamps.
- **Required Uniqueness Constraint:**
  ```sql
  UNIQUE (tenant_id, provider, capability)
  ```
- **Current Database Status:** **MISSING**. No table `app.integration_connection` exists in Supabase PostgreSQL.

---

## 4. Proposed Adapter Architecture

The adapter framework must decouple core platform business logic from external third-party communication.

```
+-----------------------------------------------------------------------------+
|                                DSA CRM CORE                                 |
|      (MOD-MSG Messaging, MOD-VER Verification, MOD-DOC Documents, etc.)     |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
|                      CENTRAL INTEGRATION REGISTRY                           |
|      - Resolves Adapter by (Provider, Capability)                           |
|      - Reads ENT-103 integration_connection from DB (Tenant-Isolated)       |
|      - Resolves Credential Reference via IVaultPort                         |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
|                         BASE ADAPTER INTERFACE                              |
|   executeOperation(ctx, capability, input): Promise<AdapterResult<T>>        |
|   checkHealth(ctx): Promise<HealthCheckResult>                              |
|   validateConfig(config): ValidationResult                                  |
+-----------------------------------------------------------------------------+
           │                                 │                       │
           ▼                                 ▼                       ▼
+-----------------------+       +-----------------------+  +------------------+
|  TwilioSmsAdapter     |       |   KarzaPanAdapter     |  | MockTestAdapter  |
|  (SMS_DISPATCH)       |       |   (PAN_VERIFY)        |  | (Deterministic)  |
+-----------------------+       +-----------------------+  +------------------+
```

### 4.1 Proposed Base Adapter Interface

An adapter must satisfy a contract defining its identity, environment support, health check, and execution protocol:

```typescript
export type IntegrationEnvironment = 'SANDBOX' | 'PRODUCTION';

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  checkedAt: string;
}

export interface AdapterExecutionMetadata {
  provider: string;
  capability: string;
  environment: IntegrationEnvironment;
  durationMs: number;
  httpStatus?: number;
  externalTransactionId?: string;
}

export interface AdapterResult<T> {
  success: boolean;
  data?: T;
  error?: AdapterError;
  metadata: AdapterExecutionMetadata;
}

export interface BaseAdapter<TConfig = unknown> {
  readonly providerId: string;
  readonly supportedCapabilities: readonly string[];
  readonly supportedEnvironments: readonly IntegrationEnvironment[];

  validateConfig(config: unknown): { valid: boolean; errors?: string[] };
  checkHealth(config: TConfig, credentials: ResolvedCredentials): Promise<HealthCheckResult>;
  execute<TInput, TOutput>(
    capability: string,
    input: TInput,
    config: TConfig,
    credentials: ResolvedCredentials,
    metadata: { correlationId: string; tenantId: string },
  ): Promise<AdapterResult<TOutput>>;
}
```

### 4.2 Capability Descriptors

Rather than assuming every vendor supports all operations, capabilities are explicitly declared:

| Capability Identifier | Description                           | Required Config Fields               | Data Classification |
| :-------------------- | :------------------------------------ | :----------------------------------- | :------------------ |
| `MESSAGING.SMS`       | Outbound transactional SMS            | `senderId`, `dltTemplateId`          | S2 (PII)            |
| `MESSAGING.WHATSAPP`  | WhatsApp Business template messaging  | `businessAccountId`, `phoneNumberId` | S2 (PII)            |
| `VERIFICATION.PAN`    | Instant PAN verification & name match | `apiEndpoint`, `minMatchScore`       | S3 (Financial/ID)   |
| `VERIFICATION.GST`    | Business GSTIN status & return check  | `apiEndpoint`, `filingMonths`        | S2 (Commercial)     |
| `VERIFICATION.BANK`   | Penny-drop account verification       | `pennyAmountPaise`, `webhookUrl`     | S3 (Financial)      |
| `STORAGE.DOC_SCAN`    | Antivirus & malware stream scan       | `maxSizeBytes`, `quarantineBucket`   | S1 (System)         |

Attempting to execute an unlisted capability on an adapter must fail closed with error code `VALIDATION_ERROR` or `DEPENDENCY_UNAVAILABLE` before making any network call.

### 4.3 Sandbox and Production Isolation Design

To guarantee that development/testing cannot trigger real financial or customer-facing operations:

1. **Header & Context Validation:**
   - The execution runtime checks `ENT-103.environment`.
   - If `environment === 'SANDBOX'`, the adapter URL must match a pre-registered sandbox domain or mock fixture endpoint.
2. **Credential Reference Partitioning:**
   - Vault paths must strictly enforce environment separation:
     - Sandbox: `vault://tenants/{tenant_id}/sandbox/{provider}/credentials`
     - Production: `vault://tenants/{tenant_id}/production/{provider}/credentials`
3. **Execution Guard:**
   - Production adapters cannot be triggered by automated test runners. Test suites use `ConfiguredTestAdapter` or in-memory deterministic fakes.

### 4.4 Standardized Errors and Redaction

#### Error Normalization Mapping

External vendor errors must map directly into existing canonical `ErrorCode` definitions ([`packages/contracts/src/errors.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/errors.ts)):

| External HTTP / Error Condition | Canonical ErrorCode       | HTTP Status | Retryable? |
| :------------------------------ | :------------------------ | :---------- | :--------- |
| Network Timeout / DNS failure   | `DEPENDENCY_UNAVAILABLE`  | 503         | **Yes**    |
| Provider 429 Rate Limit         | `RATE_LIMITED`            | 429         | **Yes**    |
| Provider 500 / 502 / 504        | `DEPENDENCY_UNAVAILABLE`  | 503         | **Yes**    |
| Invalid API Key / Auth failure  | `INTERNAL_ERROR` (masked) | 500         | No         |
| Malformed Request / Validation  | `VALIDATION_ERROR`        | 422         | No         |
| Capability Not Supported        | `VALIDATION_ERROR`        | 422         | No         |
| Target Resource Not Found       | `NOT_FOUND`               | 404         | No         |

#### Mandatory Logging Redaction Rules

Before writing to `app.provider_call_log` (ENT-104) or application logger:

1. Strip all `Authorization`, `x-api-key`, and `Cookie` request headers.
2. Scan payloads using `containsS2SensitiveData()` ([`packages/contracts/src/activity.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/activity.ts#L26-L35)) to mask:
   - 12-digit Aadhaar numbers (`\b\d{12}\b`).
   - 10-character PAN identifiers.
   - Bank account numbers.
   - Passwords, bearer tokens, and client secrets.

---

## 5. Security Architecture & Threat Review

### 5.1 Authentication, RBAC, and Step-Up Verification

- **Permission Check:** `API-INT-001` and `API-INT-002` require `config.manage`.
- **Tenant Context:** Derivation occurs exclusively through verified JWT claims (`req.ctx.principal.tenantId`). A caller cannot manipulate `{provider}` or payload to target another tenant's integration.
- **Mandatory Step-Up (MFA):** In [`packages/kernel/src/authz/mfa.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/authz/mfa.ts#L8), `config.manage` is explicitly registered in `MFA_REQUIRED_PERMISSIONS`. Any user attempting `PUT /v1/integrations/{provider}` without an `aal2` session is rejected with `401 STEP_UP_REQUIRED`.

### 5.2 Multi-Tenant Isolation & RLS Guarantees

- Table `app.integration_connection` must use `enable_tenant_rls('integration_connection')`.
- All queries must be executed through `TxRunner.withTenantTx(ctx, ...)`.
- Even if application logic fails to include `WHERE tenant_id = ...`, PostgreSQL RLS enforces:
  ```sql
  CREATE POLICY tenant_isolation_policy ON app.integration_connection
    FOR ALL TO dsa_app
    USING (tenant_id = app_tenant())
    WITH CHECK (tenant_id = app_tenant());
  ```
- Application role `dsa_api` has `NOBYPASSRLS` and cannot delete or bypass tenant constraints.

### 5.3 Credential Protection (Classification S4)

- **Zero Secrets in Database:** Table `app.integration_connection` must store only `credential_ref text NOT NULL`. Storing raw API keys, passwords, or private keys in PostgreSQL is strictly forbidden.
- **Vault Interface (`IVaultPort`):**
  ```typescript
  export interface IVaultPort {
    resolveSecret(tenantId: string, credentialRef: string): Promise<ResolvedCredentials>;
  }
  ```
- **Redaction in Responses:** `GET /v1/integrations` and `PUT /v1/integrations/{provider}` return the `credential_ref` name (e.g., `"vault://tenants/demo-alpha/twilio-prod"`), never secret contents.

### 5.4 Configuration Validation

- Payloads for `PUT /v1/integrations/{provider}` must be validated with Zod:
  - `.strict()` mode to reject unknown keys.
  - Rejection of keys resembling credentials (e.g., `secret`, `apiKey`, `password`, `token`).
  - Validation of provider name against approved enum (`TWILIO`, `KARZA`, etc.).
  - Validation of capability against approved capability registry.

### 5.5 Auditability

- Updating an integration connection must emit an audit event via `AuditPort.record`:
  - `action: 'integration.configure'`
  - `entityType: 'integration_connection'`
  - `entityId: itc_<id>`
  - `before` / `after` states containing sanitized JSON (secrets omitted, `credential_ref` retained).
  - Immutability enforced by `forbid_mutation()` trigger on `app.audit_event`.

---

## 6. Frontend Readiness Assessment

### 6.1 Current UI State

- File: [`apps/web/src/shell/Sidebar.tsx`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/web/src/shell/Sidebar.tsx#L119)
  ```tsx
  {
    title: 'Integrations and API (DOM-M)',
    items: [
      { label: 'Integrations', task: 'MOD-INT' },
      { label: 'API management', task: 'MOD-API' },
    ],
  }
  ```
  Item is disabled, lacks a route, and displays a `"Soon"` badge. No pages, components, or API clients exist in `apps/web/src/features/`.

### 6.2 Proposed Minimal Frontend Architecture

When unblocked, the frontend should implement:

1. **Route:** `/admin/integrations` registered in `apps/web/src/features/integrations/routes.tsx`.
2. **Page Component:** `IntegrationsPage.tsx` using Material UI:
   - Header with Environment toggle (`Sandbox` / `Production`).
   - Cards/Grid listing configured and available integrations (Messaging, Identity, Financial).
   - Status chips: `ACTIVE` (Green), `DEGRADED` (Orange), `INACTIVE` (Grey).
   - "Configure" button launching `ConfigureIntegrationDialog`.
3. **Configuration Dialog:**
   - Fields: Environment, Capability, Credential Reference Identifier, Custom Timeout/Retry options.
   - Guarded by `StepUpDialog` if session is not `aal2`.
   - Never contains inputs for plaintext passwords or API keys (directs user to enter vault reference).
4. **State Management:** TanStack React Query (`useIntegrations`, `useConfigureIntegration`).

---

## 7. Dependencies and Scope Boundaries

The table below details all related submodules, tasks, and cross-cutting dependencies:

```
========================================================================================================================
DEPENDENCY & SCOPE BOUNDARY MATRIX
========================================================================================================================
Identifier    Subsystem / Component               Actual Codebase Status            Impact on SUB-INT.01
------------------------------------------------------------------------------------------------------------------------
SUB-INT.01    Adapter Framework                   DEFERRED (TASK-419)               Primary subject of this assessment.
SUB-INT.02    Credentials and Rotation            DEFERRED (TASK-419)               Blocks live external API calls (requires Vault).
SUB-INT.03    Outbound Reliability (Outbox)       PARTIALLY IMPLEMENTED             Table outbox_event exists; relay worker DEFERRED (TASK-403).
SUB-INT.04    Inbound Webhooks                    DEFERRED (TASK-419 / TASK-424)   No webhook listener or signature validation exists.
SUB-INT.05    Integration Monitoring              DEFERRED (TASK-419)               No metrics collector or provider latency dashboard.
SUB-INT.06    Reconciliation Jobs                 DEFERRED (TASK-419)               No financial/ledger reconciliation cron jobs exist.
MOD-MSG       Messaging Module                    IMPLEMENTED (Mock/Ad-hoc)         Uses in-memory ConfiguredTestAdapter; needs MOD-INT.
MOD-VER       Verification Module                 IMPLEMENTED (Manual/Consent Gate) Ready to plug into VerificationProviderPort once MOD-INT is built.
TASK-403      Outbox Relay Dispatcher             DEFERRED                          Outbox rows accumulate; no publisher process running.
TASK-419      MOD-INT Scope Freeze                DEFERRED                          Formal scope gate holding back integration development.
TASK-424      Customer Portal & Upload Scope      DEFERRED                          Affects public webhooks and external uploads.
========================================================================================================================
```

---

## 8. Comprehensive Testing-Readiness Assessment

A concrete test plan for the future implementation of `SUB-INT.01` has been designed:

### 8.1 Unit Tests (`apps/api/test/integrations/`)

1. **UT-INT-001 (Adapter Contract Validation):** Verify that every adapter class implements `BaseAdapter`, exports supported capabilities, and rejects unsupported capability names.
2. **UT-INT-002 (Config Schema Validation):** Verify that invalid timeout, malformed URLs, and injected secret strings in configuration objects throw `VALIDATION_ERROR`.
3. **UT-INT-003 (Sandbox Isolation):** Verify that calling an adapter configured in `SANDBOX` mode throws if given a production endpoint.
4. **UT-INT-004 (Error Normalization):** Verify that Axios/Fetch timeout maps to `DEPENDENCY_UNAVAILABLE` (503, retryable), and 429 maps to `RATE_LIMITED`.
5. **UT-INT-005 (Sensitive Data Redaction):** Verify that logs generated from adapter calls mask PAN, Aadhaar, and authorization headers.

### 8.2 API Integration Tests (`apps/api/test/integrations.int.spec.ts`)

1. **IT-INT-001 (Authorized Listing):** `GET /v1/integrations` with `config.manage` and `aal2` returns 200 with tenant's configured integrations.
2. **IT-INT-002 (Missing Step-Up Authentication):** `PUT /v1/integrations/TWILIO` with valid `config.manage` but `aal1` token returns `401 STEP_UP_REQUIRED`.
3. **IT-INT-003 (Missing Permission):** `GET /v1/integrations` with user lacking `config.manage` returns `403 FORBIDDEN`.
4. **IT-INT-004 (Optimistic Concurrency - Missing If-Match):** `PUT /v1/integrations/TWILIO` without `If-Match` returns `400 MALFORMED_REQUEST`.
5. **IT-INT-005 (Optimistic Concurrency - Stale Version):** `PUT /v1/integrations/TWILIO` with stale ETag returns `409 VERSION_CONFLICT`.
6. **IT-INT-006 (Tenant Isolation):** Verify Tenant A cannot read or mutate Tenant B's integration configuration.

### 8.3 Database & Security Tests (`tests/isolation/cases/integrations.spec.ts`)

1. **DB-INT-001 (Uniqueness Constraint):** Inserting `(tenant_id, provider, capability)` duplicate throws PostgreSQL unique violation `23505`.
2. **DB-INT-002 (Direct RLS Enforcement):** Querying `app.integration_connection` as `dsa_api` without `SET LOCAL app.tenant_id` returns 0 rows.
3. **DB-INT-003 (Audit Atomicity):** Verify that a failed configuration update rolls back the audit event record.
4. **DB-INT-004 (No Secret Persistence):** SQL assertions verifying zero occurrences of bearer tokens or private keys in the `config` column.

### 8.4 Frontend Tests (`apps/web/src/features/integrations/`)

1. **FE-INT-001 (List Rendering):** Integration cards render correct status chips and environment badges.
2. **FE-INT-002 (Step-Up Interception):** Clicking configure without `aal2` triggers `StepUpDialog`.
3. **FE-INT-003 (No Plaintext Secrets in DOM):** Inspect DOM tree to guarantee zero secret inputs or exposed credentials.

---

## 9. Baseline Quality-Gate Verification Results

All available repository quality-gate commands were executed directly. Results are recorded below:

| Quality Gate Command     | Exit Code | Result Summary          | Details / Output                                                                                                                                                                 |
| :----------------------- | :-------: | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`      |   **0**   | **PASS**                | 0 TypeScript errors across all 6 workspaces (`@dsa/api`, `@dsa/web`, `@dsa/bre-core`, `@dsa/contracts`, `@dsa/kernel`, `@dsa/tools`).                                            |
| `npm test`               |   **0**   | **PASS**                | 434 total tests passed across 4 test suites (322 API, 66 Web, 28 Contracts, 18 Kernel).                                                                                          |
| `npm run db:verify`      |   **0**   | **PASS**                | Passed all 5 database security audits: RLS lint (NFR-SEC-003), No DELETE grants for dsa_app, Tenant allow-list check, Supabase exposure check, and Fail-closed zero-count check. |
| `npm run gen:openapi`    |   **0**   | **PASS**                | OpenAPI 3.1 specification generated successfully (`wrote ../openapi/openapi.yaml`).                                                                                              |
| `npm run build`          |   **0**   | **PASS**                | Backend built cleanly via `tsup` (dist/server.js 619 KB); Frontend bundle built cleanly via `vite` (dist/assets/index 1.2 MB).                                                   |
| `npm run lint`           |   **1**   | **FAIL (Pre-existing)** | 140 lint problems (138 errors, 2 warnings) related to `@typescript-eslint/no-explicit-any` and unused variables in older test suites and UI forms.                               |
| `npm run test:isolation` |   **1**   | **SKIPPED / FAIL**      | Requires Docker / Testcontainers runtime to spawn ephemeral PostgreSQL containers (Docker daemon not running in local environment).                                              |

---

## 10. Unresolved Architectural Decisions & Blockers

Before implementation of `SUB-INT.01` can begin, the following open decisions must be formally resolved by the Platform Squad and Security Architect:

### Open Decision OD-INT-001: Enterprise Secrets Management & Vault Strategy

- **Issue:** `credential_ref` cannot be resolved at runtime because no vault client exists in the codebase.
- **Options:**
  - Option A: Integrate AWS Secrets Manager / KMS using tenant-partitioned keys.
  - Option B: Enable Supabase Vault (`[db.vault]` in `supabase/config.toml`) using `pgsodium` encrypted secrets.
  - Option C: Provide an in-memory encrypted envelope provider for local development.
- **Current Status:** **BLOCKER**. Must be approved prior to activating live integrations.

### Open Decision OD-INT-002: Outbound Relay Architecture (TASK-403)

- **Issue:** Outbox rows are written to `app.outbox_event`, but no polling worker or CDC processor exists to deliver them to external provider webhooks.
- **Options:**
  - Option A: In-process NodeJS background polling loop with advisory locks (`pg_try_advisory_xact_lock`).
  - Option B: External worker container executing `relay.ts` over Kafka / SQS.
- **Current Status:** Deferred under `TASK-403`.

### Open Decision OD-INT-003: Provider Call Logging Storage Policy

- **Issue:** Should `app.provider_call_log` (ENT-104) be stored in PostgreSQL or forwarded to an external observability platform (e.g., Datadog, CloudWatch) to prevent database bloat?
- **Current Status:** Awaiting platform storage sizing review.

---

## 11. Recommended Implementation Sequence

Once `TASK-419` is formally unblocked by the Product and Security teams, implementation should proceed in four sequential phases:

```
+-----------------------------------------------------------------------------+
| PHASE 1: CONTRACTS & DATABASE FOUNDATION                                    |
| 1. Add 'itc' identifier prefix to packages/contracts/src/ids.ts.            |
| 2. Create migration 20261001000028_integrations.sql (app.integration_conn). |
| 3. Enable tenant RLS, append-only audit triggers, and unique constraints.   |
| 4. Define Zod schemas and TypeScript models in packages/contracts.          |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 2: CORE ADAPTER FRAMEWORK & VAULT PORT                                |
| 1. Implement BaseAdapter, CapabilityDescriptor, and AdapterResult types.    |
| 2. Implement IVaultPort interface and development mock resolver.            |
| 3. Build Centralized IntegrationRegistry with adapter lifecycle management. |
| 4. Implement ConfiguredTestAdapter and failure-handling unit tests.         |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 3: BACKEND API & ROUTER MOUNTING                                      |
| 1. Implement IntegrationService with If-Match concurrency & audit logging.  |
| 2. Implement router with GET /v1/integrations and PUT /v1/integrations/{p}. |
| 3. Enforce config.manage permission and aal2 Step-Up MFA authentication.    |
| 4. Register module in apps/api/src/modules/index.ts and openapi.ts.         |
| 5. Execute API integration and tenant isolation test suites.                |
+-----------------------------------------------------------------------------+
                                      │
                                      ▼
+-----------------------------------------------------------------------------+
| PHASE 4: FRONTEND WORKBENCH & INTEGRATION RE-WIRING                         |
| 1. Build IntegrationsPage in apps/web/src/features/integrations/.           |
| 2. Wire route /admin/integrations and enable sidebar navigation item.       |
| 3. Integrate StepUpDialog for configuration updates.                        |
| 4. Refactor MOD-MSG and MOD-VER to consume adapters via IntegrationRegistry.|
+-----------------------------------------------------------------------------+
```

---

## 12. Final Synthesis & Classification Matrix

| Subsystem Component              | Category                  | Status Classification   | Action Required                          |
| :------------------------------- | :------------------------ | :---------------------- | :--------------------------------------- |
| **`GET /v1/integrations`**       | API Endpoint              | **Missing**             | To be implemented in Phase 3.            |
| **`PUT /v1/integrations/{p}`**   | API Endpoint              | **Missing**             | To be implemented in Phase 3.            |
| **`app.integration_connection`** | Database Entity (ENT-103) | **Missing**             | Write migration in Phase 1.              |
| **`itc` Prefix**                 | ID Registry               | **Missing**             | Add to `packages/contracts/src/ids.ts`.  |
| **`config.manage`**              | Authorization             | **Existing & Verified** | Reused directly from `permissions.ts`.   |
| **Step-Up MFA (`aal2`)**         | Security Gateway          | **Existing & Verified** | Reused directly from `supabase-auth.ts`. |
| **BaseAdapter Interface**        | Architecture              | **Proposed**            | Formally defined in this document.       |
| **Capability Descriptors**       | Architecture              | **Proposed**            | Formally defined in this document.       |
| **Sandbox / Prod Separation**    | Architecture              | **Proposed**            | Formally defined in this document.       |
| **Vault / Secrets Manager**      | Infrastructure            | **Blocked by Approval** | Resolve Open Decision `OD-INT-001`.      |
| **Outbox Relay Dispatcher**      | Infrastructure            | **Deferred (TASK-403)** | Separate task; outbox rows only in MVP.  |
| **Frontend UI**                  | User Interface            | **Missing**             | Build minimal page in Phase 4.           |

---

### Concise Summary

- **What already exists:** Multi-tenant RLS helpers, `config.manage` RBAC, mandatory `aal2` step-up MFA gateway, transaction runner, idempotency engine, audit logger, `If-Match` concurrency parser, `outbox_event` table, and ad-hoc message adapter mocks.
- **What is missing:** `API-INT-001`, `API-INT-002`, `ENT-103` schema migration, adapter contracts, capability descriptors, and frontend configuration workbench.
- **What is blocked:** Live external provider credentials cannot be stored until an approved Secrets Vault strategy (`OD-INT-001`) is adopted.
- **What requires approval:** Product/architecture sign-off to lift `TASK-419` deferral and select the vault implementation approach.
- **Recommended next action:** Submit this assessment (`MOD_INT_01_ADAPTER_FRAMEWORK_READINESS.md`) for review and await explicit authorization before writing code or migrations.
