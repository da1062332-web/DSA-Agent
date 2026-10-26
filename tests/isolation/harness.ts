// TEST-SEC-001 tenant isolation harness — owner: Dev 1 (SUB-TEN.04, CMP-TEN.04.3).
// One PostgreSQL 16 container per test file with EVERY migration applied, the API connected as dsa_api
// (NOBYPASSRLS) exactly like production, and two tenants with IDENTICAL natural keys (Contracts §13): same
// branch code, team name, queue code and user names. A case passes only if tenant B can neither see nor change
// tenant A's rows. Module owners add tests/isolation/cases/<module>.spec.ts using these helpers.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Database, PermissionCode, Principal } from '@dsa/contracts';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { parse } from 'yaml';
import { assertThrowawayDatabase } from '../guard/verify-local-db';
import { createApp } from '../../apps/api/src/app';
import { createDb } from '../../apps/api/src/kernel-min/db';
import { createTxRunner } from '../../apps/api/src/kernel-min/tx-runner';
import { createProductionDeps } from '../../apps/api/src/wiring';
import { fakeAuth, testPrincipal } from '../../apps/api/test/support/fake-auth';
import { startPostgres } from '../guard/start-postgres';

const ROOT = path.resolve(import.meta.dirname, '../..');
// DSA_MIGRATIONS_DIR points the harness at another folder of migrations, to test a corrected copy without editing the real files.
const MIGRATIONS_DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');

/** Natural keys shared by both tenants. */
export const KEYS = { branchCode: 'MUM01', teamName: 'Sales', queueCode: 'MUM01-INTAKE' } as const;

export interface TenantFixture {
  tenantId: string;
  orgId: string;
  branchId: string;
  teamId: string;
  queueId: string;
  userIds: [string, string];
}

export interface IsolationEnv {
  A: TenantFixture;
  B: TenantFixture;
  /** Superuser connection for assertions on the raw tables (bypasses RLS). */
  admin: pg.Client;
  db: Kysely<Database>;
  /** The API as a user of `tenant` holding `codes` at TENANT scope. */
  appAs(tenant: TenantFixture, codes?: PermissionCode[], userIndex?: 0 | 1): ReturnType<typeof createApp>;
  /** The API with no authentication (every /v1 call must be 401). */
  anonymousApp(): ReturnType<typeof createApp>;
  stop(): Promise<void>;
}

export const ALL_ADMIN: PermissionCode[] = ['config.manage', 'user.manage'];

export async function startIsolationEnv(): Promise<IsolationEnv> {
  const container: StartedPostgreSqlContainer = await startPostgres();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();

  // The migrations grant to Supabase's API roles. A plain Postgres container does not have them, so create them first.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;`);

  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await admin.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await admin.query(`CREATE ROLE dsa_api LOGIN PASSWORD 'isolation' NOBYPASSRLS IN ROLE dsa_app;
                     ALTER ROLE dsa_api SET search_path = app, extensions;`);

  const A = await seedTenant(admin, 'a');
  const B = await seedTenant(admin, 'b');

  const url = new URL(container.getConnectionUri());
  url.username = 'dsa_api';
  url.password = 'isolation';
  // The tests are about to write to this database: it must be the container started above, on this machine.
  await assertThrowawayDatabase(container, admin, [url.toString()]);
  const db = createDb(url.toString(), { poolMax: 4 });
  // Exactly the production dependencies (apps/api/src/wiring.ts), so a case sees the same ports as a deployment.
  const deps = createProductionDeps(createTxRunner(db));

  const principalOf = (t: TenantFixture, codes: PermissionCode[], userIndex: 0 | 1): Principal =>
    testPrincipal({
      id: t.userIds[userIndex],
      tenantId: t.tenantId,
      primaryBranchId: t.branchId,
      // A session that has passed the authenticator check recently, so step-up routes (role edits, rule approval) are reached and the
      // case under test is isolation (404), not "needs step-up" (401).
      authTime: new Date().toISOString(),
      grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
    });

  return {
    A,
    B,
    admin,
    db,
    appAs: (t, codes = [], userIndex = 0) =>
      createApp({ deps, corsAllowedOrigins: [], auth: fakeAuth(principalOf(t, codes, userIndex)) }),
    anonymousApp: () => createApp({ deps, corsAllowedOrigins: [] }),
    async stop() {
      await db.destroy();
      await admin.end();
      await container.stop();
    },
  };
}

