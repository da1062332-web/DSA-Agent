# ADR-4D-09 — npm workspaces instead of pnpm (proposed)

**Status:** proposed, 2026-10-12. Needs the owner's confirmation to be added to Contracts §15.

**Context.** Contracts §1 lists "Monorepo: pnpm workspaces", and several plan pages mention `pnpm-lock.yaml`
(LR-1.2) and `pnpm --filter`. The team prefers npm.

**Decision.** The monorepo uses **npm workspaces** (`workspaces` in the root `package.json`, one root
`package-lock.json`). Nothing else in the contracts changes: package names, folder layout, ports and boundaries
are the same.

**Mapping from the plan's wording.**

| Plan says                                                | Repo does                                        |
| -------------------------------------------------------- | ------------------------------------------------ |
| `pnpm-workspace.yaml`                                    | `workspaces` field in root `package.json`        |
| `pnpm-lock.yaml` is never hand-edited; CI regenerates it | `package-lock.json`, same rule; CI uses `npm ci` |
| `workspace:*` dependencies                               | `"*"` (npm links the local workspace)            |
| `pnpm --filter <pkg> <script>`                           | `npm run <script> -w <pkg>`                      |
| `pnpm -r <script>`                                       | `npm run <script> --workspaces --if-present`     |

**Consequences.** Dependencies are hoisted to the root `node_modules`, so a package can import something it
did not declare. The `import/no-restricted-paths` boundary rule and code review cover module boundaries; a
missing declaration still shows up when a package is built on its own. Each workspace keeps owning its own
`package.json`, so dependency additions still never wait for Dev 1.
