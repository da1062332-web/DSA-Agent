# DSA CRM — Release Deferred Work Tracking

**Status Date:** 2026-10-15  
**Release Target:** Release 1 (Current Walking Skeleton / MVP Release Candidate)  
**Classification:** Post-MVP / Release 2 & Release 3 Tracking (Non-Blockers for Current Release)

---

## 1. Overview & Separation Policy

In accordance with Architecture Review and Audit findings, deferred modules and submodules are explicitly separated from current-release blockers. The current release is focused on core walking-skeleton flows: Origination, CRM, BRE, Verification, Reporting, and Platform Security.

Work marked as **Deferred** is non-blocking for current-release deployment and is tracked separately below.

---

## 2. Deferred Modules Matrix

| Module Code | Module Name | Scope / Components | Deferred To | Canonical Task / ADR | Release Blocker? | Current State in Repository |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **MOD-CPT** | Connector Portal | Self-service external connector portal UI (`/connector-portal`) | **Release 3 (R3)** | SUB-CPT.01–04 / TASK-419 | **No** (Non-blocker) | Navigation clearly routed with `DeferredReleaseNotice` explaining R3 availability. Backend connector management (`MOD-CON`) remains fully functional. |
| **MOD-LED** | Commission Ledger | Automated double-entry commission accounting ledger | **Release 3 (R3)** | TASK-418 / DOM-FIN | **No** (Non-blocker) | Commission plans and basic calculations (`MOD-COM`) active in current release; complex balance ledger deferred. |
| **MOD-PAY** | Payout Processing | Automated banking payout batch disbursements & net banking integration | **Release 3 (R3)** | TASK-418 / DOM-FIN | **No** (Non-blocker) | Payout request models exist; gateway processing deferred to R3. |
| **MOD-REC** | Reconciliation | Automated bank statement reconciliation engine | **Release 3 (R3)** | TASK-418 / DOM-FIN | **No** (Non-blocker) | Manual accounting in current scope; auto reconciliation deferred. |
| **MOD-ADM** (SUB-ADM.01–07) | Platform Operator Console & Tools | Platform Console, Flag Service, Master Data UI, Break-Glass Support Access, Data Correction | **Release 2 (R2)** | TASK-420 / ADR-4D-02 | **No** (Non-blocker) | Tenant-scoped administration (`/admin/*`) active; cross-tenant platform operator console deferred under single-tenant RLS fail-closed rule. |
| **MOD-GRV** (Live Portal Intake) | Grievances Customer Intake | Public portal customer complaint submission & auto-escalation | **Release 2 (R2)** | TASK-427 / MOD-GRV | **No** (Non-blocker) | Internal complaints queue (`/grievances`) active with preview notice; cross-module lead complaint linkage coordinated. |
| **MOD-APP** (Post-MVP States) | Loan Applications | Advanced lifecycle states (`WITHDRAWN`, `REOPEN`, `REOPEN_TERMINAL`) | **Release 2 (R2)** | TASK-433 / MOD-APP | **No** (Non-blocker) | Core MVP transitions (`T-APP-01`, `T-APP-02`, `T-APP-10` cancel) 100% complete and tested; post-MVP states deferred per specification roadmap. |

---

## 3. Current Release (R1 / MVP) Quality Gate Status

- **MFA Enforcement:** **FIXED & VERIFIED**. Authentication guard restored (`useMe.ts`, `AppLayout.tsx`, `MfaPage.tsx`), passing 100% of unit & guard tests.
- **Migration Numbering:** **RECONCILED**. Duplicate migrations 0028, 0029, and 0031 cleanly renumbered to 0034, 0035, 0036 and verified against manifest.
- **Hosted Database:** **VERIFIED**. Schema grants verified with `npm run db:verify` returning 5/5 PASS. Immutability preserved (`REVOKE DELETE ON report_schedule`).
- **User Roles:** **RECONCILED**. 25 orphaned test accounts in test tenant identified and marked SUSPENDED with assigned test roles. Zero active users without roles.
- **Role Permissions:** **ALIGNED**. `ROLE-TENANT-ADMIN` across Alpha, Beta, and DSA possess uniform 59 approved operational and administrative grants.
- **Tenant Isolation:** **VERIFIED**. Multi-tenant boundary tests active across all 9 audited modules (Leads, Customers, Tasks, Lender Cases, Sanctions, Targets, Connectors, Reporting, Grievances).
