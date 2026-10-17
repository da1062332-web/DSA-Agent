# Automated Test Report: Module 15, Products (DSA CRM)

**Execution date:** 2026-10-13
**Scope:** MOD-PRD Products: API-PRD-001 to API-PRD-005 (with the list, detail and version reads), ENT-043 (loan product), ENT-044 (loan product version), and the admin screens `/admin/products` and `/admin/products/:id`.
**Working tree:** uncommitted (no commit or push made).
**Overall status:** **PASS**, with the limitations in section 5.

---

## 1. Summary

| Category                                                                             | Executed | Passed | Failed | Status   |
| :----------------------------------------------------------------------------------- | :------: | :----: | :----: | :------- |
| API unit and route tests (`apps/api/test/products.spec.ts`)                          |    10    |   10   |   0    | PASS     |
| Live PostgreSQL integration tests (`catalogue-products.int.spec.ts`)                 |    8     |   8    |   0    | PASS     |
| Isolation, TEST-SEC-001 (`tests/isolation/cases/catalogue.spec.ts`, Module 15 cases) |    3     |   3    |   0    | PASS     |
| Web unit tests (`apps/web/src/features/admin/products.spec.tsx`)                     |    6     |   6    |   0    | PASS     |
| **Total Module 15 automated tests**                                                  |  **27**  | **27** | **0**  | **PASS** |

Catalogue suites that share the schema, run in the same pass: 26 of 26 pass (lenders, contacts, lifecycle and products).

---

## 2. Commands executed

| Command                                      | Purpose                             | Result                                                                                      |
| :------------------------------------------- | :---------------------------------- | :------------------------------------------------------------------------------------------ |
| `npm run typecheck`                          | TypeScript check, all workspaces    | Exit 0                                                                                      |
| `npm run gen:openapi`                        | Regenerate `openapi/openapi.yaml`   | Exit 0; 7 `API-PRD` operations present under tag `MOD-PRD Products`                         |
| `npm test -w @dsa/api -- products catalogue` | Unit and route tests                | 14 of 14 pass                                                                               |
| `npm run test:int -w @dsa/api -- catalogue`  | Live PostgreSQL 16 (Testcontainers) | 26 of 26 pass                                                                               |
| `npm run test:isolation`                     | Tenant isolation                    | 22 of 23 pass. The one failure is the inventory check for teammates' operations (section 4) |
| `npm test -w @dsa/web`                       | Web unit tests                      | 35 of 35 pass                                                                               |
| `npm run build -w @dsa/web`                  | Production bundle                   | Built with no errors                                                                        |
| `npx eslint` on Module 15 files              | Lint                                | Clean                                                                                       |

---

## 3. Test matrix

### 3.1 API unit tests: `apps/api/test/products.spec.ts`

| Test ID      | Category        | Description                                                                                         | Result |
| :----------- | :-------------- | :-------------------------------------------------------------------------------------------------- | :----: |
| TEST-PRD-001 | AuthZ           | Every write (create, status, version) returns 403 FORBIDDEN without `config.manage`                 |  PASS  |
| TEST-PRD-002 | Headers         | Create and version POST without `Idempotency-Key` returns 400 MALFORMED_REQUEST                     |  PASS  |
| TEST-PRD-003 | Headers         | Status change without `If-Match` returns 400 MALFORMED_REQUEST                                      |  PASS  |
| TEST-PRD-004 | Validation      | Unknown category, empty applicant list, unknown field, one-letter name return 422                   |  PASS  |
| TEST-PRD-005 | Data protection | Name containing a PAN or a 9 to 18 digit account number returns 422 (S3 data)                       |  PASS  |
| TEST-PRD-006 | Validation      | Deactivation without a reason returns 422                                                           |  PASS  |
| TEST-PRD-007 | Validation      | Amounts must be decimal strings (up to 2 places), and the maximum must be at or above the minimum   |  PASS  |
| TEST-PRD-008 | Validation      | Tenure must be 1 to 600 months and ordered                                                          |  PASS  |
| TEST-PRD-009 | Validation      | A version with an undefined field (for example an interest rate number) returns 422 (strict schema) |  PASS  |
| TEST-PRD-010 | Validation      | Geo rules need a state and a boolean; fee text is limited to 500 characters                         |  PASS  |

All of these run before any database call.

