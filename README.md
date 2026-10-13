# DSA CRM for NBFCs

The 4-day walking-skeleton MVP: a TypeScript npm-workspaces monorepo with a React web app, an Express API, shared zod contracts, and Supabase (Postgres + Auth). Day 4 release `v0.1.0-rc.1` is an internal pilot candidate on synthetic data only, **not production-ready**.

Conventions, guardrails and links to the Notion specs: [CLAUDE.md](CLAUDE.md).

## Prerequisites

- Node.js 24 (`.nvmrc`)
- npm 10 or newer (ships with Node 24)
- Docker Desktop, for the local Supabase stack and the integration tests

## First run

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
npm run db:start        # local Supabase; prints the API URL, publishable key and JWT secret
npm run db:reset        # applies supabase/migrations
npm run db:verify       # RLS lint, grants and fail-closed checks (Migration Plan §8)
```

Put the values from `npm run db:status` into `.env` and `apps/web/.env`. The API connects as the `dsa_api` role, which is created outside migrations (see `supabase/MANIFEST.md`). Create it once on your local database with a local-only password, then set `DATABASE_URL`.

```bash
npm run dev             # API http://localhost:3000 (GET /health) · web http://localhost:5173
```

Every `/v1` request returns 401 until TASK-102 adds Supabase JWT verification. Every screen shows a placeholder naming its owner until the UI tasks land.

## Environments

There are three environments. Each developer runs their own local stack, the team shares one hosted development project, and tests never touch either of them.

| Environment         | Used for                                     | Database                                     | Supabase Auth                      | Where the values come from          |
| ------------------- | -------------------------------------------- | -------------------------------------------- | ---------------------------------- | ----------------------------------- |
| **Local** (default) | Everyday development                         | Local Supabase, port 54322                   | http://127.0.0.1:54321             | `npm run db:status`                 |
| **Shared dev**      | Integration testing by the team              | Hosted `dsa_api` role (Supavisor, port 6543) | https://<project-ref>.supabase.co  | Team password manager. Never in Git |
| **Test**            | `npm run test:int`, `npm run test:isolation` | Throwaway Postgres 16 container per run      | Test-only HS256 secret, no network | Created by the test code            |

Rules that keep the environments apart:

- Only two files hold configuration: `.env` (API and tools, copied from `.env.example`) and `apps/web/.env` (browser, copied from `apps/web/.env.example`). Both are git-ignored.
- `DATABASE_URL` and `SUPABASE_URL` must both be local or both be hosted. The API refuses to start otherwise.
- A hosted API never has `SUPABASE_JWT_SECRET`. Hosted tokens are checked through the project's JWKS.
- The browser only ever gets the publishable key. The web app refuses `sb_secret_…` and any `service_role` key.
- The service-role key is used only by `npm run provision:tenant`, and that command runs only against the local stack.
- Swagger's "Try it out" for the auth operations calls the Supabase URL from this environment's `SUPABASE_URL`.

Migrations live in `supabase/migrations` and are committed. Local: `npm run db:reset`. Shared dev: `npx supabase link --project-ref <ref>` then `npx supabase db push`. Hosted Auth settings (site URL, redirect URLs, email provider, 12-character passwords, TOTP) are set in the hosted dashboard. `supabase/config.toml` only configures the local stack.

## Checks (the same ones CI runs)

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build -w @dsa/web
npm run test:int        # needs Docker
npm run gen:openapi     # then commit openapi/openapi.yaml
```

## Layout

| Path                 | What                                                             | Owner                     |
| -------------------- | ---------------------------------------------------------------- | ------------------------- |
| `apps/api`           | Express 5 modular monolith; `src/modules/<module>/router.ts`     | per module (file header)  |
| `apps/web`           | React 18 + Vite + MUI; `src/features/<feature>/routes.tsx`       | per feature (file header) |
| `packages/contracts` | zod schemas, kernel types, ports, fakes (frozen at Gate 1)       | see its README            |
| `packages/kernel`    | auth, authz, tx, audit, outbox, idempotency, logging, rate limit | Dev 1                     |
| `packages/bre-core`  | Business Rule Engine core (pure)                                 | Dev 2                     |
| `supabase/`          | local config and migrations                                      | `MANIFEST.md`             |
| `tools/`             | OpenAPI generator, migration verifier, provisioning, test tokens | file headers              |
| `tests/`             | isolation, E2E, Playwright journey                               | `tests/README.md`         |
| `docs/`              | ADR index, runbook                                               | Dev 4 (runbook)           |
