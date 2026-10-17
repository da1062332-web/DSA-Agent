# Security Architecture Decisions & Pending Governance (MOD-SEC)

**Module:** 39 — Security (MOD-SEC)  
**Domain:** DOM-N (Platform Squad)  
**Business Owner:** InfoSec Lead / Head of Compliance  
**Date:** October 2026  
**Status:** Approved Application-Level Implementation; External Infrastructure & Compliance Approvals Documented

---

## 1. Submodule SUB-SEC.01: SIEM Delivery Architecture (TASK-431)

### Status: RESOLVED — Multi-Provider Transports Implemented (Splunk, Datadog, Webhook) & Auto-Configured

#### Requirements & Architecture:

- **Primary Store:** All security events (`ENT-096 security_event`) are durably written to PostgreSQL in the tenant boundary prior to SIEM streaming.
- **Redaction Policy:** Passwords, tokens, database credentials, API keys, and sensitive PII are automatically stripped using `@dsa/kernel` `redactSensitivePayload` before entering event payloads or SIEM logs.
- **Transports Implemented (`apps/api/src/modules/security/siem.ts`):**
  1. _Splunk HEC:_ `createSplunkHecTransport` streaming directly to Splunk HTTP Event Collector.
  2. _Datadog Logs API:_ `createDatadogLogsTransport` streaming to Datadog intake with environment and tenant tags.
  3. _Generic Webhook:_ `createWebhookSiemTransport` streaming to Elastic, Logstash, or custom receivers.
  4. _Environment Auto-Wiring:_ `createSiemPortFromEnv` automatically activates the appropriate transport when `SIEM_PROVIDER` and credentials (`SIEM_ENDPOINT`, `SIEM_AUTH_TOKEN`) are configured in Vault or environment variables.
- **Fail-Safe Guarantee:** Failure of the external SIEM collector never causes rollback or loss of the primary database transaction. Bounded retries (3 attempts with exponential backoff) are enforced.

---

## 2. Submodule SUB-SEC.02: Incident Management & Regulatory Compliance Rules

### Status: RESOLVED — Statutory CERT-In 6-Hour Matrix & DPDP Act 2023 Breach Notification Implemented

#### Implemented Functionality (`apps/api/src/modules/security/compliance.ts`):

- `POST /v1/incidents` (API-SEC-001): Idempotent incident recording with transactional audit logging and `security.incident` permission check.
- `PATCH /v1/incidents/:id` (API-SEC-002): Optimistic concurrency via `If-Match` against `lock_version`, validating notification evidence and blocking arbitrary status reopening on `CLOSED` incidents.
- **CERT-In 6-Hour Incident Escalation Matrix:**
  - Mandatory reporting rule: All `CRITICAL` severity incidents and `DATA_BREACH` types require formal reporting to CERT-In within 6 hours of detection (CERT-In Directions Section 2(i)).
  - SLA tracking via `evaluateCertInSla`: Automatically computes exact 6-hour deadline timestamp, overdue detection, and minutes remaining.
  - Official Annexure-1 reporting payload generator: `generateCertInReport` formats statutory disclosures for `incident@cert-in.org.in`.
- **DPDP Act 2023 Personal Data Breach Notifications (Section 8(6)):**
  - `generateDpbiBreachNotice`: Statutory notification payload for the Data Protection Board of India (DPBI) covering compromised data categories, estimated affected data principals, and immediate containment measures.
  - `generateIndividualBreachNotice`: Customer-facing breach notice for affected borrowers with plain-language disclosure, precautionary advice, and Data Protection / Grievance Officer redressal contact.
- **State Machine Governance:** Incidents in `CLOSED` status remain strictly non-modifiable without authorized governance review.

---

## 3. Submodule SUB-SEC.03: Vulnerability Management & CI/CD Scanning

### Status: Implemented and Operational (PASS)

