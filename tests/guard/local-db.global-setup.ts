// Global setup for the integration configs: one throwaway PostgreSQL container with every migration applied and a
// dsa_api login, exported as DATABASE_URL / VERIFY_DATABASE_URL. Specs that read those variables (the *-live-pg and *.pg
// specs, which were written for the hosted database) therefore run against this container, and the connection strings
// in apps/api/.env or inside a spec are never used. Pair it with no-hosted-db.ts, which refuses any non-local host.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { assertThrowawayDatabase } from './verify-local-db';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS_DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');

// The tenant, organisation, branch, app_user and role tables are created by this migration.
const EARLY_FIXTURES_AFTER = '20261001000001_';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer(process.env.DSA_PG_IMAGE ?? 'postgres:16').start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await admin.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    // On hosted the test tenants and their roles existed before the later migrations ran, so those migrations' grants reached them.
    if (file.startsWith(EARLY_FIXTURES_AFTER)) await admin.query(fixture('hosted-test-fixtures.early.sql'));
  }
  await admin.query(`CREATE ROLE dsa_api LOGIN PASSWORD 'local-test' NOBYPASSRLS IN ROLE dsa_app;
                     ALTER ROLE dsa_api SET search_path = app, extensions;`);
  // Role grants exported from hosted, for the permissions that exist in a fresh build.
  await admin.query(fixture('hosted-test-fixtures.late.sql'));

  const api = new URL(container.getConnectionUri());
  api.username = 'dsa_api';
  api.password = 'local-test';
  // Before any spec runs: both connection strings must lead to this very container, on this machine.
  await assertThrowawayDatabase(container, admin, [api.toString(), container.getConnectionUri()]);
  await admin.end();
  process.env.DATABASE_URL = api.toString();
  process.env.VERIFY_DATABASE_URL = container.getConnectionUri();
  process.env.DIRECT_DATABASE_URL = container.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
