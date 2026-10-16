# Approvals, Decisions, and Coordination Status (Vaibhav's Modules)

**Status:** ALL RESOLVED & SIGNED OFF  
**Date Updated:** 2026-10-16  

---

## 1. Module 1 (Tenant): Platform Realm & Super Admin Provisioning (RESOLVED & VERIFIED)

> **Status: APPLIED & 32/32 VERIFIED ON HOSTED SUPABASE.**  
> Migration `20261001000050_platform_realm.sql` was applied to the hosted database (`mlpkwwhnagxzinaohdxg`).  
> All 32 verification assertions in `tools/sql/0050/verify.sql` have passed:
> - `ROLE-PLATFORM-SUPERADMIN` exists with exactly platform permissions + `audit.read`.
> - Super Admin account `vaibhav.qloax@gmail.com` is active in `auth.users` and mapped to platform realm.
> - Operator permissions stripped from customer tenants.
> - Zero cross-tenant data leaks; strict fail-closed RLS enforced across all tables.

## 2. Module 16 (Applications): Withdraw and Reopen Transitions (RESOLVED: DEFERRED TO RELEASE 2)

> **Status: CONFIRMED DEFERRED TO RELEASE 2 (TASK-433).**  
> - Core walking skeleton transitions are 100% complete and tested in `transitions.spec.ts`:
>   - `T-APP-01`: DRAFT -> DOCUMENTS_PENDING
>   - `T-APP-02`: DOCUMENTS_PENDING -> UNDER_REVIEW
>   - `T-APP-10`: Cancel with mandatory cancellation reason
> - Proposed non-blocking lifecycle states (Withdraw, Reopen, Reopen terminal) are formally deferred to post-MVP Release 2 per specification release roadmap (TASK-433).

## 3. Modules 14 & 15 (Lenders & Products): Routing & Management Pages (RESOLVED & ALIGNED)

> **Status: RESOLVED & ALIGNED.**  
> - Routes `/lenders` and `/products` point to feature modules `features/lenders/` (`LenderListPage`, `LenderDetailPage`) and `features/products/` (`ProductCataloguePage`, `ProductDetailPage`).
> - Full test suite passing across all lender and product components (`lenders.spec.tsx`, `products.spec.tsx`, and `admin/products.spec.tsx` — 14/14 tests pass).
> - Versioning terms validation and admin helper types retained in `features/admin/` for cross-module type safety.

## 4. Module 20 (Documents): Verifier Checklist Attestation Contract (RESOLVED & SIGNED OFF)

> **Status: SIGNED OFF & FULLY IMPLEMENTED.**  
> - Canonical attestation schema formalised in `@dsa/contracts` (`ChecklistAttestationRequestSchema` with `CHECKLIST_REVIEW_STATUSES` and `CHECKLIST_REJECT_REASONS`).
> - Enforced in API and backed by unit/integration tests (`TEST-VRF-010`, `TEST-VRF-021`, `TEST-VRF-025` in `verification.spec.ts`).
> - Verification UI in `features/verifications/` fully consumes and handles attestation reviews.

## 5. Module 13 (Grievances): SLA Due-Date Rule (RESOLVED: OPTION B IMPLEMENTED)

> **Status: IMPLEMENTED & VERIFIED.**  
> - Option B (Statutory 30-day SLA standard from acknowledgement) adopted and implemented in `apps/api/src/modules/crm/grievances/complaints.ts`.
> - Intake automatically assigns `due_at = now + 30 days` when not explicitly supplied.
> - Verified with 100% passing test suite in `apps/api/test/grievances.spec.ts` and `apps/api/test/grievances.int.spec.ts`.

## 6. Done without anyone else (2026-10-15 & 2026-10-16)

- Toasts on every write, permission-based sidebar (including admin, reporting, performance and import items),
  no retry on 401/403, and a single clear "You don't have access" message for every 403 (screens and toasts).
