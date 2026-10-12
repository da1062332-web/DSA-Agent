# Cross-cutting test suites

Unit and integration tests live next to the code they test (`*.spec.ts`, `*.int.spec.ts`). This folder holds the suites that cut across modules. Test names start with the test ID: `it('TC-LEAD-001 creates a NEW lead with consent and first-contact task', …)`. New tests without a Doc 16 ID use `TEST-<MOD>-NNN`.

| Folder       | Owner                                                                   | CI job      | Contents                                                                                               |
| ------------ | ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `isolation/` | Dev 1 (`harness.ts`); each module owner writes `cases/<module>.spec.ts` | `isolation` | TEST-SEC-001 tenant isolation and authorization. Endpoint inventory comes from `openapi/openapi.yaml`. |
| `e2e/`       | Dev 4                                                                   | `e2e`       | TEST-E2E-001 API journey for Workflow A (`workflow-a.spec.ts`, E2E-001..004)                           |
| `ui/`        | Dev 4                                                                   | `ui`        | One Playwright journey (`journey.pw.ts`). Screens keep `data-testid="<feature>.<element>"` stable.     |

Coverage gates on Day 4: at least 85 % lines for `bre-core` and at least 70 % lines per module (Contracts §13).