### 3.2 Live database tests: `apps/api/test/catalogue-products.int.spec.ts`

| Test ID         | Category              | Description                                                                                                                                                                                                         | Result |
| :-------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----: |
| TEST-PRD-INT-01 | Reliability           | Create a product; the same Idempotency-Key replays the original (`Idempotent-Replayed: true`)                                                                                                                       |  PASS  |
| TEST-PRD-INT-02 | Data                  | Duplicate name under the same lender returns 409; the same name under another lender is allowed                                                                                                                     |  PASS  |
| TEST-PRD-INT-03 | Lifecycle             | Product under a terminated lender returns 409 INVALID_STATE                                                                                                                                                         |  PASS  |
| TEST-PRD-INT-04 | Versioning            | Version numbers run 1, 2, 3; a past-dated version retires the earlier one; a future version does not retire the one in force; `isCurrent` is correct                                                                |  PASS  |
| TEST-PRD-INT-05 | Versioning            | A version must take effect after the latest one (422)                                                                                                                                                               |  PASS  |
| TEST-PRD-INT-06 | Immutability          | An SQL change to version terms is refused with SQLSTATE 42501; a status-only change is allowed                                                                                                                      |  PASS  |
| TEST-PRD-INT-07 | Concurrency and audit | Deactivate needs a reason and a current If-Match (stale returns 409 VERSION_CONFLICT); an inactive product takes no new version (409); audit trail is `product.created`, `product.deactivated`, `product.activated` |  PASS  |
| TEST-PRD-INT-08 | AuthZ                 | Writes return 403 without `config.manage`; reads return 200                                                                                                                                                         |  PASS  |

### 3.3 Isolation: `tests/isolation/cases/catalogue.spec.ts`

| Operation IDs in the case                  | Description                                                                                                     | Result |
| :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :----: |
| API-PRD-001, API-PRD-002, API-PRD-002-GET  | Tenant B cannot create a product under a tenant A lender, cannot read tenant A products, and does not list them |  PASS  |
| API-PRD-005                                | Tenant B cannot change the status of a tenant A product, even with the right version                            |  PASS  |
| API-PRD-003, API-PRD-003-LIST, API-PRD-004 | Tenant B cannot add, list or read tenant A versions                                                             |  PASS  |

Every Module 15 operation ID is in the inventory, so the inventory check finds no product gaps.

### 3.4 Web unit tests: `apps/web/src/features/admin/products.spec.tsx`

| Test ID                    | Description                                                                                                                                                                                                 | Result |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: |
| TEST-PRD-WEB-001 (4 tests) | The terms rule (`isValidTerms`) accepts a well-formed version and rejects malformed or S3-like money, inverted amounts, and tenure that is zero, fractional, inverted or missing. It mirrors the API rules. |  PASS  |
| TEST-PRD-WEB-002 (2 tests) | Every category the API accepts has a label; the seven applicant types are present                                                                                                                           |  PASS  |

---

## 4. Failures outside Module 15 (not caused by this work)

- **Isolation inventory:** 30 operations have no isolation case yet. They are teammates' endpoints (USR-009, LEAD, CUST, ACT, MSG, NTF, TASK). No Module 15 operation is in the list.
- **Lint:** 51 errors in files owned by teammates or outside Module 15: `apps/web/src/features/users`, `configuration`, `access-control`, `packages/contracts/src/users.ts`, and `apps/api/test/platform-*.spec.ts` and `support/mock-platform-db.ts`. There is also one error in `tools/hosted-lender-checks.mjs`, my temporary script. It should be deleted.
- **API unit suite:** 43 failures in `platform-access-control.spec.ts`, `platform-config.spec.ts` and related files. The count is unchanged from before Module 15 work started.

---

## 5. Limitations

- **No browser (UI) journey yet.** The repo reserves a Playwright journey for UI tests (`tests/ui/`), but Playwright is not installed. The screens are covered by the web unit tests for their rule logic, and the API tests cover the behaviour they call. A click-through of the create, deactivate and new-version dialogs still needs a manual check or a Playwright journey.
- **Hosted project not exercised by these tests.** The database tests run on a local container. Migration `20261001000024` is applied to the hosted project and its five columns were verified there. Hosted API tests for products need an MFA session, so they were not run.
- **Test data is synthetic** (names such as "Personal Loan Salaried", identifiers in test-only ranges).