- **Secret Scanning:** Verified Gitleaks workflow and `.gitleaks.toml` configuration blocking committed secrets.
- **Dependency Scanning:** Automated GitHub Actions job executing `npm audit --audit-level=critical` on every push and pull request to `main` and `beta`.
- **Runbook:** Documented SLAs and escalation procedures in `docs/vulnerability-triage-runbook.md`.

---

## 4. Submodule SUB-SEC.04: KMS & Envelope Encryption (TASK-421)

### Status: AES-256-GCM Verified; Cloud KMS Provisioning Deferred (BLOCKED)

#### Cryptographic Verification:

- Verified authenticated encryption with AES-256-GCM, 12-byte IV, 16-byte tag.
- Verified tamper detection: any alteration to ciphertext or authentication tag throws cryptographic errors.
- Verified deterministic tenant-scoped HMAC-SHA256 blind indexing and PAN masking.

#### TASK-421 KMS Integration Architecture:

- **Interface & Implementations (`apps/api/src/modules/security/kms.ts`):**
  - `KmsPort`: Defines `generateDataKey` and `decryptDataKey` contracts.
  - `MasterKeyKmsPort`: Cryptographic Master Key Encryption Key (KEK) adapter. Derives tenant-isolated KEKs via HKDF (SHA-256) and wraps/unwraps per-record Data Encryption Keys (DEKs) using AES-256-GCM.
  - `createKmsPortFromEnv`: Auto-activates `MasterKeyKmsPort` when `KMS_MASTER_KEY` / `AWS_KMS_KEY_ARN` is configured; otherwise maintains strict `DeferredKmsPort` fail-closed protection.
- **Envelope Encryption:** `EnvelopeEncryptionService` generates per-tenant DEKs wrapped by the Cloud KMS master Key Encryption Key (KEK), with zero-fill memory sanitation of plaintext keys upon completion.
- **Cloud KMS Provisioning Policy Blueprint:**
  - Root Key: Symmetric 256-bit AES-GCM Key in AWS KMS (`arn:aws:kms:ap-south-1:<account>:key/<key-id>`) with annual rotation enabled.
  - IAM Policy: Restricted `kms:GenerateDataKey` and `kms:Decrypt` actions bound to the DSA CRM ECS task role, with `kms:EncryptionContext:TenantId` boundary enforcement.

---

## 5. Retention Policy & Database Partitioning (PHASE 6)

### Status: 180-Day Floor Validated; Declarative Partitioning Deferred under ADR-4D-03

#### Retention Compliance:

- **CERT-In Cyber Security Directions (28 April 2022):**
  - Mandates a minimum retention period of **180 days** for all system logs, access logs, and security events.
  - Validation: `validateRetentionPurge` and `assertRetentionCompliance` (`apps/api/src/modules/security/retention.ts`) strictly refuse any deletion or purge operation attempting to prune logs younger than 180 days.
- **Platform Baseline:** 365 days retention default for financial records.

#### Partitioning Decision (ADR-4D-03):

- In accordance with `ADR-4D-03`, high-volume append tables (`audit_event`, `decision_record`, `activity`, `outbox_event`, `security_event`) are not partitioned during initial MVP deployment to avoid PostgreSQL foreign-key and unique constraint complexity.
- `app.security_event` is indexed on `(tenant_id, created_at DESC, id DESC)` for fast windowed scans.
- The table is protected by PostgreSQL trigger `security_event_immutable`, preventing any `UPDATE` or `DELETE` mutation by application users (`dsa_app`).
- When monthly declarative partitioning is enabled by DBA infrastructure operations, the table conversion can be executed using the standard PostgreSQL range partitioning template:

```sql
-- Future DBA partition migration template (TASK-431 DBA Follow-up)
-- CREATE TABLE app.security_event_partitioned (
--   id text NOT NULL,
--   tenant_id text NOT NULL,
--   type text NOT NULL,
--   principal text NOT NULL,
--   ip text NOT NULL,
--   severity text NOT NULL,
--   details jsonb NOT NULL DEFAULT '{}'::jsonb,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   PRIMARY KEY (id, created_at)
-- ) PARTITION BY RANGE (created_at);
```
