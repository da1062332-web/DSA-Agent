# DSA CRM — Release Deferred Work Tracking

**Status Date:** 2026-10-15 (updated 2026-10-21)  
**Release Target:** Release 1 (Current Walking Skeleton / MVP Release Candidate)  
**Classification:** Post-MVP / Release 2 & Release 3 Tracking (Non-Blockers for Current Release)

---

## 1. Overview & Separation Policy

In accordance with Architecture Review and Audit findings, deferred modules and submodules are explicitly separated from current-release blockers. The current release is focused on core walking-skeleton flows: Origination, CRM, BRE, Verification, Reporting, and Platform Security.

Work marked as **Deferred** is non-blocking for current-release deployment and is tracked separately below.

---

## 2. Deferred Modules Matrix

| Module Code                      | Module Name                       | Scope / Components                                                                                           | Deferred To                       | Canonical Task / ADR     | Release Blocker?     | Current State in Repository                                                                                                                 |
| :------------------------------- | :-------------------------------- | :----------------------------------------------------------------------------------------------------------- | :-------------------------------- | :----------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **MOD-CPT**                      | Connector Portal                  | `/portal/v1` API: referrals with OTP consent, my referrals, statements, rate card, payout requests, disputes | **API in R1 (2026-10-19)**; UI R3 | API-CPT-001..007 / M-083 | **No**               | API built and tested (`connector-portal.int.spec.ts`); the OTP SMS sender (consent.otp_requested) and the portal UI remain.                 |
| **MOD-LED**                      | Commission Ledger                 | Automated double-entry commission accounting ledger                                                          | **COMPLETED (R1)**                | SUB-LED.01–03 / TASK-418 | **No** (Completed)   | Integrated into `beta` (commit `eb51943` / `466c37c`), migration M-056, UI live at `/ledger`, 17/17 tests passing.                          |
| **MOD-PAY**                      | Payout Processing                 | Automated banking payout batch disbursements & net banking integration                                       | **Release 3 (R3)**                | TASK-418 / DOM-FIN       | **No** (Non-blocker) | Payout request models exist; gateway processing deferred to R3.                                                                             |
| **MOD-REC**                      | Reconciliation                    | Automated bank statement reconciliation engine                                                               | **Release 3 (R3)**                | TASK-418 / DOM-FIN       | **No** (Non-blocker) | Manual accounting in current scope; auto reconciliation deferred.                                                                           |
| **MOD-ADM** (SUB-ADM.01–07)      | Platform Operator Console & Tools | Platform Console, Flag Service, Master Data UI, Break-Glass Support Access, Data Correction                  | **Release 2 (R2)**                | TASK-420 / ADR-4D-02     | **No** (Non-blocker) | Tenant-scoped administration (`/admin/*`) active; cross-tenant platform operator console deferred under single-tenant RLS fail-closed rule. |
| **MOD-GRV** (Live Portal Intake) | Grievances Customer Intake        | Public portal customer complaint submission & auto-escalation                                                | **Release 2 (R2)**                | TASK-427 / MOD-GRV       | **No** (Non-blocker) | Internal complaints queue (`/grievances`) active with preview notice; cross-module lead complaint linkage coordinated.                      |
| **MOD-APP** (Post-MVP States)    | Loan Applications                 | `T-APP-04` ready, `T-APP-08` withdraw, `T-APP-09` reopen; create, parties, owners (API-APP-001/006/011)      | **COMPLETED (2026-10-19)**        | M-071                    | **No**               | Built and tested (`application-parties.int.spec.ts`). `REOPEN_TERMINAL` (application.reopen_terminal) is still not built.                   |

---

## 3. Current Release (R1 / MVP) Quality Gate Status

- **MFA Enforcement:** **FIXED & VERIFIED**. Authentication guard restored (`useMe.ts`, `AppLayout.tsx`, `MfaPage.tsx`), passing 100% of unit & guard tests.
- **Migration Numbering:** **RECONCILED**. Duplicate migrations 0028, 0029, and 0031 cleanly renumbered to 0034, 0035, 0036 and verified against manifest.
- **Hosted Database:** **VERIFIED**. Schema grants verified with `npm run db:verify` returning 5/5 PASS. Immutability preserved (`REVOKE DELETE ON report_schedule`).
- **User Roles:** **RECONCILED**. 25 orphaned test accounts in test tenant identified and marked SUSPENDED with assigned test roles. Zero active users without roles.
- **Role Permissions:** **ALIGNED**. `ROLE-TENANT-ADMIN` across Alpha, Beta, and DSA possess uniform 59 approved operational and administrative grants.
- **Tenant Isolation:** **VERIFIED**. Multi-tenant boundary tests active across all 9 audited modules (Leads, Customers, Tasks, Lender Cases, Sanctions, Targets, Connectors, Reporting, Grievances).

---

## 4. MOD-AUTH: served by Supabase Auth (2026-10-21)

The MOD-AUTH endpoints are not built in the Express API: the browser talks to Supabase Auth (`supabase-js`, `auth.*` only), which issues the
access token the API verifies (`packages/kernel/src/auth/verify-token.ts`). The mapping:

| Spec endpoint                                                 | Served by                                                                                                                                                               |
| :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-AUTH-001 `POST /auth/v1/login`                            | `supabase.auth.signInWithPassword` (Supabase throttles sign-in)                                                                                                         |
| API-AUTH-002 `POST /auth/v1/mfa/verify`, API-AUTH-009 step-up | `supabase.auth.mfa.challengeAndVerify`; the token's `aal2` and `amr` TOTP time drive `requireStepUp` (900 s)                                                            |
| API-AUTH-010 `POST /auth/v1/mfa/enrol`                        | `supabase.auth.mfa.enroll` (TOTP)                                                                                                                                       |
| API-AUTH-003 `POST /auth/v1/token/refresh`                    | `supabase.auth.refreshSession` (refresh-token rotation and reuse detection are Supabase settings)                                                                       |
| API-AUTH-004 `POST /auth/v1/logout`                           | `supabase.auth.signOut()`                                                                                                                                               |
| API-AUTH-005/006 `GET`/`DELETE /v1/me/sessions`               | **Gap.** The client SDK can only sign out this session or all others (`signOut({ scope: 'others' })`); listing sessions needs the Admin API, which the API may not use. |
| API-AUTH-007/008 password forgot/reset                        | `supabase.auth.resetPasswordForEmail` and `supabase.auth.updateUser({ password })`                                                                                      |

Invited users (API-USR-001, API-TEN-001) start INVITED with a placeholder subject; the first sign-in whose token carries the invited
email and the tenant's `app_metadata.tenant_id` binds the account (`resolve-principal.ts`). Creating the Auth account itself (with
`app_metadata.tenant_id`) stays an operator step (`tools/provision-tenant.ts`), because the API never holds the service-role key.
