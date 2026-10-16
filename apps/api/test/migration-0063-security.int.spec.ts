// The security migration was renumbered from a second 0043 to 0063 (owner: Dev 1). Hosted has the integrations migration (0043)
// but not the security tables, so the real situation is: everything else is applied, then 0063 arrives on its own.
// This builds that state on a throwaway PostgreSQL, applies 0063 alone, and proves it works and leaves the
// integrations migration (0043) untouched. (It is not re-run a second time: the shared enable_tenant_rls helper creates its policy
// without a guard in every migration, so no migration in the project repeats cleanly as a whole file.) It never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../supabase/migrations');
const SECURITY = '20261001000063_security_monitoring_incidents.sql';
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8');

let container: StartedPostgreSqlContainer;
let db: pg.Client;

const exists = async (table: string) =>
  (await db.query(`SELECT to_regclass('app.${table}') IS NOT NULL AS present`)).rows[0].present as boolean;

beforeAll(async () => {
  container = await new PostgreSqlContainer(process.env.DSA_PG_IMAGE ?? 'postgres:16').start();
  db = new pg.Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  for (const f of readdirSync(DIR)
    .filter((x) => x.endsWith('.sql') && x !== SECURITY)
    .sort())
    await db.query(read(f));
}, 240_000);

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

describe('migration 0063 (security events and incidents), formerly the second 0043', () => {
  it('TEST-MIG63-01 every other migration builds without it, and the integrations migration (0043) has its table', async () => {
    expect(await exists('integration_connection')).toBe(true);
    expect(await exists('security_event')).toBe(false);
    expect(await exists('incident_record')).toBe(false);
  });

  it('TEST-MIG63-02 applied on its own it creates both tables with row-level security forced, and the security permissions', async () => {
    await db.query(read(SECURITY));
    expect(await exists('security_event')).toBe(true);
    expect(await exists('incident_record')).toBe(true);
    const rls = await db.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('app.security_event'::regclass, 'app.incident_record'::regclass) ORDER BY relname`,
    );
    expect(rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    const perms = await db.query(`SELECT code FROM app.permission WHERE code LIKE 'security.%'`);
    expect(perms.rowCount).toBeGreaterThan(0);
  });

  it('TEST-MIG63-03 security events stay append-only', async () => {
    await db
      .query(
        `INSERT INTO app.tenant (id, slug, name) VALUES ('ten_mig63', 'mig63', 'Mig 63') ON CONFLICT DO NOTHING`,
      )
      .catch(() => undefined);
    const tenant = (await db.query(`SELECT id FROM app.tenant LIMIT 1`)).rows[0]?.id as string | undefined;
    expect(tenant).toBeTruthy();
    await db.query(
      `INSERT INTO app.security_event (id, tenant_id, type, principal, ip, severity) VALUES ('sec_mig63', $1, 'LOGIN', 'p', '127.0.0.1', 'LOW')`,
      [tenant],
    );
    await expect(
      db.query(`UPDATE app.security_event SET severity = 'HIGH' WHERE id = 'sec_mig63'`),
    ).rejects.toThrow();
  });
});
