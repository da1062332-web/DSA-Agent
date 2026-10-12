# DSA CRM for NBFCs — guide for Claude Code

A walking-skeleton MVP of **Workflow A**, built by six developers in four days. Workflow A: lead capture with consent → duplicate check and BRE routing → first-contact task → qualification → atomic conversion to customer and application → document checklist and completeness → lender-case submission → lender status roll-up. Day 4 release: `v0.1.0-rc.1`, an internal pilot candidate with synthetic data only.

## Specs (Notion — read the relevant page before implementing)

Every task has a full specification page. Before coding a task, fetch its page with the Notion tools: scope, endpoint contracts, tests and acceptance criteria are there and are normative.

- Execution plan v1.2 (root): https://app.notion.com/p/3f6c9918ca0881388d1de43a0cd7f3bf
- **Shared Technical Contracts** (ports, API conventions, errors, auth, authz): https://app.notion.com/p/ae2c9918ca088269b553013dfb955cc0
- **Database Migration Plan** (DDL, data dictionary, transaction boundaries): https://app.notion.com/p/773c9918ca088311a34b81da193030de
- Developer Assignment Matrix (who owns what): https://app.notion.com/p/492c9918ca08830cbcbc01d8de923da4
- Master Task Register (one page per task): https://app.notion.com/p/e35c9918ca0882b18be701852da91292
- Rulebooks RB-01..RB-11: https://app.notion.com/p/ce3c9918ca08825f88bc81d98a64b379
- Integration and QA Plan: https://app.notion.com/p/276c9918ca0882f2be41015bc1667245
- Developer pages: [Dev 1 platform](https://app.notion.com/p/3f6c9918ca088151b73dcda7cb3ffb19) · [Dev 2 BRE core](https://app.notion.com/p/3f6c9918ca0881feb043ce70d0c82f45) · [Dev 3 applications](https://app.notion.com/p/3f6c9918ca0881a8a2d1e57c4ffbe7ae) · [Dev 4 lender cases + E2E](https://app.notion.com/p/3f6c9918ca088155bab6d5114db33dd8) · [Dev 5 leads/customers/consent](https://app.notion.com/p/3f6c9918ca0881a8bc5bd034466f7eee) · [Dev 6 tasks/rule governance](https://app.notion.com/p/3f6c9918ca08811284caea46e1a50d0e)

IDs from the docs (FR-, BR-DOM-, DK-, API-, ENT-, TC-, TASK-, PA-, ADR-) appear in code comments and test names. Keep them.

## Commands

```bash
npm install                  # Node 24 (.nvmrc), npm 10+; npm workspaces, one root package-lock.json
npm run dev                  # API on :3000 (tsx watch) + web on :5173
npm run lint                 # ESLint incl. the module-boundary rule
npm run typecheck            # tsc --noEmit in every package
npm test                     # unit + API tests (Vitest + Supertest)
npm run test:int             # integration tests, need Docker (Testcontainers postgres:16)
npm run build -w @dsa/web
npm run db:start && npm run db:reset && npm run db:verify   # local Supabase, apply migrations, RLS/grant checks
npm run gen:openapi          # regenerate openapi/openapi.yaml (commit it; CI fails on a diff)
npm run format               # Prettier
```

Run one workspace's script with `-w`, e.g. `npm run test -w @dsa/api`. Run a single test file with
`npx vitest run test/app.spec.ts` from `apps/api`. Add a dependency to one package with
`npm install <pkg> -w @dsa/api`. Never hand-edit `package-lock.json`; regenerate it with `npm install`.
Workspace packages depend on each other as `"@dsa/contracts": "*"` (npm links them locally).

## Layout

```
apps/api/src/        Express 5 modular monolith
  app.ts server.ts config.ts         Dev 1 — middleware chain is fixed (see below)
  http/  kernel-min/                 Dev 1 — minimal kernel until TASK-101 moves it to packages/kernel
  modules/<module>/router.ts         one owner per module; all routers pre-registered in modules/index.ts
  modules/<module>/openapi.ts        the module's zod → OpenAPI registrations
apps/api/test/support/fake-auth.ts   fakeAuth(principal), createTestApp() for route tests
apps/web/src/        React 18 + Vite + MUI + TanStack Query + React Router
  routes.tsx shell/ auth/ api/       Dev 1
  features/<feature>/routes.tsx      composed automatically — owners never edit src/routes.tsx
packages/contracts/  zod schemas, kernel types, ports, fakes — FROZEN at Gate 1
packages/kernel/     Dev 1 (TASK-101/104/105)
packages/bre-core/   Dev 2 — pure, no I/O
supabase/            config.toml, migrations/ (frozen DDL baseline), MANIFEST.md (owners, number ranges)
tools/               gen-openapi, verify-migrations, provision-tenant, test-token, gen-registry-sql
tests/               isolation/ (TEST-SEC-001), e2e/, ui/ (Playwright)
```

## Non-negotiable rules

These are in scope and never dropped, whatever the slip (LR-1.6).

**Boundaries**

- A module never imports another module's internals and never queries another module's tables. Cross-module calls go through ports in `@dsa/contracts` (`eslint.config.mjs` enforces this via `import/no-restricted-paths`). A type shared by more than one module or with the web app lives in `packages/contracts`.
- `packages/contracts` and `supabase/migrations` are shared contracts. Changes are additive, by PR, approved by the affected owners, with a line in the Contracts §15 change log. A merged migration is never edited; corrections are new files in the owner's number range.
- Don't edit another lane's files. Owners are in each file header, `supabase/MANIFEST.md` and the Assignment Matrix.

**Tenancy and data access**

- The tenant comes **only** from the access token (`app_metadata.tenant_id`). Tenant IDs in path, query or body are ignored.
- All data access runs inside `TxRunner.withTenantTx(ctx, fn)`, which does `set_config('app.tenant_id', …, true)` (transaction-local). Never use session-level `SET`. RLS (`tenant_id = app_tenant()`) is the backstop, not the only check.
- The API connects as `dsa_api` (NOBYPASSRLS). Never as `postgres` or `service_role`, and never via `supabase-js` for data. The browser uses `supabase-js` for `auth.*` only; all data goes through the Express API.
- Unknown, other-tenant or out-of-scope IDs return **404**. In scope but without the permission returns **403**.
- Audit (`AuditPort.record`) and outbox (`OutboxPort.emit`) are written **in the same transaction** as the state change.

**API conventions** (Contracts §5–§6)

- Base path `/v1`; JSON in camelCase; enums use the canonical Doc 02 names.
- IDs are prefixed ULIDs. Money is `{ "amount": "300000.00", "currency": "INR" }`, with the amount always a string. Timestamps are ISO 8601 UTC with `Z`.
- A single resource is returned bare with `ETag: "<lock_version>"`. Lists return `{ data, meta: { nextCursor, limit } }` (limit ≤ 200, cursor pagination, allow-listed filters and sorts).
- `Idempotency-Key` is required on POSTs marked Idem. `If-Match` is required on PATCH/PUT and on transition POSTs.
- Errors use the envelope `{ error: { code, message, httpStatus, correlationId, details, retryable } }`, with codes only from `ERROR_HTTP_STATUS`. Throw `AppError.of(code, message, details)`.
- Validate requests with zod schemas from `@dsa/contracts`. Response types come from `z.infer`.

**Data protection**

- No S3-class data in the MVP (PAN, Aadhaar reference, DOB, UTR, loan account, bank details). Reject such fields.
- Never log request bodies, fact values, mobile, email, names or tokens. Lists mask mobile and email.
- Free-text fields reject PAN, Aadhaar and 9–18-digit account patterns with 422 VALIDATION_ERROR.
- Synthetic data only, in every environment and fixture.

**BRE**

- The engine never reads the clock (`evaluationTime = ctx.now`).
- `DecisionPort.decide` runs inside the caller's transaction and never throws for business outcomes.
- Rule approve, publish and suspend need step-up (`aal2` with TOTP ≤ 900 s) and SOD-01 (no self-approval).

## Testing

- Test names start with the test ID: `it('TC-LEAD-001 …')`, or `TEST-<MOD>-NNN` when Doc 16 has no ID.
- Unit tests sit next to the code as `*.spec.ts`; integration tests are `*.int.spec.ts` (Testcontainers).
- Route tests use `createTestApp({ auth: fakeAuth(testPrincipal({...})) })` with port fakes from `@dsa/contracts/fakes`.
- Every new endpoint gets an isolation case in `tests/isolation/cases/<module>.spec.ts`.
- Every interactive element in the Playwright journey carries `data-testid="<feature>.<element>"`.

## Git

- Trunk-based on `main`. Branches are named `d<N>/TASK-nnn-short-name`. One task per PR, about 400 lines or fewer.
- Commits use Conventional Commits with the task ID: `feat(leads): TASK-107 create lead with routing`.
- Never commit `.env` files or secrets; only `*.env.example` placeholders.
- Commit `package-lock.json`. CI installs with `npm ci`, so the lockfile must match the `package.json` files.

## Known gaps in the Gate 0 skeleton

- Fakes still to deliver by Gate 1: `FakeDecisionPort` and no-op `RulesSeederPort` (Dev 2), `FakeApplicationPort` (Dev 3), `FakeTaskPort` (Dev 6).
- `ids.ts` has only the prefixes named in the docs; complete it in TASK-101.
- `db.ts` `Database` is empty; generate Kysely types from the migrations in TASK-101/103.
- Migration M-011 (decision registry rows) is added by Dev 2 in TASK-204.
- Migration number ranges for Dev 4–6 are not allocated yet (`supabase/MANIFEST.md`).
- API-AUD-001 (audit search, Dev 6) has no module folder yet; agree its location before TASK-435.
