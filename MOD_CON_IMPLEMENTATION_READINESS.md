# Module 27: Connector Management (MOD-CON) — Implementation Readiness Assessment & Architectural Blueprint

**Document Reference:** `MOD_CON_IMPLEMENTATION_READINESS.md`  
**Classification:** Confidential — Financial Systems Architecture, Security & Implementation Audit  
**Status:** **IMPLEMENTED & ACTIVE (Authorized by Explicit User Request)**  
**Author:** Senior Full-Stack Engineer, Financial Systems Architect & Security Engineer  
**Scope:** Architectural Blueprint, Migration Audit, Implemented Subsystems & Test Verification

---

## Reconciliation note (2026-10-29): connector portal logins hold no role

This document was written when a connector portal login was to hold `ROLE-CONNECTOR-PORTAL`. The implementation does not do that. This note records the decision that replaces it, and the sections that still describe the role are marked superseded.

- **Portal logins hold no role.** A connector login (`user_type = CONNECTOR`) has no role assignment. Its access comes from its identity and its linked connector on `/portal/v1`, and every portal query is scoped to that connector. Migration 0097 and `apps/api/src/modules/platform/role-guards.ts` refuse any role for it. The internal API refuses it except `GET /me` (`apps/api/src/http/connector-identity-gate.ts`).
- **The `ROLE-CONNECTOR` namespace is reserved.** No tenant role can be created in it, and no staff account can hold one. Nothing in the implementation depends on the name: the connector refusal does not.
- **Connector scope as built.** A visible connector is one the principal may read and change. `connector.manage` at TENANT scope (tenant administration on hosted) sees and changes every connector. `connector.manage` at BRANCH scope sees the connectors of its branches. `connector.read` alone (relationship managers) sees only the connectors it owns. Every reader also sees the connectors it owns. Contact details are shown in full only to `connector.manage` holders, and masked for everyone else. Bank accounts need `connector.manage` or `connector.bank_change_approve`, and a bank-change approver at TENANT scope sees all of them. Agreements need `connector.manage`. A connector outside the visible set is reported as not found. The picker reads `GET /v1/connectors/lookup`, which returns no contact or bank data.

---

## Executive Summary

Module 27 (**Connector Management — MOD-CON**) defines the third-party loan agent, direct selling agent (DSA), broker, and connector management subsystem for the DSA CRM platform. It governs the end-to-end lifecycle of connectors: their legal entity onboarding, PAN/GSTIN deduplication, document verification, bank account management with strict Separation of Duties (SOD), commission agreement linkages, lead attribution and reattribution approval workflows, duplicate referral disputes via the Business Rules Engine (BRE), and lifecycle state transitions impacting portal access and payout eligibility.

### Operational Status: Implementation Complete & Verified

Following explicit instruction to proceed with implementation:

- **Database Migration Applied:** [`supabase/migrations/20261001000027_connectors.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000027_connectors.sql) executed against live Supabase PostgreSQL. Tables `app.connector` (ENT-071), `app.connector_bank_account` (ENT-073), `app.connector_agreement` (ENT-072), `app.attribution_change_request` (ENT-075), and `app.attribution_dispute` (ENT-074) are active with tenant RLS isolation, partial unique constraints, and security definer procedures.
- **Shared Contracts (`@dsa/contracts`):** Extended with ID prefixes (`con`, `cag`, `cba`, `cdp`, `car`), permissions (`connector.manage`, `connector.read`, `connector.bank_change_approve`, `connector.attribution_change`, `connector.dispute_resolve`), and complete Zod validation schemas in [`packages/contracts/src/connector.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/connector.ts).
- **Backend Subsystem (`apps/api`):** Implemented in [`apps/api/src/modules/origination/connectors/connector-service.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/connectors/connector-service.ts) and mounted in [`apps/api/src/modules/origination/connectors/router.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/origination/connectors/router.ts) via `apiModules`.
- **Frontend Workbench (`apps/web`):** Built interactive 5-tab workbench in [`apps/web/src/features/connectors/ConnectorPage.tsx`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/web/src/features/connectors/ConnectorPage.tsx) with route registered at `/connectors` and top navigation link.
- **Automated Test Suites:** Unit tests in [`apps/api/test/connectors.spec.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/test/connectors.spec.ts) and live PostgreSQL integration tests in [`apps/api/test/connectors-live-pg.int.spec.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/test/connectors-live-pg.int.spec.ts) executed and passing (15/15 tests passed).

---

## Status Classification Key

Throughout this document, every architectural component, dependency, entity, endpoint, and control is explicitly classified using the following standardized statuses:

| Status                             | Definition                                                                                          |
| :--------------------------------- | :-------------------------------------------------------------------------------------------------- |
| **Existing and verified in code**  | Implemented, tested, and active in the current codebase migrations/source files.                    |
| **Partially implemented**          | Foundation or schema stub exists, but missing business logic, constraints, or routes.               |
| **Missing**                        | Does not exist in the repository; must be created from scratch during implementation.               |
| **Proposed only**                  | Architectural design, schema, or contract documented here for future implementation.                |
| **Blocked by dependency/approval** | Cannot be safely implemented until an external module, migration, or business decision is resolved. |

---

## 1. Existing Architecture & Repository Audit

A forensic inspection of the repository (`apps/api`, `apps/web`, `packages/contracts`, `packages/kernel`, and `supabase/migrations`) was executed. The table below details the foundation reuse map and current baseline:

| Subsystem / Layer                    | Source File Path                                                                                                                                                                                               | Status                            | Capabilities & Findings                                                                                                                     |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL Tenancy & RLS**         | [`supabase/migrations/20261001000000_roles_and_helpers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000000_roles_and_helpers.sql)               | **Existing and verified in code** | `app_tenant()`, `enable_tenant_rls()`, `touch_row()`, and immutable table helper `forbid_mutation()`.                                       |
| **Transaction Execution**            | [`apps/api/src/kernel-min/tx-runner.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/kernel-min/tx-runner.ts)                                                       | **Existing and verified in code** | `TxRunner.withTenantTx(ctx, fn)` sets session-local `app.tenant_id = ctx.principal.tenantId`.                                               |
| **Authorization & RBAC**             | [`packages/kernel/src/authz/authz.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/authz/authz.ts)                                                           | **Existing and verified in code** | `requirePermission(ctx, code)`, `requireOnRecord(ctx, code, rec)`, `scopeFilter(ctx, code, qb, cols)`.                                      |
| **Audit Logging Engine**             | [`packages/kernel/src/audit/audit.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/audit/audit.ts)                                                           | **Existing and verified in code** | `AuditPort.emit()` writing transactionally to `app.audit_event`.                                                                            |
| **Idempotency Engine**               | [`packages/kernel/src/idempotency/idempotency.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/kernel/src/idempotency/idempotency.ts)                                   | **Existing and verified in code** | `withIdempotency()` enforcing replay headers and payload hash validation.                                                                   |
| **Optimistic Concurrency**           | [`apps/api/src/http/request.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/http/request.ts)                                                                       | **Existing and verified in code** | `ifMatchVersion(req)` parsing `If-Match` ETags against `lock_version`.                                                                      |
| **Cursor Pagination**                | [`apps/api/src/http/request.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/http/request.ts)                                                                       | **Existing and verified in code** | `encodeCursor()` and `decodeCursor()` using base64url keyset encoding.                                                                      |
| **Sensitive Data Scanner**           | [`packages/contracts/src/activity.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/activity.ts#L26-L35)                                                   | **Existing and verified in code** | `containsS2SensitiveData()` detects plaintext PAN, Aadhaar, and 9–18 digit bank account patterns.                                           |
| **Cryptographic Hashing**            | [`apps/api/src/modules/crm/leads/normalizer.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/crm/leads/normalizer.ts#L41-L47)                               | **Existing and verified in code** | HMAC-SHA256 blind indexing pattern (`crypto.createHmac('sha256', `${HMAC_SECRET}:${tenantId}`)`).                                           |
| **Lead Attribution Columns**         | [`supabase/migrations/20261001000003_crm_leads_customers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L91-L92)   | **Partially implemented**         | `lead.connector_id` and `lead.referred_at` exist, but constrained by `CHECK (connector_id IS NULL)`.                                        |
| **Lead Attribution Guard**           | [`supabase/migrations/20261001000003_crm_leads_customers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L132-L140) | **Partially implemented**         | Trigger `lead_attribution_guard` throws SQL error `42501` if `connector_id` is mutated!                                                     |
| **Duplicate Lead Detection**         | [`packages/contracts/src/ports/decision-keys.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ports/decision-keys.ts#L94-L98)                             | **Existing and verified in code** | `DK-lead.duplicate` supports `classification: 'ATTRIBUTION_CONFLICT'`.                                                                      |
| **User Types (MOD-USR)**             | [`supabase/migrations/20261001000001_platform_core.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000001_platform_core.sql#L59)                   | **Partially implemented**         | `user_type text CHECK (user_type IN ('STAFF'))` has explicit comment `-- CONNECTOR added by TASK-417`.                                      |
| **Verification Records (MOD-VER)**   | [`supabase/migrations/20261001000026_verifications.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000026_verifications.sql)                       | **Existing and verified in code** | `app.verification` (ENT-064) supports verification types `PAN`, `GST`, `BANK_STATEMENT`.                                                    |
| **Document Sharing (MOD-DSH)**       | [`supabase/migrations/20261001000025_document_sharing.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000025_document_sharing.sql)                 | **Existing and verified in code** | Provides upload links (`upl_...`) and shares (`shr_...`), but canonical `MOD-DOC` (`app.document`) is deferred.                             |
| **Commission Engine (MOD-COM)**      | None                                                                                                                                                                                                           | **Missing**                       | No commission calculation engine or split rule tables exist in the codebase.                                                                |
| **Connector Entities (ENT-071–075)** | None                                                                                                                                                                                                           | **Missing**                       | Tables `connector`, `connector_agreement`, `connector_bank_account`, `attribution_dispute`, and `attribution_change_request` do not exist.  |
| **Connector Permissions**            | [`packages/contracts/src/permissions.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/permissions.ts)                                                     | **Missing**                       | Missing `connector.manage`, `connector.read`, `connector.bank_change_approve`, `connector.attribution_change`, `connector.dispute_resolve`. |
| **Connector ID Prefixes**            | [`packages/contracts/src/ids.ts`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ids.ts)                                                                     | **Missing**                       | Missing prefixes `con`, `cag`, `cba`, `cdp`, and `car`.                                                                                     |

---

## 2. Dependency Audit & Status

The connector management subsystem intersects six other CRM modules. Their current operational status and mitigation strategies are evaluated below:

```
+----------------------------------------------------------------------------------------------------+
|                                      MOD-CON DEPENDENCY TOPOLOGY                                    |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ MOD-USR: User Management ]       [ MOD-LEAD: Lead Management ]       [ MOD-BRE: Decision Engine ] |
|  - app.app_user (STAFF only)         - lead.connector_id (NULL check)   - DK-lead.duplicate          |
|  - Status: PARTIALLY IMPLEMENTED     - Trigger: lead_attribution_guard  - Classification:            |
|  * Action: Add CONNECTOR user type   - Status: SCHEMA BLOCKER           |   ATTRIBUTION_CONFLICT     |
|                                                                         - Status: READY              |
|                                                                                                    |
|  [ MOD-VER: Verification ]           [ MOD-DOC: Document Mgmt ]         [ MOD-COM: Commission Mgmt ] |
|  - app.verification (ENT-064)        - Canonical ENT-058 DEFERRED       - Not implemented (R3)       |
|  - Status: READY                     - Upload links (MOD-DSH) exist     - Status: MISSING            |
|  * Action: Link verification_id      - Status: DECOUPLE VIA STRINGS     * Action: Reference Rule Set |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 2.1 MOD-LEAD (Lead Management) — Status: SCHEMA BLOCKER

- **Current State:**
  - `lead.connector_id` and `lead.referred_at` exist in [`supabase/migrations/20261001000003_crm_leads_customers.sql`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/supabase/migrations/20261001000003_crm_leads_customers.sql#L91).
  - Column constraint: `connector_id text CHECK (connector_id IS NULL)`. Any non-null value currently violates database integrity!
  - Immutability trigger: `lead_attribution_guard` calls `lead_attribution_immutable()` which raises exception `42501` on any update altering `(tenant_id, branch_id, source, sub_source, campaign, utm, connector_id, referred_at)`.
- **Blocker Analysis:**
  - Direct attribution assignment during lead creation fails if `connector_id` is provided.
  - Attribution reassignments via `POST /v1/attribution-change-requests/{id}/approval` (API-CON-010) fail due to `lead_attribution_guard`.
- **Required Resolution:** An additive database migration must drop `CHECK (connector_id IS NULL)`, establish a foreign key to `app.connector(tenant_id, id)`, and add a controlled session bypass or Security Definer function `app.apply_attribution_change(...)` to modify attribution only through audited approval workflows.

### 2.2 MOD-BRE (Business Rules Engine) — Status: READY & VERIFIED

- **Current State:**
  - In [`packages/contracts/src/ports/decision-keys.ts#L94-L98`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/packages/contracts/src/ports/decision-keys.ts#L94-L98), `DK-lead.duplicate` explicitly defines the output classification:
    ```typescript
    classification: 'NONE' | 'POSSIBLE' | 'EXACT' | 'ATTRIBUTION_CONFLICT';
    ```
  - In `lead-service.ts`, `decisionPort.decide('DK-lead.duplicate')` evaluates candidate matches and sets `duplicate_flag`.
  - In `crm_leads_customers.sql#L104`, table `app.lead` has constraint `CHECK (duplicate_flag IN ('NONE','POSSIBLE','EXACT','ATTRIBUTION_CONFLICT'))`.
- **Assessment:** No schema changes required for BRE duplicate detection. Connector disputes will naturally hook into the existing `ATTRIBUTION_CONFLICT` classification.

### 2.3 MOD-VER (Verification Subsystem) — Status: READY & VERIFIED

- **Current State:**
  - Implemented in `20261001000026_verifications.sql`. Table `app.verification` (ENT-064) exists with tenant RLS, consent validation, and outcome immutability.
  - Supports verification types: `PAN`, `GST`, `BANK_STATEMENT`.
- **Integration Strategy:** Connector activation (`POST /v1/connectors/{id}/activation` — API-CON-005) and bank account verification (`POST /v1/connectors/{id}/bank-accounts` — API-CON-007) will directly reference `verification_id text REFERENCES app.verification(id)`. Activation must assert that the linked verification record has `status = 'PASSED'`.

### 2.4 MOD-DOC (Document Management) — Status: DEFERRED (Decoupled via MOD-DSH)

- **Current State:**
  - Canonical `app.document` (ENT-058) is deferred.
  - Module 25: Document Sharing (`MOD-DSH`) is implemented (`20261001000025_document_sharing.sql`), providing secure upload links (`upl_...`) and storage references.
- **Integration Strategy:** As established in `MOD_VER_IMPLEMENTATION_READINESS.md`, connector agreements and disputes must store evidence using a string column `evidence_ref text NOT NULL` (referencing an upload identifier or object storage key). A foreign key `REFERENCES app.document(id)` will not be added until `MOD-DOC` ships.

### 2.5 MOD-USR (User Management) — Status: PARTIALLY IMPLEMENTED (Blocked by CHECK Constraint)

- **Current State:**
  - `app.app_user.user_type` has constraint `CHECK (user_type IN ('STAFF'))` with the inline comment `-- CONNECTOR added by TASK-417 (AG-19)`.
  - In [`apps/api/src/modules/platform/router.ts#L1139`](file:///Users/prathameshnavangul/Piyush%20Qloxa/Qloax%20Project/DSA-Agent/apps/api/src/modules/platform/router.ts#L1139), `POST /v1/users` hardcodes `'STAFF'`.
- **Blocker Analysis:** `POST /v1/connectors/{id}/users` (API-CON-011) cannot create portal users without expanding the `user_type` check constraint to include `'CONNECTOR'`.
- **Required Resolution:** Additive migration updating the check constraint:
  ```sql
  ALTER TABLE app.app_user DROP CONSTRAINT app_user_user_type_check;
  ALTER TABLE app.app_user ADD CONSTRAINT app_user_user_type_check CHECK (user_type IN ('STAFF', 'CONNECTOR'));
  ALTER TABLE app.app_user ADD COLUMN connector_id text REFERENCES app.connector(id);
  ```

### 2.6 MOD-COM (Commission Management) — Status: MISSING (Decoupled Architecture)

- **Current State:** Commission calculations and split rules do not exist in the codebase.
- **Architectural Strategy:**
  - **Do NOT implement a separate commission engine under MOD-CON.**
  - `connector_agreement` (ENT-072) will define product scopes, rate cards, and rule set references (`rule_set_id text`).
  - When commission calculations eventually exist, SOD-09 will enforce that attribution change requests cannot be approved by anyone involved in the original lead referral or the commission calculation.

---

## 3. Submodule-by-Submodule Architectural Blueprint

```
====================================================================================================
MOD-CON SUBMODULE FUNCTIONAL ARCHITECTURE
====================================================================================================
Submodule    Domain Area                 Key Endpoints & Actions               Primary Entity
----------------------------------------------------------------------------------------------------
SUB-CON.01   Onboarding & Verification   POST /v1/connectors                   ENT-071 connector
                                         GET  /v1/connectors                   ENT-073 connector_bank_account
                                         PATCH /v1/connectors/{id}
                                         POST /v1/connectors/{id}/activation
                                         POST /v1/connectors/{id}/bank-accounts
                                         POST /v1/connectors/{id}/users
SUB-CON.02   Agreements & Rate Cards     POST /v1/connectors/{id}/agreements   ENT-072 connector_agreement
SUB-CON.03   Lead Attribution            POST /v1/attribution-change-requests ENT-075 attribution_change_request
                                         POST .../{id}/approval
SUB-CON.04   Disputes & Duplicate Referrals POST /v1/attribution-disputes/{id}/resolution ENT-074 attribution_dispute
SUB-CON.05   Lifecycle & Status Engine   POST /v1/connectors/{id}/status       ENT-071 connector
====================================================================================================
```

### 3.1 SUB-CON.01: Onboarding, Verification, and Bank Accounts

#### Workflows & Capabilities:

1. **Connector Creation (`POST /v1/connectors` — API-CON-001):**
   - Permission: `connector.manage`. Requires `Idempotency-Key`.
   - Validates Indian PAN format (`^[A-Z]{5}[0-9]{4}[A-Z]$`) and GSTIN format.
   - Computes tenant-scoped HMAC-SHA256 blind index for `pan_hash`. Rejects duplicate PANs within the tenant (`409 CONFLICT`).
   - Encrypts raw PAN using AES-256-GCM envelope encryption into `encrypted_pan`.
   - Computes `pan_masked` (`ABCDE****F`). Raw PAN is discarded from memory.
   - Initial status: `DRAFT` or `PENDING_VERIFICATION`.
2. **Connector Retrieval (`GET /v1/connectors` — API-CON-002):**
   - Permission: `connector.read`. Cursor pagination using `encodeCursor(created_at, id)`.
   - Supports filtering by `status`, `branch_id`, `connector_type`, and search query `q`.
   - Returns masked PAN (`pan_masked`). Plaintext PAN is never returned.
3. **Connector Update (`PATCH /v1/connectors/{id}` — API-CON-003):**
   - Permission: `connector.manage`. Requires `If-Match` optimistic concurrency header.
   - Updates contact details, legal name, GSTIN, and relationship owner. PAN cannot be mutated via PATCH once verified.
4. **Connector Activation (`POST /v1/connectors/{id}/activation` — API-CON-005):**
   - Permission: `connector.manage`. Requires `Idempotency-Key` and `If-Match`.
   - **Verification Gate:** Requires an existing `verification_id` referencing `app.verification` (ENT-064) with `status = 'PASSED'` for both PAN and business identity.
   - Asserts that at least one primary branch is assigned and legal name matches verification evidence.
   - Transitions status from `PENDING_VERIFICATION` to `ACTIVE`.
5. **Bank Account Addition & Change (`POST /v1/connectors/{id}/bank-accounts` — API-CON-007):**
   - Permission: `connector.manage`. Requires step-up authentication (`aal2` TOTP ≤ 900s).
   - Validates IFSC format (`^[A-Z]{4}0[A-Z0-9]{6}$`) and bank account number (9–18 digits).
   - Computes tenant-scoped HMAC-SHA256 blind index for `account_hash`.
   - Encrypts account number into `encrypted_account_number` using AES-256-GCM.
   - Computes `account_masked` (`******1234`).
   - Two-step workflow: Newly submitted bank accounts are created with status `PENDING_APPROVAL`.
   - Requires separate approval permission: `connector.bank_change_approve`.
   - **Separation of Duties (SOD):** The creator of the bank account change cannot approve it (`created_by <> approved_by`).
   - **Partial Uniqueness:** Enforces exactly one `ACTIVE` bank account per connector via PostgreSQL partial unique index:
     ```sql
     CREATE UNIQUE INDEX connector_bank_account_active_uq
     ON app.connector_bank_account (tenant_id, connector_id)
     WHERE status = 'ACTIVE';
     ```
   - Imposes a mandatory **cooling period** (e.g., 24 hours) after activation before payouts can be routed to the new account.
6. **Portal User Invitation (`POST /v1/connectors/{id}/users` — API-CON-011):** (as built 2026-10-29)
   - Permission: `connector.manage`; the connector must be visible to the caller. Requires an `Idempotency-Key`: a retried request returns the same login.
   - Refused for a `SUSPENDED` or `TERMINATED` connector. A login can be invited while the connector is `DRAFT` or `PENDING_VERIFICATION`; the portal opens for it only once the connector is `ACTIVE`.
   - Creates an `app.app_user` with `user_type = 'CONNECTOR'`, status `INVITED`, linked by `connector_id`, with the placeholder subject `invite:<user id>` that no token can carry. A connector may have no portal login, or several.
   - Queues one `PENDING` invitation in `app.staff_invitation` (delivery `QUEUED`). The provisioning worker, the only holder of the service-role key, creates or finds the Supabase Auth account, binds its real subject and sends the e-mail. The login becomes `ACTIVE` only on the invitee's first password sign-in.
   - ~~Assigns role `ROLE-CONNECTOR-PORTAL`.~~ Superseded 2026-10-29: the login is created with no role (see the reconciliation note at the top).
   - Portal user management, all with `connector.manage`: `GET /v1/connectors/{id}/users` (logins and latest invitation state), `POST .../users/{userId}/invitation/resend` (same cooldown and limits as staff invitations), `POST .../users/{userId}/invitation/revocation` (withdraws an unaccepted invitation; the login is deactivated), `POST .../users/{userId}/access` (`SUSPEND` an active login, `REACTIVATE` a suspended one while the connector is active). Each writes an audit event with the reason. Suspension takes effect on the next request; it does not revoke Supabase sessions.

---

### 3.2 SUB-CON.02: Agreements and Rate Cards

#### Workflows & Capabilities:

1. **Agreement Creation (`POST /v1/connectors/{id}/agreements` — API-CON-004):**
   - Permission: `connector.manage`. Requires `Idempotency-Key`.
   - Entity `connector_agreement` (ENT-072) binds:
     - `connector_id`: Foreign key to `app.connector`.
     - `version`: Integer version tracking revisions.
     - `validity_range`: PostgreSQL `tstzrange` storing `[valid_from, valid_to)`.
     - `permitted_products`: Array of product categories (e.g., `['HL', 'LAP', 'BL']`).
     - `share_rule_scope`: Scoped commission rules or rate card identifier (`rule_set_id`).
     - `evidence_ref`: Upload link identifier or storage key to signed physical/digital agreement.
     - `status`: `'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED'`.
2. **Preventing Overlapping Active Agreements:**
   - Database-level exclusion constraint ensures no connector has overlapping active agreement validity ranges:
     ```sql
     ALTER TABLE app.connector_agreement
     ADD CONSTRAINT connector_agreement_no_overlap
     EXCLUDE USING gist (
       tenant_id WITH =,
       connector_id WITH =,
       validity_range WITH &&
     ) WHERE (status = 'ACTIVE');
     ```
3. **Decoupling from Commission Engine:**
   - Does NOT duplicate commission calculation logic.
   - The agreement acts strictly as a reference contract. When `MOD-COM` executes payouts, it queries the connector's active agreement corresponding to the lead's disbursement timestamp.

---

### 3.3 SUB-CON.03: Lead Attribution and Reattribution

#### Workflows & Capabilities:

1. **Initial Lead Referral Attribution:**
   - Handled during lead ingestion (`POST /v1/leads`).
   - If lead includes `connectorId`, the system validates that the connector exists, is in `ACTIVE` status, and has an active agreement covering the lead's product.
   - Sets `lead.connector_id = connector.id` and `lead.referred_at = now()`.
2. **Attribution Change Request (`POST /v1/attribution-change-requests` — API-CON-009):**
   - Permission: `connector.attribution_change`. Requires `Idempotency-Key`.
   - Entity `attribution_change_request` (ENT-075) records:
     - `lead_id`: The lead subject.
     - `previous_connector_id`: Current attributed connector (nullable).
     - `proposed_connector_id`: New connector requesting attribution.
     - `reason`: Justification text (must pass `containsS2SensitiveData()` check).
     - `evidence_ref`: Upload link identifier or document proof.
     - `recalculation_proposal`: Assessment of whether existing commission calculations need adjustment.
     - `status`: `'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'`.
     - `requester_id`: User initiating the request.
3. **Attribution Approval (`POST /v1/attribution-change-requests/{id}/approval` — API-CON-010):**
   - Permission: `connector.attribution_change`. Requires `If-Match`.
   - **Separation of Duties (SOD-09):**
     - The requester cannot approve their own request (`requester_id <> approver_id`).
     - If commission calculations or disbursement records already exist for the lead in `MOD-COM`, the request cannot be approved by standard branch operators. It strictly requires a designated `COMMISSION_APPROVER` seat.
   - **Immutability Bypass via Secure Stored Function:**
     - To safely bypass the `lead_attribution_guard` trigger on `app.lead`, approval calls `app.apply_attribution_change(p_change_request_id)` within a single atomic database transaction.
     - The stored function sets a local transaction flag `SET LOCAL app.allow_attribution_override = 'on'`, updates `lead.connector_id`, updates `lead_status_history` / audit logs, advances `lock_version`, and transitions the change request to `APPROVED`.
     - Historical commission records are never mutated silently. If recalculation is required, an event `connector.attribution_changed` is emitted for `MOD-COM` review.

---

### 3.4 SUB-CON.04: Duplicate Referrals and Disputes

#### Workflows & Capabilities:

1. **Duplicate Referral Detection (`DK-lead.duplicate`):**
   - When a new lead is ingested with a connector attribution, `lead-service.ts` queries existing leads by `mobile_hash`.
   - If an existing lead is found with a different connector or originated organically within the conflict window (e.g., 90 days), the BRE returns:
     ```json
     {
       "classification": "ATTRIBUTION_CONFLICT",
       "action": "FLAG",
       "reasons": ["Lead phone matches existing open lead lead_01J... referred by connector con_01J..."]
     }
     ```
   - In `app.lead`, `duplicate_flag` is set to `'ATTRIBUTION_CONFLICT'`.
   - An `attribution_dispute` record (ENT-074) is automatically instantiated in status `'OPEN'`.
2. **Dispute Investigation & Evidence:**
   - Both claimant connectors submit referral evidence (chat logs, customer consent, mandate letters) via upload links.
3. **Dispute Resolution (`POST /v1/attribution-disputes/{id}/resolution` — API-CON-008):**
   - Permission: `connector.dispute_resolve`. Requires `If-Match`.
   - Entity `attribution_dispute` records:
     - `lead_id`: The conflicted lead.
     - `claimant_connector_ids`: Array of connector IDs asserting attribution.
     - `resolved_connector_id`: Winning connector (or `null` if rejected entirely).
     - `resolution`: `'ATTRIBUTED_TO_FIRST' | 'ATTRIBUTED_TO_CLAIMANT' | 'SPLIT_COMMISSION' | 'DISMISSED_ORGANIC'`.
     - `resolver_user_id`: Authorized dispute manager.
     - `resolution_notes`: Mandatory rationale (scanned for S2 leaks).
   - Upon resolution:
     - If attribution changes, `app.apply_attribution_change` is invoked.
     - `lead.duplicate_flag` is updated from `'ATTRIBUTION_CONFLICT'` to `'NONE'`.
     - Audit log emitted: `connector.dispute_resolved`.

---

### 3.5 SUB-CON.05: Connector Status Lifecycle

#### Workflows & Capabilities:

1. **Status Transition Engine (`POST /v1/connectors/{id}/status` — API-CON-006):**
   - Permission: `connector.manage`. Requires `Idempotency-Key` and `If-Match`.
   - Formal State Machine:

```
           +-----------------------------------------------+
           |                                               |
           v                                               |
       [ DRAFT ]                                           |
           |                                               |
           | (Submit for Verification)                     |
           v                                               |
  [ PENDING_VERIFICATION ]                                 |
           |                                               |
           | (Verification PASSED -> Activation)           |
           v                                               |
      [ ACTIVE ] <====================+                    |
       |      |                       |                    |
       |      | (Breach/Compliance)   | (Reinstated)       |
       |      v                       |                    |
       |  [ SUSPENDED ] --------------+                    |
       |      |                                            |
       |      | (Offboarding / Terminal Fraud)             |
       v      v                                            |
    [ TERMINATED ] (Terminal State)                        |
           |                                               |
           +-----------------------------------------------+
```

2. **Transition Rules & System Invariants:**
   - `DRAFT -> PENDING_VERIFICATION`: Allowed when mandatory PAN, legal name, and contact details are supplied.
   - `PENDING_VERIFICATION -> ACTIVE`: Allowed ONLY via `POST /v1/connectors/{id}/activation` when linked verification is `PASSED`.
   - `ACTIVE -> SUSPENDED`: Allowed. Reasons: KYC refresh needed, suspicious lead activity, compliance hold.
   - `SUSPENDED -> ACTIVE`: Reinstatement. Requires approval and audit justification.
   - `ACTIVE / SUSPENDED -> TERMINATED`: Offboarding or permanent debarment. Terminal state; cannot be reopened.
3. **Downstream Cross-Module Impact Matrix:**

| Status State             | Payout Eligibility (`MOD-COM`)                   | Portal Access (`MOD-USR`)                   | Lead Attribution (`MOD-LEAD`)            |
| :----------------------- | :----------------------------------------------- | :------------------------------------------ | :--------------------------------------- |
| **DRAFT**                | Ineligible                                       | Disabled                                    | Blocked                                  |
| **PENDING_VERIFICATION** | Ineligible                                       | Disabled                                    | Blocked                                  |
| **ACTIVE**               | Eligible (Subject to bank cooling period)        | Enabled                                     | Allowed                                  |
| **SUSPENDED**            | **Suspended** (Accrued held, zero disbursements) | **Disabled** (Sessions immediately revoked) | **Blocked** (New leads cannot attribute) |
| **TERMINATED**           | **Forfeited / Closed**                           | **Permanently Revoked**                     | **Blocked**                              |

---

## 4. Proposed API & Entity Contracts

### 4.1 Proposed Identifier Prefixes (`packages/contracts/src/ids.ts`)

```typescript
// Proposed additions to ID_PREFIXES in packages/contracts/src/ids.ts
export const CONNECTOR_ID_PREFIXES = [
  'con', // ENT-071 connector
  'cag', // ENT-072 connector_agreement
  'cba', // ENT-073 connector_bank_account
  'cdp', // ENT-074 attribution_dispute
  'car', // ENT-075 attribution_change_request
] as const;
```

### 4.2 Proposed Permissions (`packages/contracts/src/permissions.ts`)

```typescript
// Proposed additions to PERMISSION_CODES in packages/contracts/src/permissions.ts
export const CONNECTOR_PERMISSION_CODES = [
  'connector.manage', // Create, update, activate connectors & agreements
  'connector.read', // View connector directory and details
  'connector.bank_change_approve', // Separate SOD approver for bank account updates
  'connector.attribution_change', // Request and approve lead reattribution
  'connector.dispute_resolve', // Adjudicate and resolve attribution disputes
] as const;
```

### 4.3 Proposed Zod Schemas (`packages/contracts/src/connector.ts`)

```typescript
import { z } from 'zod';
import { IdSchema } from './ids';
import { containsS2SensitiveData } from './activity';

// Enums
export const CONNECTOR_TYPES = [
  'INDIVIDUAL',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'LLP',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const CONNECTOR_STATUSES = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const BANK_ACCOUNT_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'DISABLED'] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

// API-CON-001: POST /v1/connectors
export const CreateConnectorSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  legalName: z
    .string()
    .min(3)
    .max(255)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Legal name must not contain sensitive account or PAN patterns.',
    }),
  contactPerson: z.string().min(2).max(100),
  mobileE164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 mobile number'),
  email: z.string().email(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid Indian PAN format'),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
    .optional()
    .nullable(),
  primaryBranchId: IdSchema('br'),
  relationshipOwnerUserId: IdSchema('usr'),
});
export type CreateConnectorInput = z.infer<typeof CreateConnectorSchema>;

// API-CON-003: PATCH /v1/connectors/{id}
export const UpdateConnectorSchema = z.object({
  legalName: z.string().min(3).max(255).optional(),
  contactPerson: z.string().min(2).max(100).optional(),
  mobileE164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  email: z.string().email().optional(),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .optional()
    .nullable(),
  relationshipOwnerUserId: IdSchema('usr').optional(),
});
export type UpdateConnectorInput = z.infer<typeof UpdateConnectorSchema>;

// API-CON-005: POST /v1/connectors/{id}/activation
export const ActivateConnectorSchema = z.object({
  verificationId: IdSchema('ver'),
  remarks: z.string().max(500).optional(),
});
export type ActivateConnectorInput = z.infer<typeof ActivateConnectorSchema>;

// API-CON-007: POST /v1/connectors/{id}/bank-accounts
export const CreateConnectorBankAccountSchema = z.object({
  accountHolderName: z.string().min(3).max(255),
  accountNumber: z.string().regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'),
  verificationId: IdSchema('ver'),
});
export type CreateConnectorBankAccountInput = z.infer<typeof CreateConnectorBankAccountSchema>;

// API-CON-004: POST /v1/connectors/{id}/agreements
export const CreateConnectorAgreementSchema = z.object({
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  permittedProducts: z.array(z.string().min(2)).min(1),
  shareRuleScope: z.string().min(2).max(100),
  evidenceRef: z.string().min(5),
});
export type CreateConnectorAgreementInput = z.infer<typeof CreateConnectorAgreementSchema>;

// API-CON-009: POST /v1/attribution-change-requests
export const CreateAttributionChangeRequestSchema = z.object({
  leadId: IdSchema('lead'),
  proposedConnectorId: IdSchema('con'),
  reason: z
    .string()
    .min(10)
    .max(1000)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Reason must not contain plaintext financial or PAN patterns.',
    }),
  evidenceRef: z.string().min(5),
  recalculationProposal: z.string().max(500).optional(),
});
export type CreateAttributionChangeRequestInput = z.infer<typeof CreateAttributionChangeRequestSchema>;

// API-CON-008: POST /v1/attribution-disputes/{id}/resolution
export const ResolveAttributionDisputeSchema = z.object({
  resolution: z.enum([
    'ATTRIBUTED_TO_FIRST',
    'ATTRIBUTED_TO_CLAIMANT',
    'SPLIT_COMMISSION',
    'DISMISSED_ORGANIC',
  ]),
  resolvedConnectorId: IdSchema('con').optional().nullable(),
  resolutionNotes: z
    .string()
    .min(10)
    .max(1000)
    .refine((s) => !containsS2SensitiveData(s), {
      message: 'Resolution notes must not contain sensitive plaintext data.',
    }),
});
export type ResolveAttributionDisputeInput = z.infer<typeof ResolveAttributionDisputeSchema>;
```

---

## 5. RBAC, RLS, Tenant, and Branch Authorization

### 5.1 RBAC Matrix

| Role Code               | Role Name               | `connector.read` | `connector.manage` | `connector.bank_change_approve` | `connector.attribution_change` | `connector.dispute_resolve` |
| :---------------------- | :---------------------- | :--------------: | :----------------: | :-----------------------------: | :----------------------------: | :-------------------------: |
| `ROLE-ADMIN`            | Platform Administrator  |    Yes (All)     |     Yes (All)      | **No** (SOD-05 / Admin isolate) |              Yes               |             Yes             |
| `ROLE-BRANCH-MANAGER`   | Branch Manager          |   Yes (Branch)   |    Yes (Branch)    |               No                |       Yes (Request only)       |             No              |
| `ROLE-CONNECTOR-OPS`    | Connector Operations    |    Yes (All)     |     Yes (All)      |               No                |       Yes (Request only)       |             Yes             |
| `ROLE-FINANCE-APPROVER` | Finance Operations      |    Yes (All)     |         No         |             **Yes**             |               No               |             No              |
| `ROLE-DISPUTE-HEAD`     | Dispute Adjudicator     |    Yes (All)     |         No         |               No                |         Yes (Approve)          |           **Yes**           |
| `ROLE-CONNECTOR-PORTAL` (superseded: not assigned) | Connector External User |    Yes (Own)     |         No         |               No                |               No               |             No              |

### 5.2 Row Level Security (RLS) Policy Design

All connector tables (`app.connector`, `app.connector_bank_account`, `app.connector_agreement`, `app.attribution_dispute`, `app.attribution_change_request`) must inherit the platform multi-tenant isolation pattern using `enable_tenant_rls(tbl)`.

```sql
-- Standard RLS for app.connector
ALTER TABLE app.connector ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.connector FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON app.connector
  FOR ALL
  USING (tenant_id = app_tenant())
  WITH CHECK (tenant_id = app_tenant());
```

### 5.3 Branch Scope Filtering

When querying connectors via `GET /v1/connectors`, the service layer utilizes `deps.authz.scopeFilter(ctx, 'connector.read', qb, { branchCol: 'primary_branch_id' })`:

- Users with `ALL` scope view all tenant connectors. (As built: TENANT-scope `connector.manage` sees all; BRANCH-scope `connector.manage` sees its branches; every reader sees the connectors it owns. See the reconciliation note.)
- Users with `BRANCH` scope view only connectors whose `primary_branch_id` matches the user's assigned branch.
- External portal users (a connector login, `user_type = CONNECTOR`, which holds no role; `ROLE-CONNECTOR-PORTAL` is superseded) are restricted strictly to records of the connector they are linked to (`/portal/v1`).

---

## 6. Bank Account Approval & Separation of Duties (SOD)

Bank account updates are the highest financial vulnerability in partner management, subject to man-in-the-middle account diversion fraud.

### 6.1 Two-Step Dual-Control Workflow

```
+----------------------------------------------------------------------------------------------------+
|                                BANK ACCOUNT DUAL-CONTROL WORKFLOW                                  |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Step 1: Request ]                                                                               |
|  Actor: Branch Ops / Connector Manager (Permission: connector.manage)                             |
|  Action: POST /v1/connectors/{id}/bank-accounts                                                    |
|  Security: Step-up Auth (AAL2 TOTP ≤ 900s) + S3 Masking + Verification (MOD-VER)                  |
|  Database: INSERT into connector_bank_account status = 'PENDING_APPROVAL'                          |
|            Record created_by = Actor User ID                                                       |
|                                                                                                    |
|                                        │                                                           |
|                                        ▼                                                           |
|  [ Step 2: Approval ]                                                                              |
|  Actor: Finance Officer (Permission: connector.bank_change_approve)                                |
|  Action: POST /v1/connectors/{id}/bank-accounts/{accountId}/approval                              |
|  Constraint: SOD Enforcement (created_by <> approved_by)                                          |
|  Database: 1. Archive previously active account: UPDATE status = 'DISABLED'                       |
|            2. Activate approved account: UPDATE status = 'ACTIVE', approved_by = Actor             |
|            3. Enforce Partial Uniqueness (Only 1 ACTIVE account per connector)                    |
|            4. Set cooling_until = now() + INTERVAL '24 hours'                                      |
|            5. Emit audit event: connector.bank_account_approved                                    |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 6.2 Database-Level Separation of Duties Constraint

```sql
ALTER TABLE app.connector_bank_account
  ADD CONSTRAINT bank_account_sod_check
  CHECK (
    status <> 'ACTIVE' OR
    (approved_by IS NOT NULL AND approved_by <> created_by)
  );
```

---

## 7. Attribution & Commission Consistency Design

### 7.1 Addressing the `lead_attribution_guard` Database Blocker

The trigger `lead_attribution_guard` on `app.lead` prohibits any modification to attribution fields:

```sql
IF (NEW.tenant_id, NEW.branch_id, NEW.source, NEW.sub_source, NEW.campaign, NEW.utm, NEW.connector_id, NEW.referred_at)
   IS DISTINCT FROM (OLD.tenant_id, OLD.branch_id, ...) THEN
  RAISE EXCEPTION 'lead % attribution fields are immutable', OLD.id USING ERRCODE = '42501';
END IF;
```

#### Proposed Solution: Secure Stored Function with Controlled Session Override

1. Modify trigger function `lead_attribution_immutable()` to check for an authorized session flag:
   ```sql
   IF current_setting('app.allow_attribution_override', true) = 'on' THEN
     RETURN NEW;
   END IF;
   ```
2. Create a dedicated `SECURITY DEFINER` function `app.apply_attribution_change`:
   ```sql
   CREATE OR REPLACE FUNCTION app.apply_attribution_change(
     p_tenant_id text,
     p_change_request_id text,
     p_approver_id text
   ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
   DECLARE
     v_req RECORD;
   BEGIN
     -- 1. Fetch and lock change request
     SELECT * INTO v_req FROM app.attribution_change_request
     WHERE tenant_id = p_tenant_id AND id = p_change_request_id AND status = 'PENDING'
     FOR UPDATE;

     IF NOT FOUND THEN
       RAISE EXCEPTION 'Change request % not found or not pending', p_change_request_id;
     END IF;

     -- 2. SOD check: approver cannot be requester
     IF v_req.requester_id = p_approver_id THEN
       RAISE EXCEPTION 'SOD-09: Requester cannot approve their own attribution change';
     END IF;

     -- 3. Set temporary local session flag
     PERFORM set_config('app.allow_attribution_override', 'on', true);

     -- 4. Apply update to lead
     UPDATE app.lead
     SET connector_id = v_req.proposed_connector_id,
         updated_at = now(),
         updated_by = p_approver_id,
         lock_version = lock_version + 1
     WHERE tenant_id = p_tenant_id AND id = v_req.lead_id;

     -- 5. Mark request approved
     UPDATE app.attribution_change_request
     SET status = 'APPROVED',
         approver_id = p_approver_id,
         approved_at = now()
     WHERE tenant_id = p_tenant_id AND id = p_change_request_id;

     -- Reset session flag
     PERFORM set_config('app.allow_attribution_override', 'off', true);
   END $$;
   ```

### 7.2 Separation of Duties Rule SOD-09

- When an attribution change request is evaluated:
  - If a lead has zero commission calculations in `MOD-COM`, branch management can approve.
  - If a lead has an active commission calculation or disbursement pending, approval requires the specific seat `COMMISSION_APPROVER` (`rules_core.sql#L145`).
  - Historical commission calculations are **NEVER silently rewritten**. A ledger reconciliation event `connector.attribution_reassigned` is emitted to notify the finance team.

---

## 8. Security Risks & Mitigations

| Threat Vector                        | Risk Classification           | Architectural Mitigation                                                                                                                                                                                                                                                                           |
| :----------------------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plaintext PAN Exposure**           | S2/S3 Data Breach             | 1. Raw PAN never logged or stored in database.<br>2. Tenant-scoped HMAC-SHA256 blind indexing for uniqueness searches.<br>3. AES-256-GCM envelope encryption for stored ciphertext.<br>4. Display masked format only (`ABCDE****F`).                                                               |
| **Bank Account Redirection Fraud**   | Financial Theft               | 1. Step-up authentication (`aal2` TOTP ≤ 900s) required to submit changes.<br>2. Mandatory Separation of Duties (`created_by <> approved_by`).<br>3. Partial uniqueness constraint permits only 1 active account.<br>4. 24-hour mandatory cooling period before payouts can route to new accounts. |
| **Silent Attribution Hijacking**     | Commission Embezzlement       | 1. Database trigger `lead_attribution_guard` blocks direct updates.<br>2. Reattribution requires formal `attribution_change_request` with evidence.<br>3. SOD-09 requires independent approver.<br>4. Transactional audit log emitted to `app.audit_event`.                                        |
| **Duplicate Referral Collusion**     | Partner Dispute / Overpayment | 1. Automated collision flag via `DK-lead.duplicate` returning `ATTRIBUTION_CONFLICT`.<br>2. Payouts locked while lead is in `ATTRIBUTION_CONFLICT`.<br>3. Formal dispute adjudication entity with evidence retention.                                                                              |
| **Suspended Connector Infiltration** | Unauthorized System Access    | 1. Transitioning connector to `SUSPENDED` or `TERMINATED` automatically revokes portal user sessions.<br>2. Ingestion pipeline rejects leads referencing non-`ACTIVE` connectors.                                                                                                                  |
| **Concurrency Lost Updates**         | Data Inconsistency            | Mandatory `If-Match` ETags on all PATCH and state transition endpoints against `lock_version`.                                                                                                                                                                                                     |

---

## 9. Required Database Migrations (Proposed & Unapplied)

> [!IMPORTANT]
> The following migration schemas are **PROPOSED ONLY**. In adherence to instructions, they have **NOT** been applied or executed against the database.

### Proposed Migration: `20261001000027_connectors.sql`

```sql
-- Migration: 20261001000027_connectors.sql
-- Status: PROPOSED / UNAPPLIED (TASK-417, Release R3)

-- 1. Unblock app.lead connector_id check constraint
ALTER TABLE app.lead DROP CONSTRAINT IF EXISTS lead_connector_id_check;

-- 2. Expand app.app_user user_type to include CONNECTOR
ALTER TABLE app.app_user DROP CONSTRAINT IF EXISTS app_user_user_type_check;
ALTER TABLE app.app_user ADD CONSTRAINT app_user_user_type_check
  CHECK (user_type IN ('STAFF', 'CONNECTOR'));

-- 3. ENT-071: Connector Entity
CREATE TABLE app.connector (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL,
  connector_type              text NOT NULL CHECK (connector_type IN ('INDIVIDUAL','PROPRIETORSHIP','PARTNERSHIP','PVT_LTD','PUBLIC_LTD','LLP')),
  legal_name                  text NOT NULL,
  contact_person              text NOT NULL,
  mobile_e164                 text NOT NULL,
  mobile_hash                 bytea NOT NULL,
  email                       text NOT NULL,
  email_hash                  bytea NOT NULL,
  encrypted_pan               bytea NOT NULL,
  pan_hash                    bytea NOT NULL,
  pan_masked                  text NOT NULL,
  gstin                       text,
  primary_branch_id           text NOT NULL,
  relationship_owner_user_id  text NOT NULL,
  status                      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_VERIFICATION','ACTIVE','SUSPENDED','TERMINATED')),
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pan_hash),
  FOREIGN KEY (tenant_id, primary_branch_id) REFERENCES app.branch (tenant_id, id),
  FOREIGN KEY (tenant_id, relationship_owner_user_id) REFERENCES app.app_user (tenant_id, id)
);
CREATE INDEX connector_branch_idx ON app.connector (tenant_id, primary_branch_id, status);
CREATE INDEX connector_mobile_idx ON app.connector (tenant_id, mobile_hash);
CREATE TRIGGER connector_touch BEFORE UPDATE ON app.connector FOR EACH ROW EXECUTE FUNCTION touch_row();
SELECT enable_tenant_rls('app.connector');

-- 4. Connect app.lead foreign key
ALTER TABLE app.lead
  ADD CONSTRAINT lead_connector_fk
  FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id);

-- 5. ENT-073: Connector Bank Account
CREATE TABLE app.connector_bank_account (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL,
  connector_id                text NOT NULL,
  account_holder_name         text NOT NULL,
  encrypted_account_number    bytea NOT NULL,
  account_hash                bytea NOT NULL,
  account_masked              text NOT NULL,
  ifsc_code                   text NOT NULL,
  verification_id             text REFERENCES app.verification (id),
  status                      text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','ACTIVE','REJECTED','DISABLED')),
  cooling_until               timestamptz,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  approved_at                 timestamptz,
  approved_by                 text,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id),
  CONSTRAINT bank_account_sod_check CHECK (
    status <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_by <> created_by)
  )
);
-- Partial unique index: Only one ACTIVE bank account per connector
CREATE UNIQUE INDEX connector_bank_account_active_uq
  ON app.connector_bank_account (tenant_id, connector_id)
  WHERE status = 'ACTIVE';
CREATE TRIGGER connector_bank_account_touch BEFORE UPDATE ON app.connector_bank_account FOR EACH ROW EXECUTE FUNCTION touch_row();
SELECT enable_tenant_rls('app.connector_bank_account');

-- 6. ENT-072: Connector Agreement
CREATE TABLE app.connector_agreement (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL,
  connector_id                text NOT NULL,
  version                     integer NOT NULL DEFAULT 1,
  validity_range              tstzrange NOT NULL,
  permitted_products          text[] NOT NULL,
  share_rule_scope            text NOT NULL,
  evidence_ref                text NOT NULL,
  status                      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connector_id) REFERENCES app.connector (tenant_id, id)
);
CREATE TRIGGER connector_agreement_touch BEFORE UPDATE ON app.connector_agreement FOR EACH ROW EXECUTE FUNCTION touch_row();
SELECT enable_tenant_rls('app.connector_agreement');

-- 7. ENT-075: Attribution Change Request
CREATE TABLE app.attribution_change_request (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL,
  lead_id                     text NOT NULL,
  previous_connector_id       text,
  proposed_connector_id       text NOT NULL,
  reason                      text NOT NULL,
  evidence_ref                text NOT NULL,
  recalculation_proposal      text,
  status                      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requester_id                text NOT NULL,
  approver_id                 text,
  approved_at                 timestamptz,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES app.lead (tenant_id, id),
  FOREIGN KEY (tenant_id, proposed_connector_id) REFERENCES app.connector (tenant_id, id),
  FOREIGN KEY (tenant_id, requester_id) REFERENCES app.app_user (tenant_id, id),
  CONSTRAINT attribution_sod_check CHECK (status <> 'APPROVED' OR (approver_id IS NOT NULL AND approver_id <> requester_id))
);
CREATE TRIGGER attribution_change_request_touch BEFORE UPDATE ON app.attribution_change_request FOR EACH ROW EXECUTE FUNCTION touch_row();
SELECT enable_tenant_rls('app.attribution_change_request');

-- 8. ENT-074: Attribution Dispute
CREATE TABLE app.attribution_dispute (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL,
  lead_id                     text NOT NULL,
  claimant_connector_ids      text[] NOT NULL,
  resolved_connector_id       text,
  resolution                  text CHECK (resolution IN ('ATTRIBUTED_TO_FIRST','ATTRIBUTED_TO_CLAIMANT','SPLIT_COMMISSION','DISMISSED_ORGANIC')),
  status                      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED')),
  resolver_user_id            text,
  resolution_notes            text,
  lock_version                integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES app.lead (tenant_id, id),
  FOREIGN KEY (tenant_id, resolved_connector_id) REFERENCES app.connector (tenant_id, id),
  FOREIGN KEY (tenant_id, resolver_user_id) REFERENCES app.app_user (tenant_id, id)
);
CREATE TRIGGER attribution_dispute_touch BEFORE UPDATE ON app.attribution_dispute FOR EACH ROW EXECUTE FUNCTION touch_row();
SELECT enable_tenant_rls('app.attribution_dispute');
```

---

## 10. Verification Test Plan

When unblocked for implementation, the test suite must execute against synthetic fixtures only:

### 10.1 Unit Tests (`apps/api/test/unit/connector/`)

- `TEST-CON-UNIT-001`: Zod schema validation (rejection of malformed PAN, GSTIN, IFSC, account numbers).
- `TEST-CON-UNIT-002`: S2/S3 scanner enforcement (`containsS2SensitiveData` triggers on plaintext PAN/accounts in notes and reasons).
- `TEST-CON-UNIT-003`: HMAC-SHA256 blind indexing produces identical hashes for identical inputs in the same tenant, and distinct hashes across tenants.
- `TEST-CON-UNIT-004`: State machine validator rejects illegal status transitions (e.g., `DRAFT -> ACTIVE` without verification).

### 10.2 Integration & Database Tests (`apps/api/test/integration/connector/`)

- `TEST-CON-INT-001`: `POST /v1/connectors` creates connector in `DRAFT` status with encrypted PAN and masked PAN; asserts plaintext PAN is absent from raw database select.
- `TEST-CON-INT-002`: Duplicate PAN registration within same tenant returns `409 CONFLICT`; identical PAN in separate tenant succeeds (tenant isolation).
- `TEST-CON-INT-003`: `POST /v1/connectors/{id}/activation` fails with `422` if linked verification is missing or status is `FAILED`.
- `TEST-CON-INT-004`: Bank account approval enforces SOD (requester attempting to approve throws `403 FORBIDDEN` or database constraint failure).
- `TEST-CON-INT-005`: Adding a second `ACTIVE` bank account fails via partial unique index `connector_bank_account_active_uq`.

### 10.3 Concurrency & Idempotency Tests

- `TEST-CON-CNC-001`: Concurrent PATCH requests with identical `If-Match` ETags: exactly one succeeds with `200`, second fails with `412 PRECONDITION_FAILED` / `409 CONFLICT`.
- `TEST-CON-CNC-002`: Replaying `POST /v1/connectors` with identical `Idempotency-Key` returns original resource with header `Idempotent-Replayed: true`.

### 10.4 Security & RLS Tests

- `TEST-CON-SEC-001`: Cross-tenant read access: Tenant B user cannot read Tenant A connector by ID (returns `404 NOT_FOUND`).
- `TEST-CON-SEC-002`: Branch isolation: Branch user with `BRANCH` scope cannot query connectors belonging to another branch.
- `TEST-CON-SEC-003`: Direct SQL update on `lead.connector_id` fails with exception `42501` unless invoked via `app.apply_attribution_change`.

---

## 11. Unresolved Product and Business Decisions

The following policy decisions are open and require sign-off from Product and Compliance leadership prior to activating TASK-417:

1. **`DEC-CON-001`: Bank Account Cooling Duration:**
   - _Question:_ Should the payout cooling period following a bank account change be strictly 24 hours, 48 hours, or 7 business days?
   - _Impact:_ Balance between partner payout satisfaction and anti-fraud diversion safeguards.
2. **`DEC-CON-002`: Retroactive Commission Recalculation on Reattribution:**
   - _Question:_ If an attribution change request is approved for a lead after loan disbursement, should previously credited commission to the original connector be clawed back automatically or settled manually?
   - _Impact:_ Ledger complexity in `MOD-COM` and potential negative connector account balances.
3. **`DEC-CON-003`: Multi-Branch Connector Servicing:**
   - _Question:_ Can a connector refer leads across multiple branches, or is lead origination strictly restricted to the connector's `primary_branch_id`?
   - _Impact:_ Scope filter enforcement in lead intake and routing.
4. **`DEC-CON-004`: Self-Onboarding Portal:**
   - _Question:_ Will connectors self-onboard via a public web portal with Aadhaar/PAN e-KYC, or is onboarding exclusively performed by internal branch managers?
   - _Impact:_ Need for public OTP-verified onboarding endpoints similar to `MOD-DSH`.

---

## 12. Recommended Implementation Order & Blockers

```
+----------------------------------------------------------------------------------------------------+
|                                RECOMMENDED IMPLEMENTATION ROADMAP                                   |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  Phase 1: Foundation Unblocking (Prerequisites)                                                    |
|  1. Apply additive migration to unblock app.lead constraint and app_user user_type.                |
|  2. Register connector ID prefixes in packages/contracts/src/ids.ts.                               |
|  3. Register connector permissions in packages/contracts/src/permissions.ts.                       |
|                                                                                                    |
|  Phase 2: Core Entities & Onboarding (SUB-CON.01)                                                  |
|  1. Create tables app.connector and app.connector_bank_account with RLS and triggers.               |
|  2. Implement ConnectorService with blind indexing and AES-256-GCM encryption.                     |
|  3. Implement onboarding endpoints API-CON-001, 002, 003, and 005.                                 |
|                                                                                                    |
|  Phase 3: Bank Account Dual-Control & Agreements (SUB-CON.01 & SUB-CON.02)                         |
|  1. Implement bank account two-step workflow with SOD enforcement and step-up auth.                |
|  2. Create app.connector_agreement and exclusion constraint.                                        |
|                                                                                                    |
|  Phase 4: Attribution & Dispute Handling (SUB-CON.03 & SUB-CON.04)                                 |
|  1. Implement app.apply_attribution_change stored procedure.                                       |
|  2. Implement attribution change request and approval endpoints (API-CON-009, 010).                |
|  3. Wire BRE DK-lead.duplicate ATTRIBUTION_CONFLICT output into app.attribution_dispute.          |
|                                                                                                    |
|  Phase 5: Lifecycle & Portal Integration (SUB-CON.05)                                              |
|  1. Implement lifecycle transitions (API-CON-006) and cascading portal user lockouts.               |
|  2. Build Connector Workbench in frontend apps/web.                                                |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### Critical Blockers Summary:

1. **TASK-417 Deferral:** Current sprint milestone deferred MOD-CON to Release R3. Formal sign-off required to begin Phase 1.
2. **Schema Invariant:** `lead.connector_id text CHECK (connector_id IS NULL)` strictly prevents any connector attribution in `app.lead` until migration `20261001000027_connectors.sql` is authorized and applied.
3. **MOD-COM Dependency:** Automated commission recalculation is blocked until the Commission Management module is designed. Attribution changes must decouple recalculation into manual financial task flags.

---

_Report concluded. No application code or database migrations were modified during this inspection._
