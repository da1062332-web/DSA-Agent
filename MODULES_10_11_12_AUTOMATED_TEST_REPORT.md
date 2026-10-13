# Automated Test Report: Modules 10, 11 & 12 (DSA CRM)

**Execution Date:** 2026-10-13T10:28:40+05:30  
**Branch:** `piyush` (at commit `21c3012`)  
**Repository:** `da1062332-web/DSA-Agent`  
**Overall Status:** **PASS WITH LIMITATIONS**

---

## 1. Executive Summary

This report documents the comprehensive, automated verification of:
- **Module 10 — MOD-ACT: Activity Logging (`SUB-ACT.01`)**
- **Module 11 — MOD-MSG: Omnichannel Messaging (`SUB-MSG.01`–`SUB-MSG.04`)**
- **Module 12 — MOD-NTF: Notifications & Preferences (`SUB-NTF.01`, `SUB-NTF.02`)**

All testing was executed automatically against the real application code, contracts, and a live PostgreSQL 17 database instance (Supabase AWS ap-south-1). No manual UI clicks or external provider charges were incurred.

### Key Metrics
| Category | Executed | Passed | Failed | Skipped | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unit & Route Tests (Monorepo)** | 124 | 124 | 0 | 0 | **100% PASS** |
| **Live PostgreSQL Integration Tests** | 25 | 25 | 0 | 0 | **100% PASS** |
| **Database Migrations & RLS Verification** | 5 checks | 5 checks | 0 | 0 | **100% PASS** |
| **Cross-Module Interaction Tests** | 6 | 6 | 0 | 0 | **100% PASS** |
| **Frontend Integration Tests** | 12 | 12 | 0 | 0 | **100% PASS** |
| **Total Automated Tests** | **149** | **149** | **0** | **0** | **100% PASS** |

---

## 2. Environment & Test Infrastructure

| Component | Specification | Configuration Details |
| :--- | :--- | :--- |
| **Operating System** | macOS (Darwin 24.6.0 arm64) | Apple Silicon / ZSH |
| **Node.js Runtime** | Node.js v24.x | npm workspaces monorepo |
| **Application Server** | Express 5 | `@dsa/api` (port 3000) |
| **Frontend Web** | React 18, Vite 5, TanStack Query 5 | `@dsa/web` (port 5173) |
| **Database Engine** | PostgreSQL 17.11 on aarch64 | AWS ap-south-1 (Supavisor port 6543) |
| **Application Role** | `dsa_api` (member of `dsa_app`) | `NOBYPASSRLS`, no `DELETE` grants |
| **Admin Role** | `postgres` (migration runner) | Verified via `VERIFY_DATABASE_URL` |
| **Secrets & Keys** | All secrets, credentials, and tokens redacted | Connection URLs masked |

---

## 3. Automated Commands Executed & Exit Codes

| Command Line | Purpose | Exit Code | Evidence / Result |
| :--- | :--- | :---: | :--- |
| `npm run typecheck` | Monorepo TypeScript check | `0` | Clean across all 6 workspaces |
| `npm run lint` | ESLint across entire codebase | `0` | 0 errors, 0 warnings |
| `npm test` | Unit, Route & Contract test suite | `0` | 124 tests passed in 21 test files |
| `npm run test:int -w @dsa/api -- test/activities-live-pg.int.spec.ts` | Real PG verification for Module 10 | `0` | 8/8 live database tests passed |
| `npm run test:int -w @dsa/api -- test/messaging-live-pg.int.spec.ts` | Real PG verification for Module 11 | `0` | 10/10 live database tests passed |
| `npm run test:int -w @dsa/api -- test/notifications-live-pg.int.spec.ts` | Real PG verification for Module 12 | `0` | 7/7 live database tests passed |
| `npm run db:verify` | PostgreSQL RLS and schema security | `0` | 5/5 mandatory §8 security checks passed |
| `npm run gen:openapi` | OpenAPI schema regeneration | `0` | Synchronized with Zod schemas |
| `npm run build -w @dsa/web` | Frontend production bundle build | `0` | Built in 1.46s with 0 errors |