- Messaging page shows a notice when its requests are refused.
- Tests added for the sidebar, retry policy, MFA helper, toast behaviour, Grievances access and the 403 message.

## 7. Module 17 (Eligibility): Approved BRE Rules & Integration Contract (RESOLVED by Akash)

Built and tested locally: API-ELG-001 (run), 002 (history), 003 (override), the Eligibility card on the application page,
and migration `20261001000048_eligibility.sql`. **The migration was applied to hosted on 2026-10-15 (approved by Vaibhav) and verified**: table with 12 columns, RLS enabled and forced
with the `tenant_isolation` policy, INSERT/SELECT/UPDATE for `dsa_app` only, and the `eligibility.override` permission (granted to no role).

Needs from others before it does real work:
- **Akash:** a published eligibility rule set. Until then every criterion is UNKNOWN (the spec's rule for missing data).
  The one place to connect it is `evaluateCriteria` in `apps/api/src/modules/origination/applications/eligibility.ts`.
- **You:** which roles get `eligibility.override` (the spec says "approver roles"; no role is granted today).

- **Approved BRE Rule Set Published:** Decision Definition `DK-application.eligibility` registered (in M-050) and seeded with active rule set `rs_elg_<tenant>` and active version v1 `rsv_elg_<tenant>_v1` in `20261001000051_approved_eligibility_rules.sql`.
- **Approved Rules:**
  1. `RUL-ELG-001` (Low Bureau Credit Score): `applicant.credit_score < 600` => `INELIGIBLE`, code `CREDIT_SCORE_LOW`.
  2. `RUL-ELG-002` (Income Below Minimum): `applicant.monthly_income.amount < 25000` => `INELIGIBLE`, code `INCOME_BELOW_MINIMUM`.
  3. `RUL-ELG-003` (Prime Borrower Pass): `applicant.credit_score >= 750` AND `applicant.monthly_income.amount >= 75000` => `ELIGIBLE`, maxEligibleAmount `25,00,000 INR`, code `PRIME_BORROWER_ELIGIBLE`.
  4. `RUL-ELG-004` (Standard Borrower Pass): `applicant.credit_score >= 650` AND `applicant.monthly_income.amount >= 25000` => `ELIGIBLE`, maxEligibleAmount `10,00,000 INR`, code `STANDARD_ELIGIBLE`.
  5. Default/Fallback: `REFER`, code `MANUAL_REVIEW`.
- **Integration Contract:** Exposes `evaluateApplicationEligibility(tx, ctx, deps.decisionPort, input)` and `toEligibilityCriteria(result)` in `apps/api/src/modules/rules/eligibility-service.ts`.
- **Role Grants for Override:** `20261001000051_approved_eligibility_rules.sql` grants `eligibility.override` to approver roles (`ROLE-ORG-OWNER`, `ROLE-BRANCH-MGR`, `ROLE-LOAN-OPS`, `ROLE-TENANT-ADMIN`).

## 8. Clean Database Setup Issues (RESOLVED by Akash)

All blockers for fresh database setup (`supabase db reset` and `tests/isolation/harness.ts`) have been resolved:
1. `20261001000019_verification.sql`: Removed inline foreign keys to `loan_application` and `application_party` that do not exist at file order 0019. The foreign keys are safely applied in `20261001000021_origination_application.sql` via an idempotent `DO $$ ...` block once those tables exist.
2. `20261001000037_api_development.sql`: Corrected column name from `task_ref` to `introduced_in` on `app.permission`, and ensured RLS policy creation is idempotent (`DROP POLICY IF EXISTS`).
3. `20261001000042_audit_tamper_evidence.sql` and the security migration (renamed to `20261001000063_security_monitoring_incidents.sql` on 2026-10-16 to end a duplicate 0043; content unchanged): Corrected column name from `task_ref` to `introduced_in`, and ensured RLS policy creation is idempotent.
4. Clean database migrations run in alphabetical sequence with zero errors.

