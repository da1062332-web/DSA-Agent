// Rehearsal of the hosted test-data cleanup (tools/sql/cleanup). Owner: Dev 1. Runs on a throwaway PostgreSQL that holds the same test
// tenants as hosted plus the demo and platform tenants, with disposable rows in the test tenants and control rows elsewhere.
// It proves the cleanup deletes only the candidate tables of the three test tenants, children first, leaves every control row and
// every kept table alone, skips what refuses instead of forcing it, and aborts when the tenants are not the expected ones.
// Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const script = (name: string) => readFileSync(path.join(ROOT, 'tools/sql/cleanup', name), 'utf8');
const fixture = (name: string) => readFileSync(path.join(ROOT, 'tests/guard/fixtures', name), 'utf8');

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let seq = 0;

const connectTo = async (database: string) => {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return c;
};

beforeAll(async () => {
  container = await new PostgreSqlContainer(process.env.DSA_PG_IMAGE ?? 'postgres:16').start();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE cleanup_base');
  const base = await connectTo('cleanup_base');
  for (const f of readdirSync(DIR)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    await base.query(readFileSync(path.join(DIR, f), 'utf8'));
    if (f.startsWith('20261001000001_')) await base.query(fixture('hosted-test-fixtures.early.sql'));
  }
  await base.query(fixture('hosted-test-fixtures.late.sql'));
  await base.end();
}, 300_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

async function fresh(): Promise<{ db: pg.Client; testIds: string[]; controlId: string }> {
  const name = `cleanup_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE cleanup_base`);
  const db = await connectTo(name);
  const testIds = (
    await db.query(
      `SELECT id FROM app.tenant WHERE slug IN ('test-dsa-alpha','test-dsa-beta','test-tenant-b') ORDER BY id`,
    )
  ).rows.map((r) => r.id as string);
  const controlId = (await db.query(`SELECT id FROM app.tenant WHERE slug = 'demo-alpha'`)).rows[0]
    .id as string;
  for (const t of [...testIds, controlId]) {
    const branch = `${t}_b`;
    await db.query(
      `INSERT INTO app.activity (id, tenant_id, subject_type, subject_id, kind, occurred_at, actor_id, actor_branch_id)
       VALUES ($1, $2, 'LEAD', 'lead_x', 'NOTE', now(), 'usr_x', $3), ($4, $2, 'LEAD', 'lead_y', 'NOTE', now(), 'usr_x', $3)`,
      [`act_${t}_1`, t, branch, `act_${t}_2`],
    );
    await db.query(
      `INSERT INTO app.idempotency_key (tenant_id, principal_id, key, method, path, request_hash, status, response_status)
       VALUES ($1, 'usr_x', 'key-0000001', 'POST', '/v1/x', repeat('a', 64), 'COMPLETED', 201)`,
      [t],
    );
    await db.query(
      `INSERT INTO app.dedupe_registry (tenant_id, namespace, key, ref_id) VALUES ($1, 'DECISION', 'k-123', 'r1')`,
      [t],
    );
    await db.query(
      `INSERT INTO app.lender (id, tenant_id, name, lender_type, created_by, updated_by) VALUES ($1, $2, 'Test lender', 'BANK', 'u', 'u')`,
      [`lnd_${t}`, t],
    );
  }
  return { db, testIds, controlId };
}

const countOf = async (db: pg.Client, table: string, tenant: string) =>
  (await db.query(`SELECT count(*)::int AS n FROM app.${table} WHERE tenant_id = $1`, [tenant])).rows[0]
    .n as number;