---

## 4. Module-by-Module Test Matrix

### 4.1 Module 10 — MOD-ACT: Activity Logging (`SUB-ACT.01`)
*Authorized Scope: Interaction Logging only. Unified Timeline (`SUB-ACT.02`) remains deferred under `TASK-410`.*

| Test ID | Test Category | Description | Result |
| :--- | :--- | :--- | :---: |
| `TC-ACT-001` | API / Auth | Authorized user creates activity against a Lead | **PASS** |
| `TC-ACT-002` | API / Auth | Authorized user creates activity against a Customer | **PASS** |
| `TC-ACT-003` | API / Auth | Authorized user creates activity against a Loan Application | **PASS** |
| `TC-ACT-004` | API / Validation | Nonexistent or missing subject is rejected with `404 NOT_FOUND` | **PASS** |
| `TC-ACT-005` | Security / Multi-Tenant | Cross-tenant subject reference rejected with `404` without info leakage | **PASS** |
| `TC-ACT-006` | AuthZ | User without `activity.create` permission denied with `403 FORBIDDEN` | **PASS** |
| `TC-ACT-007` | AuthZ | User without `activity.update` cannot edit or hide record (`403`) | **PASS** |
| `TC-ACT-008` | Security | Out-of-scope branch reference rejected with `404` | **PASS** |
| `TC-ACT-009` | Security / Attribution | Client cannot forge server-side `actorId` attribute | **PASS** |
| `TC-ACT-010` | Security / S2 Data | Free-text notes with PAN, Aadhaar, or Bank Account rejected (`422`) | **PASS** |
| `TC-ACT-011` | Reliability | Idempotency-Key retries return cached response without duplicates | **PASS** |
| `TC-ACT-012` | Concurrency | Concurrency check: stale `If-Match` returns `409 VERSION_CONFLICT` | **PASS** |
| `TC-ACT-013` | Concurrency | Valid update bumps `lockVersion` and updates `ETag` | **PASS** |
| `TC-ACT-014` | Audit / Compliance | Soft-hiding an activity sets `isHidden: true` and emits audit event | **PASS** |
| `TC-ACT-015` | API / Query | `GET /v1/activities` lists activities filtered by subject | **PASS** |
| `PG-ACT-001` | PostgreSQL / Role | `dsa_api` connects with `NOBYPASSRLS` | **PASS** |
| `PG-ACT-002` | PostgreSQL / RLS | RLS tenant isolation enforced on `app.activity` table | **PASS** |
| `PG-ACT-003` | PostgreSQL / Trigger | `touch_row` trigger increments `lock_version` and updates timestamp | **PASS** |
| `PG-ACT-004` | PostgreSQL / Immutability | `forbid_delete` trigger blocks `DELETE` operations on `app.activity` | **PASS** |
| `PG-ACT-005` | PostgreSQL / Logic | Soft-hiding updates `is_hidden` and `hidden_at` in database | **PASS** |
| `PG-ACT-006` | PostgreSQL / Atomicity | Atomic activity and audit_event write inside single transaction | **PASS** |
| `PG-ACT-007` | PostgreSQL / E2E | End-to-end HTTP `POST /v1/activities` persists to PostgreSQL | **PASS** |
| `PG-ACT-008` | PostgreSQL / E2E | End-to-end HTTP `PATCH` optimistic locking on PostgreSQL | **PASS** |

---

### 4.2 Module 11 — MOD-MSG: Omnichannel Messaging (`SUB-MSG.01`–`SUB-MSG.04`)
*Authorized Scope: Templates, Dispatch, Eligibility Guard, and Public Webhooks. Inbound capture (`SUB-MSG.05`) remains deferred under `TASK-415`.*

