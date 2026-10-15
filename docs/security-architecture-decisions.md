# Security Architecture Decisions & Pending Governance (MOD-SEC)

**Module:** 39 — Security (MOD-SEC)  
**Domain:** DOM-N (Platform Squad)  
**Business Owner:** InfoSec Lead / Head of Compliance  
**Date:** October 2026  
**Status:** Approved Application-Level Implementation; External Infrastructure & Compliance Approvals Documented

---

## 1. Submodule SUB-SEC.01: SIEM Delivery Architecture (TASK-431)

### Status: Application Port & Buffered Sink Implemented; External SIEM Unprovisioned (BLOCKED)

#### Requirements & Architecture:
* **Primary Store:** All security events (`ENT-096 security_event`) are durably written to PostgreSQL in the tenant boundary prior to SIEM streaming.
* **Redaction Policy:** Passwords, tokens, database credentials, API keys, and sensitive PII are automatically stripped using `@dsa/kernel` `redactSensitivePayload` before entering event payloads or SIEM logs.
* **Delivery Boundary:**
  * Interface: `SiemPort` (`apps/api/src/modules/security/siem.ts`).
  * Buffer & Retries: `BufferedSiemClient` provides bounded retry (default: 3 attempts) with exponential backoff.
  * Fail-Safe Guarantee: Failure of the SIEM collector never causes rollback or loss of the primary database transaction.
* **External Decisions Required for TASK-431 Completion:**
  1. *SIEM Provider Selection:* Approval of enterprise collector (Splunk HEC, Datadog Logs API, or Elastic Logstash).
  2. *Credential Provisioning:* Egress token / endpoint URL stored in AWS Secrets Manager or HashiCorp Vault.
  3. *Network Security:* Egress VPC NAT gateway and firewall rules for SIEM endpoints.

---

## 2. Submodule SUB-SEC.02: Incident Management & Doc 17 Status

### Status: API-SEC-001 & API-SEC-002 Implemented; Statutory Breach Deadlines Require Approval (PARTIAL)

#### Implemented Functionality:
* `POST /v1/incidents` (API-SEC-001): Idempotent incident recording with transactional audit logging and `security.incident` permission check.
* `PATCH /v1/incidents/:id` (API-SEC-002): Optimistic concurrency via `If-Match` against `lock_version`, validating notification evidence and blocking arbitrary status reopening on `CLOSED` incidents.
* Evidence Tracking: Supports structured notification proof for authorities, affected tenants, and individuals (`notified`, `notifiedAt`, `reference`, `evidenceRef`).

#### Doc 17 Search & Unresolved Business Rules:
Doc 17 (Incident Management Standard) is missing from the repository baseline. The following regulatory decisions must be approved by Compliance and the InfoSec Lead before hardcoding statutory automation:

1. **CERT-In 6-Hour Reporting Window:**
   * Under the CERT-In Directions (April 2022), cyber incidents meeting specified severity thresholds must be reported to CERT-In within 6 hours of detection.
   * *Required Approval:* Approval of the automated escalation trigger matrix mapping `severity = 'CRITICAL'` to the Incident Response Team (IRT).
2. **DPDP Act 2023 Individual Breach Notification:**
   * Under India's Digital Personal Data Protection Act 2023, data breaches involving personal data require notification to the Data Protection Board of India and affected data principals.
   * *Required Approval:* Determination of the assessment threshold (`personal_data_involved = true`) and formal notification template.
3. **Incident State Machine Governance:**
   * Policy for reopening a `CLOSED` incident (currently locked down to prevent unauthorized tampering).

---

## 3. Submodule SUB-SEC.03: Vulnerability Management & CI/CD Scanning

### Status: Implemented and Operational (PASS)

* **Secret Scanning:** Verified Gitleaks workflow and `.gitleaks.toml` configuration blocking committed secrets.
* **Dependency Scanning:** Automated GitHub Actions job executing `npm audit --audit-level=critical` on every push and pull request to `main` and `beta`.
* **Runbook:** Documented SLAs and escalation procedures in `docs/vulnerability-triage-runbook.md`.

---

## 4. Submodule SUB-SEC.04: KMS & Envelope Encryption (TASK-421)

### Status: AES-256-GCM Verified; Cloud KMS Provisioning Deferred (BLOCKED)

#### Cryptographic Verification:
* Verified authenticated encryption with AES-256-GCM, 12-byte IV, 16-byte tag.
* Verified tamper detection: any alteration to ciphertext or authentication tag throws cryptographic errors.
* Verified deterministic tenant-scoped HMAC-SHA256 blind indexing and PAN masking.

#### TASK-421 KMS Integration Architecture:
* Interface: `KmsPort` (`apps/api/src/modules/security/kms.ts`) supporting `generateDataKey` and `decryptDataKey`.
* Envelope Encryption: `EnvelopeEncryptionService` generates per-tenant DEKs wrapped by the Cloud KMS master Key Encryption Key (KEK).
* Fail-Closed Policy: `DeferredKmsPort` throws `KMS_NOT_PROVISIONED (TASK-421)` until an authorized HSM/KMS provider is configured.
* *Required Approvals for TASK-421:*
  1. AWS KMS or GCP Cloud KMS root key ARN.
  2. IAM role granting `kms:GenerateDataKey` and `kms:Decrypt` with condition keys enforcing tenant boundaries.
  3. Annual key rotation policy.

---

## 5. Retention Policy & Database Partitioning (PHASE 6)

### Status: 180-Day Floor Validated; Declarative Partitioning Deferred under ADR-4D-03

#### Retention Compliance:
* **CERT-In Cyber Security Directions (28 April 2022):**
  * Mandates a minimum retention period of **180 days** for all system logs, access logs, and security events.
  * Validation: `validateRetentionPurge` and `assertRetentionCompliance` (`apps/api/src/modules/security/retention.ts`) strictly refuse any deletion or purge operation attempting to prune logs younger than 180 days.
* **Platform Baseline:** 365 days retention default for financial records.

#### Partitioning Decision (ADR-4D-03):
* In accordance with `ADR-4D-03`, high-volume append tables (`audit_event`, `decision_record`, `activity`, `outbox_event`, `security_event`) are not partitioned during initial MVP deployment to avoid PostgreSQL foreign-key and unique constraint complexity.
* `app.security_event` is indexed on `(tenant_id, created_at DESC, id DESC)` for fast windowed scans.
* The table is protected by PostgreSQL trigger `security_event_immutable`, preventing any `UPDATE` or `DELETE` mutation by application users (`dsa_app`).
* When monthly declarative partitioning is enabled by DBA infrastructure operations, the table conversion can be executed using the standard PostgreSQL range partitioning template:

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
