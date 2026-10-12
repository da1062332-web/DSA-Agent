# @dsa/bre-core

Owner: **Dev 2**. The Business Rule Engine core. It is pure: no database, network, clock or randomness. `evaluationTime` comes in through the request. The package is separate so the no-I/O rule holds; its tsconfig loads no Node types on purpose.

Planned layout (Contracts §2): `ast/` · `validate/` · `compile/` · `evaluate/` · `hit-policies/` · `merge/` · `canonical-json.ts`.

Coverage gate on Day 4: at least 85 % lines (Contracts §13). Property tests use `fast-check`.

Specs: Business Rule Engine Task Pack (plan page 7) and Developer 2's page (plan page 16).