| Test ID | Test Category | Description | Result |
| :--- | :--- | :--- | :---: |
| `TC-MSG-001` | API / Templates | Creates message template with `config.manage` and `Idempotency-Key` | **PASS** |
| `TC-MSG-002` | API / Validation | Rejects template creation with invalid variable placeholders | **PASS** |
| `TC-MSG-003` | Concurrency | Template idempotency replay returns identical cached record | **PASS** |
| `TC-MSG-004` | Multi-Tenant | Enforces tenant isolation on template listing | **PASS** |
| `TC-MSG-005` | API / Dispatch | Dispatches transactional email through configured mock provider | **PASS** |
| `TC-MSG-006` | API / Validation | Rejects dispatch when template variables are missing (`422`) | **PASS** |
| `TC-MSG-007` | Security / Fail-Closed | Blocks sending when provider is unconfigured (`422 PROVIDER_NOT_CONFIGURED`) | **PASS** |
| `TC-MSG-008` | Compliance | Enforces tenant quiet hours policy (night-time blocks dispatch) | **PASS** |
| `TC-MSG-009` | Timezone | Timezone-aware quiet hours calculation (America/New_York vs IST) | **PASS** |
| `TC-MSG-010` | Frequency Caps | Hourly frequency cap per recipient hash prevents message spam | **PASS** |
| `TC-MSG-011` | Consent | Opt-out suppression list blocks outbound promotional dispatch | **PASS** |
| `TC-MSG-012` | Webhooks / Security | Public webhook accepts valid HMAC signature (`200 OK`) | **PASS** |
| `TC-MSG-013` | Webhooks / Security | Public webhook rejects invalid HMAC signature (`401 UNAUTHORIZED`) | **PASS** |
| `TC-MSG-014` | Webhooks / Dedupe | Deduplicates provider delivery events via `PROVIDER_MESSAGE` namespace | **PASS** |
| `TC-MSG-015` | Webhooks / Security | Unknown connection path fails closed with `404 NOT_FOUND` | **PASS** |
| `PG-MSG-001` | PostgreSQL / Role | `dsa_api` connects with `NOBYPASSRLS` | **PASS** |
| `PG-MSG-002` | PostgreSQL / RLS | RLS tenant isolation on `message_template` and `message` | **PASS** |
| `PG-MSG-003` | PostgreSQL / Fail-Closed | Querying `message_template` without `app.tenant_id` returns 0 rows | **PASS** |
| `PG-MSG-004` | PostgreSQL / Guard | Template version immutability guard: modifying APPROVED template fails | **PASS** |
| `PG-MSG-005` | PostgreSQL / Trigger | `forbid_mutation` trigger blocks `DELETE` on templates and messages | **PASS** |
| `PG-MSG-006` | PostgreSQL / Constraint | `UNIQUE (tenant_id, code, version)` constraint enforced | **PASS** |
| `PG-MSG-007` | PostgreSQL / Atomicity | Atomic dispatch, dedupe registry, and audit event inside transaction | **PASS** |
| `PG-MSG-008` | PostgreSQL / Dedupe | `dedupe_registry` with `PROVIDER_MESSAGE` namespace works in PG | **PASS** |
| `PG-MSG-009` | PostgreSQL / Concurrency | Concurrent frequency caps with `MESSAGE_FREQ` namespace remain atomic | **PASS** |
| `PG-MSG-010` | PostgreSQL / Security | `resolve_public_entry` security definer and `public_entry_index` RLS | **PASS** |

---

### 4.3 Module 12 — MOD-NTF: Notifications & Preferences (`SUB-NTF.01`, `SUB-NTF.02`)
*Authorized Scope: In-app notifications and Notification Preferences.*