describe('hosted test-data cleanup', () => {
  it('TEST-CLEAN-01 the counts and backup scripts are read-only, and the backup holds the rows that the cleanup will delete', async () => {
    const { db, testIds } = await fresh();
    const before = (await db.query(`SELECT count(*)::int AS n FROM app.activity`)).rows[0].n;
    const counts = await db.query(script('00-counts.sql'));
    expect(counts.rows.length).toBeGreaterThan(0);
    const backup = (await db.query(script('01-backup.sql'))).rows[0].backup as Record<string, unknown[]>;
    expect((backup.activity as unknown[]).length).toBe(6);
    expect((backup.lender as unknown[]).length).toBe(3);
    expect((backup.tenants as unknown[]).length).toBe(3);
    expect(JSON.stringify(backup)).not.toContain('demo-alpha');
    expect(testIds.length).toBe(3);
    expect((await db.query(`SELECT count(*)::int AS n FROM app.activity`)).rows[0].n).toBe(before);
    await db.end();
  });

  it('TEST-CLEAN-02 the cleanup removes the disposable rows of the three test tenants only, and every other row stays', async () => {
    const { db, testIds, controlId } = await fresh();
    const kept = async () => ({
      users: (await db.query(`SELECT count(*)::int AS n FROM app.app_user`)).rows[0].n as number,
      roles: (await db.query(`SELECT count(*)::int AS n FROM app.role`)).rows[0].n as number,
      grants: (await db.query(`SELECT count(*)::int AS n FROM app.role_permission`)).rows[0].n as number,
      tenants: (await db.query(`SELECT count(*)::int AS n FROM app.tenant`)).rows[0].n as number,
      branches: (await db.query(`SELECT count(*)::int AS n FROM app.branch`)).rows[0].n as number,
    });
    const keptBefore = await kept();
    const results = (await db.query(script('02-cleanup.sql'))) as unknown as {
      rows: { table_name: string; deleted: string; skipped: string | null }[];
    }[];
    const rows =
      (Array.isArray(results) ? results.find((r) => r.rows?.[0]?.table_name) : undefined)?.rows ?? [];
    expect(rows.map((r) => r.table_name)).toContain('activity');
    // Five candidate tables are append-only or delete-protected by design (audit-style): the cleanup reports them and never forces them.
    expect(
      rows
        .filter((r) => r.skipped)
        .map((r) => r.table_name)
        .sort(),
    ).toEqual(['activity', 'dedupe_registry']);

    for (const t of testIds) {
      for (const table of ['idempotency_key', 'lender'])
        expect(await countOf(db, table, t), `${table} ${t}`).toBe(0);
      for (const table of ['activity', 'dedupe_registry'])
        expect(await countOf(db, table, t), `protected ${table} ${t}`).toBeGreaterThan(0);
    }
    for (const table of ['activity', 'idempotency_key', 'dedupe_registry', 'lender']) {
      expect(await countOf(db, table, controlId), `control ${table}`).toBeGreaterThan(0);
    }
    expect(await kept()).toEqual(keptBefore);

    const verify = (await db.query(script('03-verify.sql'))).rows as { check: string; result: string }[];
    expect(
      verify.filter((r) => r.check.includes('exist') || r.check.includes('untouched')).map((r) => r.result),
    ).toEqual(['PASS', 'PASS', 'PASS']);
    await db.end();
  });

  it('TEST-CLEAN-03 parents are deleted after their children (order follows the foreign keys among the candidate tables)', async () => {
    const { db } = await fresh();
    const out = (await db.query(script('02-cleanup.sql'))) as unknown as
      { rows: { seq: number; table_name: string }[] }[] | { rows: { seq: number; table_name: string }[] };
    const rows = (Array.isArray(out) ? out.find((r) => r.rows?.[0]?.table_name)!.rows : out.rows) as {
      seq: number;
      table_name: string;
    }[];
    const order = rows.map((r) => r.table_name);
    const fks = (
      await db.query(
        `SELECT child.relname AS child, parent.relname AS parent FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid JOIN pg_class parent ON parent.oid = c.confrelid
          WHERE c.contype = 'f' AND child.relnamespace = 'app'::regnamespace AND parent.relnamespace = 'app'::regnamespace`,
      )
    ).rows as { child: string; parent: string }[];
    const bad = fks.filter(
      (f) =>
        f.child !== f.parent &&
        order.includes(f.child) &&
        order.includes(f.parent) &&
        order.indexOf(f.child) > order.indexOf(f.parent),
    );
    expect(bad).toEqual([]);
    expect(order.length).toBe(24);
    await db.end();
  });

  it('TEST-CLEAN-04 a table that refuses the delete is skipped and reported, not forced, and the rest still goes', async () => {
    const { db, testIds } = await fresh();
    await db.query(
      `CREATE FUNCTION app.block_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$`,
    );
    await db.query(
      `CREATE TRIGGER lender_blocked BEFORE DELETE ON app.lender FOR EACH ROW EXECUTE FUNCTION app.block_delete()`,
    );
    const out = (await db.query(script('02-cleanup.sql'))) as unknown as {
      rows: { table_name: string; skipped: string | null }[];
    }[];
    const rows = out.find((r) => r.rows?.[0]?.table_name)!.rows;
    expect(rows.find((r) => r.table_name === 'lender')?.skipped).toMatch(/append-only/);
    expect(await countOf(db, 'lender', testIds[0]!)).toBe(1);
    expect(await countOf(db, 'idempotency_key', testIds[0]!)).toBe(0);
    await db.end();
  });

  it('TEST-CLEAN-05 the cleanup aborts and changes nothing when the tenants are not exactly the expected test tenants', async () => {
    const { db, testIds } = await fresh();
    await db.query(`UPDATE app.tenant SET slug = 'test-dsa-alpha-renamed' WHERE id = $1`, [testIds[0]]);
    await expect(db.query(script('02-cleanup.sql'))).rejects.toThrow(/Aborted/);
    await db.query('ROLLBACK').catch(() => undefined);
    expect(await countOf(db, 'activity', testIds[1]!)).toBe(2);
    await db.end();
  });
});
