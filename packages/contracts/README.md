# @dsa/contracts

Shared zod schemas, kernel types and port interfaces. **Frozen at Gate 1.** After the freeze, a change is a PR to this package. It needs approval from the other owners it affects and a line in the Contracts §15 change log. Additive changes only, with an `@deprecated` shim for one release when something must break (LR-1.1).

| File                                                                                                    | Owner (v1.2) | Source                          |
| ------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------- |
| `kernel.ts`, `errors.ts`, `money.ts`, `ids.ts`, `pagination.ts`, `events.ts`, `permissions.ts`, `db.ts` | Dev 1        | Contracts §4.1, §5, §6, §8, §10 |
| `ports/crm-ports.ts` — `UserDirectoryPort`                                                              | Dev 1        | Contracts §4.4                  |
| `ports/crm-ports.ts` — `ConsentPort`, `PartyPort`, `DataSharingPort`                                    | Dev 5        | Contracts §4.4                  |
| `ports/decision-port.ts`, `ports/decision-keys.ts`, `ports/rules-seeder-port.ts`                        | Dev 2        | Contracts §4.2                  |
| `ports/application-port.ts`                                                                             | Dev 3        | Contracts §4.3                  |
| `ports/task-port.ts`                                                                                    | Dev 6        | Contracts §4.3                  |
| `openapi/registry.ts` (common components)                                                               | Dev 1        | TASK-001                        |

## Fakes (`@dsa/contracts/fakes`)

Fakes let a consumer build against a port before the real provider exists. Each fake passes the same contract test as the real implementation (RB-11).

| Fake                                                                               | Status                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| `FakeConsentPort`, `FakePartyPort`, `FakeDataSharingPort`, `FakeUserDirectoryPort` | Done (TASK-001)                         |
| `FakeDecisionPort`, no-op `RulesSeederPort`                                        | TODO, Dev 2, by Gate 1 (Contracts §4.5) |
| `FakeApplicationPort`                                                              | TODO, Dev 3, by Gate 1                  |
| `FakeTaskPort`                                                                     | TODO, Dev 6, by Gate 1                  |

Rules: no `any`. No runtime dependency on Express, pg or React. The web app imports this package too, so keep it free of Node-only code.