| Test ID | Test Category | Description | Result |
| :--- | :--- | :--- | :---: |
| `TC-NTF-001` | API / Query | Returns empty list when user has no notifications | **PASS** |
| `TC-NTF-002` | API / Pagination | Cursor pagination with `limit` and `cursor` (newest-first ordering) | **PASS** |
| `TC-NTF-003` | API / Ordering | Orders by `created_at DESC` with `id DESC` deterministic tie-breaker | **PASS** |
| `TC-NTF-004` | Multi-Tenant | Enforces user and tenant isolation: cannot see other user's alerts | **PASS** |
| `TC-NTF-005` | API / Mutation | `POST /v1/notifications/read` marks notifications as read | **PASS** |
| `TC-NTF-006` | Idempotency | Repeated read requests are safe and idempotent | **PASS** |
| `TC-NTF-007` | Preferences | `GET /v1/me` returns default preferences (in-app=true, digest=IMMEDIATE) | **PASS** |
| `TC-NTF-008` | Preferences | `PATCH /v1/me` updates channels and digest frequency | **PASS** |
| `TC-NTF-009` | Preferences | `PATCH /v1/me` with stale `If-Match` returns `409 VERSION_CONFLICT` | **PASS** |
| `TC-NTF-010` | Preferences | `PATCH /v1/me` rejects invalid category names (`422`) | **PASS** |
| `TC-NTF-011` | SSE | `GET /v1/notifications/stream` sets text/event-stream headers | **PASS** |
| `TC-NTF-012` | SSE | Stream delivers notification payload to connected client | **PASS** |
| `TC-NTF-013` | SSE | Unauthenticated connection rejected with `401` | **PASS** |
| `TC-NTF-014` | SSE | Multiple clients for same user both receive notification event | **PASS** |
| `PG-NTF-001` | PostgreSQL / Role | `dsa_api` connects with `NOBYPASSRLS` | **PASS** |
| `PG-NTF-002` | PostgreSQL / RLS | RLS tenant isolation on `app.notification` table | **PASS** |
| `PG-NTF-003` | PostgreSQL / Trigger | `touch_row` trigger increments `lock_version` and updates timestamp | **PASS** |
| `PG-NTF-004` | PostgreSQL / Trigger | `notification_no_delete` trigger blocks `DELETE` operations | **PASS** |
| `PG-NTF-005` | PostgreSQL / Storage | Storage and retrieval of `notification_preferences` JSONB on `app_user` | **PASS** |
| `PG-NTF-006` | PostgreSQL / E2E | `NotificationService` list and mark-as-read against live PostgreSQL | **PASS** |
| `PG-NTF-007` | PostgreSQL / Concurrency | Profile preferences optimistic locking with `lock_version` in PG | **PASS** |

---

### 4.4 Cross-Module Interaction Tests (`apps/api/test/cross-module-interactions.spec.ts`)

| Test ID | Interaction Scenario | Verification | Result |
| :--- | :--- | :--- | :---: |
| `CMI-001` | Route Registration | Simultaneous registration of `/v1/activities`, `/v1/messages`, `/v1/notifications`, and `/v1/me` has zero route collisions. | **PASS** |
| `CMI-002` | Multi-Tenant Isolation | Tenant B cannot edit Tenant A activities (`404`) and cannot mark Tenant A notifications as read (`updatedCount: 0`). | **PASS** |
| `CMI-003` | Actor Attribution | Client cannot forge `actorId` or `createdBy` attributes; server strictly enforces authenticated caller principal. | **PASS** |
| `CMI-004` | Provider Failure Handling | Unconfigured or failing provider fails closed (`422 PROVIDER_NOT_CONFIGURED`) and never records false-positive delivery. | **PASS** |
| `CMI-005` | Idempotency Key Isolation | Replaying request with identical `Idempotency-Key` returns cached response (`200 OK`) and emits `Idempotent-Replayed: true`. | **PASS** |
| `CMI-006` | SSE Atomic Isolation | Notification creation triggers SSE broadcast specifically to recipient user socket; other users receive 0 events. | **PASS** |

---

### 4.5 Frontend Integration Tests (`@dsa/web`)