/** Rows are inserted as the superuser, so the fixture does not depend on the API under test. */
async function seedTenant(admin: pg.Client, s: string): Promise<TenantFixture> {
  const f: TenantFixture = {
    // A valid ULID: 26 characters from the Crockford alphabet (the token check enforces this format).
    tenantId: `ten_${'0'.repeat(25)}${s === 'a' ? 'A' : 'B'}`,
    orgId: `org_iso_${s}`,
    branchId: `br_iso_${s}`,
    teamId: `team_iso_${s}`,
    queueId: `wq_iso_${s}`,
    userIds: [`usr_iso_${s}1`, `usr_iso_${s}2`],
  };
  const q = (text: string, values: unknown[]) => admin.query(text, values);
  await q(
    `insert into app.tenant (id, slug, legal_name, tenant_type, created_by) values ($1, $2, 'Tenant', 'DSA_ORG', 'iso')`,
    [f.tenantId, `iso-${s}`],
  );
  await q(
    `insert into app.organisation (id, tenant_id, legal_name, constitution, created_by, updated_by)
           values ($1, $2, 'Same Name Pvt Ltd', 'PVT_LTD', 'iso', 'iso')`,
    [f.orgId, f.tenantId],
  );
  await q(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
           values ($1, $2, $3, $4, 'Mumbai', 'iso', 'iso')`,
    [f.branchId, f.tenantId, f.orgId, KEYS.branchCode],
  );
  for (const [i, id] of f.userIds.entries()) {
    await q(
      `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
             values ($1, $2, $3, $4, $5, $6, 'iso', 'iso')`,
      [id, f.tenantId, `sub-iso-${s}${i}`, `user${i}@iso-${s}.example.com`, `User ${i}`, f.branchId],
    );
  }
  await q(
    `insert into app.team (id, tenant_id, name, branch_id, manager_user_id, created_by, updated_by)
           values ($1, $2, $3, $4, $5, 'iso', 'iso')`,
    [f.teamId, f.tenantId, KEYS.teamName, f.branchId, f.userIds[0]],
  );
  await q(
    `insert into app.team_membership (id, tenant_id, team_id, user_id, created_by) values ($1, $2, $3, $4, 'iso')`,
    [`tm_iso_${s}`, f.tenantId, f.teamId, f.userIds[1]],
  );
  await q(
    `insert into app.work_queue (id, tenant_id, code, name, kind, branch_id, record_types, created_by, updated_by)
           values ($1, $2, $3, 'Intake', 'INTAKE', $4, '{LEAD}', 'iso', 'iso')`,
    [f.queueId, f.tenantId, KEYS.queueCode, f.branchId],
  );
  return f;
}

export interface Operation {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  operationId: string;
}

/** Every /v1 operation in the committed OpenAPI document — the endpoint inventory (tests/README.md). */
export function v1Operations(): Operation[] {
  const doc = parse(readFileSync(path.join(ROOT, 'openapi/openapi.yaml'), 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  return Object.entries(doc.paths)
    .filter(([p]) => p.startsWith('/v1/'))
    .flatMap(([p, methods]) =>
      Object.entries(methods)
        .filter(([m]) => ['get', 'post', 'patch', 'put', 'delete'].includes(m))
        .map(([m, op]) => ({
          method: m as Operation['method'],
          path: p,
          operationId: op.operationId ?? `${m} ${p}`,
        })),
    );
}

/** Replaces `{id}` with the given id: `/v1/teams/{id}/members` → `/v1/teams/team_x/members`. */
export const fill = (p: string, id: string) => p.replace(/\{[^}]+\}/g, id);

/** Current lock_version of a row, read as superuser — proves a rejected write changed nothing. */
export async function versionOf(admin: pg.Client, table: string, id: string): Promise<number> {
  const r = await admin.query(`select lock_version from app.${table} where id = $1`, [id]);
  return Number(r.rows[0]?.lock_version);
}
