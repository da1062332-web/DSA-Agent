# @dsa/kernel

Owner: **Dev 1**. Empty at Gate 0. The planned layout (Contracts §2):

| Folder         | Task     | Contents                                                                                             |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `http/`        | TASK-101 | correlation, error mapping (incl. PostgreSQL `23505`/`23514`/`42501`/exclusion → Contracts §6 codes) |
| `context/`     | TASK-101 | `RequestContext` construction, `Clock`                                                               |
| `db/`          | TASK-101 | `TxRunner` (moved from `apps/api/src/kernel-min`), Kysely factory                                    |
| `logging/`     | TASK-101 | pino with the redaction list (never log bodies, fact values, mobile, email, names, tokens)           |
| `auth/`        | TASK-102 | Supabase JWT verification (JWKS via `jose`), principal resolution, `@dsa/kernel/testing` fake auth   |
| `authz/`       | TASK-104 | `Authz`, `ScopeResolver` registry, `UserDirectoryPort`                                               |
| `idempotency/` | TASK-105 | `Idempotency-Key` store, same-transaction, replay, 24 h expiry                                       |
| `audit/`       | TASK-105 | `AuditPort` writer (same transaction as the command)                                                 |
| `outbox/`      | TASK-105 | `OutboxPort` writer                                                                                  |
| `rate-limit/`  | TASK-105 | token bucket per principal (600/min, 60/min on rule authoring)                                       |
