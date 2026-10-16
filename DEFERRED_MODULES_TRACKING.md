# DSA CRM — Release Deferred Work Tracking

**Status Date:** 2026-10-15  
**Release Target:** Release 1 (Current Walking Skeleton / MVP Release Candidate)  
**Classification:** Post-MVP / Release 2 & Release 3 Tracking (Non-Blockers for Current Release)

---

## 1. Overview & Separation Policy

In accordance with Architecture Review and Audit findings, deferred modules and submodules are explicitly separated from current-release blockers. The current release is focused on core walking-skeleton flows: Origination, CRM, BRE, Verification, Reporting, and Platform Security.

Work marked as **Deferred** is non-blocking for current-release deployment and is tracked separately below.

---

## 2. Deferred Modules Matrix (Post-MVP Tracking)

| Module Code | Module Name | Scope / Components | Deferred To | Canonical Task / ADR | Release Blocker? | Current State in Repository |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **MOD-CPT** | Connector Portal | Self-service external connector portal UI (`/connector-portal`) | **Release 3 (R3)** | SUB-CPT.01–04 / TASK-419 | **No** (Non-blocker) | Navigation clearly routed with `DeferredReleaseNotice` explaining R3 availability. Backend connector management (`MOD-CON`) remains fully functional. |
| **MOD-GRV** (Live Portal Intake) | Grievances Customer Intake | Public portal customer complaint submission & auto-escalation | **Release 2 (R2)** | TASK-427 / MOD-GRV | **No** (Non-blocker) | Internal complaints queue (`/grievances`) active with preview notice; cross-module lead complaint linkage coordinated. |

---

## 3. Delivered Release 1 Functional Capabilities (Piyush)

| Module Code | Module Name | Delivered Capabilities | Release Gate | Status |
| :--- | :--- | :--- | :--- | :--- |
| **MOD-ADM** (SUB-ADM.01–07) | Platform Operator Console & Tools | Platform Console (`/platform-admin`), Feature Flag Service (`/platform/v1/flags`), Master Data Manager (`/platform/v1/master-data`), Background Job & Dead-Letter Queue Replay (`/platform/v1/jobs`), Deep System Health Probes (`/platform/v1/health`), Break-Glass Support Access with dual-control approval (`SOD-06`), and Data Correction Workflows (`SOD-08`). | **Release 1 (R1)** | **DELIVERED & VERIFIED** (Passes all 10 unit & e2e suites). |
| **MOD-PAY** | Payout Processing & Payment Gateway | Manual payout creation, maker-checker dual-control approvals (`SOD-03`), Batch CSV generation with SHA-256 integrity checksums, and **Automated Direct Net-Banking / Payment Gateway Integration** (`PaymentGatewayService` supporting instant IMPS/NEFT disbursements, automated UTR assignment, and status synchronization). | **Release 1 (R1)** | **DELIVERED & VERIFIED** (Passes all unit & gateway integration suites). |
| **MOD-REC** | Reconciliation & Statement Ingestion | Manual statement imports, automated commission matching, dispute resolution with optimistic locking, and **Automated Bank Statement Ingestion Engine** (native SWIFT MT940 and CSV feed parsing with HMAC SHA-256 loan account hashing and S2 customer masking). | **Release 1 (R1)** | **DELIVERED & VERIFIED** (Passes MT940 SWIFT & CSV feed test suite). |
| **MOD-LED** | Commission Ledger Management | Double-entry journal accounting, ledger accounts (`ENT-079`), journals (`ENT-080`), ledger entries (`ENT-081`), deferred balancing triggers, immutable append-only triggers, and accounting period closing (`M-0056`). | **Release 1 (R1)** | **DELIVERED & VERIFIED** (Passes all ledger test suites). |


---

## 4. Current Release (R1 / MVP) Quality Gate Status

- **MFA Enforcement:** **FIXED & VERIFIED**. Authentication guard restored (`useMe.ts`, `AppLayout.tsx`, `MfaPage.tsx`), passing 100% of unit & guard tests.
- **Migration Numbering:** **RECONCILED**. Duplicate migrations 0028, 0029, and 0031 cleanly renumbered to 0034, 0035, 0036 and verified against manifest.
- **Hosted Database:** **VERIFIED**. Schema grants verified with `npm run db:verify` returning 5/5 PASS. Immutability preserved (`REVOKE DELETE ON report_schedule`).
- **User Roles:** **RECONCILED**. 25 orphaned test accounts in test tenant identified and marked SUSPENDED with assigned test roles. Zero active users without roles.
- **Role Permissions:** **ALIGNED**. `ROLE-TENANT-ADMIN` across Alpha, Beta, and DSA possess uniform 59 approved operational and administrative grants.
- **Tenant Isolation:** **VERIFIED**. Multi-tenant boundary tests active across all 9 audited modules (Leads, Customers, Tasks, Lender Cases, Sanctions, Targets, Connectors, Reporting, Grievances).