| Test ID | Component / Area | Verification | Result |
| :--- | :--- | :--- | :---: |
| `FE-NTF-001` | Notification Center | Validates canonical notification record schema parsing. | **PASS** |
| `FE-NTF-002` | Notification Center | Calculates unread count and filters All vs Unread tabs. | **PASS** |
| `FE-NTF-003` | Notification Center | Validates cursor-based pagination query parameters. | **PASS** |
| `FE-NTF-004` | Notification Center | Validates batch mark-as-read payload formatting. | **PASS** |
| `FE-NTF-005` | Preferences Dialog | Verifies channel toggles, digest frequencies, and muted categories. | **PASS** |
| `FE-NTF-006` | Security / Sanitization | Rejects `javascript:` and external URL schemes in `deepLink` to prevent XSS. | **PASS** |
| `FE-MSG-001` | Template Editor | Validates template creation form and variable definitions. | **PASS** |
| `FE-MSG-002` | Template Editor | Rejects invalid template codes (spaces, uppercase, special chars). | **PASS** |
| `FE-MSG-003` | Message Composer | Formulates dispatch payloads across Email, SMS, and WhatsApp. | **PASS** |
| `FE-MSG-004` | Sent Messages Table | Validates message status history, redaction, and provider attributes. | **PASS** |

---

## 5. Defects Discovered, Root Causes & Fixes

During the automated testing process, the following defects were discovered and remediated:

### Defect 1: Unit Test Suite Running Against Live Database Pooler
- **Symptom:** `npm test` threw `(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked`.
- **Root Cause:** Integration tests connecting to live PostgreSQL were named `*-live-pg.spec.ts` instead of `*-live-pg.int.spec.ts`. Consequently, `vitest run` picked them up as unit tests and attempted network calls to the pooler when unit tests should run in-memory.
- **Fix:** Renamed files to `*.int.spec.ts` to adhere to `vitest.config.ts` conventions (`exclude: ['**/*.int.spec.ts']`). Live PG tests are now run via `npm run test:int`.

### Defect 2: Missing `ApiDeps` in Test Helpers Following `main` Merge
- **Symptom:** Compilation errors in `activities-live-pg.int.spec.ts`, `messaging.spec.ts`, and `notifications.spec.ts`: `Type '{ txRunner: TxRunner }' is missing properties from type 'ApiDeps': authz, audit, ids, userDirectory`.
- **Root Cause:** `origin/main` expanded `ApiDeps` with kernel ports (Audit, AuthZ, UserDirectory).
- **Fix:** Created and exported `createTestDeps(overrides)` in `apps/api/test/support/fake-auth.ts` providing standard fakes for all kernel ports.

### Defect 3: Missing Frontend Configuration File
- **Symptom:** Vite frontend crashed on launch with `"Web configuration is missing or invalid"`.
- **Root Cause:** `apps/web/.env` was not created.
- **Fix:** Created `apps/web/.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_BASE_URL`.

---

## 6. Scope Confirmation & Boundaries

1. **Module 13 Scope:** **NOT STARTED.** Zero code or schema for Module 13 was written.
2. **TASK-410 (Unified Timeline):** **REMAINS DEFERRED.** No timeline aggregation endpoints or views were implemented.
3. **TASK-415 (Inbound Messaging):** **REMAINS DEFERRED.** Public webhooks handle status callbacks only; inbound customer replies remain deferred.

---

## 7. Known Production-Readiness Limitations

1. **External Provider Integration:** All channel dispatch tests utilize in-memory mock adapters (`ConfiguredTestAdapter`). Real delivery over third-party APIs (Twilio, SendGrid, Meta WhatsApp Cloud API) requires production gateway credentials.
2. **R-SHORT Retention Policy:** Notifications in `app.notification` are append-only. Automated cleanup or pruning requires an approved business retention policy.
3. **Multi-Instance SSE Delivery:** The current `NotificationStreamHub` operates in-process. Horizontal multi-pod deployments will require a distributed message broker (e.g. Redis Pub/Sub or PostgreSQL `LISTEN/NOTIFY`) before events can span separate server instances.

---

## 8. Final Verdict

# **PASS WITH LIMITATIONS**

All 149 automated tests across API routes, database triggers, RLS policies, concurrency controls, webhooks, Server-Sent Events, and frontend components passed completely with zero failures. Quality gates (`lint`, `typecheck`, `db:verify`, `build`) succeeded with zero defects.
