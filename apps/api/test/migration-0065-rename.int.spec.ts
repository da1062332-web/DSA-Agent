// Migration 0065 (owner: Dev 1). Hosted ran the ORIGINAL 0053, which named the connector statement table ledger_entry; the file and the
// invoices code now say connector_statement_entry. 0065 renames the old table in place and does nothing on a fresh database.
// The "hosted" database below is built from the original 0053 text (tests/guard/fixtures/0053-as-applied-on-hosted.sql, taken from git
// before the edit), not by renaming a new table back, so every old name (table, constraints, indexes, policy) is really there.
// Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const MIGRATION = '20261001000065_rename_ledger_entry_to_connector_statement_entry.sql';
const OLD_0053 = readFileSync(path.join(ROOT, 'tests/guard/fixtures/0053-as-applied-on-hosted.sql'), 'utf8');
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8');
const script = (n: string) => readFileSync(path.join(ROOT, 'tools/sql/batch', n), 'utf8');

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

async function build(name: string, useOld0053: boolean) {
  await admin.query(`CREATE DATABASE ${name}`);
  const db = await connectTo(name);
  for (const f of readdirSync(DIR)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    if (useOld0053 && f.startsWith('20261001000065_')) continue; // hosted has not run 0065
    await db.query(useOld0053 && f.startsWith('20261001000053_') ? OLD_0053 : read(f));
  }
  await db.end();
}

async function copy(template: string): Promise<pg.Client> {
  const name = `rn_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  return connectTo(name);
}

/** The table, its indexes, constraints, policies, privileges and columns, reduced to one string. */
const shape = async (db: pg.Client) =>
  (
    await db.query(`
      SELECT string_agg(x, '|' ORDER BY x) AS s FROM (
        SELECT 'col:' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'connector_statement_entry'
        UNION ALL SELECT 'idx:' || indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'connector_statement_entry'
        UNION ALL SELECT 'con:' || conname FROM pg_constraint WHERE conrelid = 'app.connector_statement_entry'::regclass
        UNION ALL SELECT 'pol:' || policyname FROM pg_policies WHERE schemaname = 'app' AND tablename = 'connector_statement_entry'
        UNION ALL SELECT 'priv:' || grantee || ':' || privilege_type FROM information_schema.table_privileges WHERE table_schema = 'app' AND table_name = 'connector_statement_entry' AND grantee = 'dsa_app'
        UNION ALL SELECT 'rls:' || relrowsecurity || relforcerowsecurity FROM pg_class WHERE oid = 'app.connector_statement_entry'::regclass
      ) t`)
  ).rows[0].s as string;

beforeAll(async () => {
  container = await startPostgres();
  admin = await connectTo('postgres');
  await build('fresh_base', false);
  await build('hosted_old_base', true);
}, 300_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe('migration 0065: connector statement table name', () => {
  it('TEST-MIG65-01 on a fresh build the table has the new name, the old name is free for the ledger, and verify passes', async () => {
    const db = await copy('fresh_base');
    expect(
      (await db.query(`SELECT to_regclass('app.connector_statement_entry') IS NOT NULL AS ok`)).rows[0].ok,
    ).toBe(true);
    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NULL AS ok`)).rows[0].ok).toBe(true);
    const rows = (await db.query(script('65.verify.sql'))).rows as { result: string }[];
    expect(rows.map((r) => r.result)).toEqual(['PASS', 'PASS', 'PASS']);
    await db.end();
  });

  it('TEST-MIG65-02 the database really is in the old state before 0065 (old table, constraint, index and policy names)', async () => {
    const db = await copy('hosted_old_base');
    const names = (
      await db.query(
        `SELECT conname AS n FROM pg_constraint WHERE conrelid = 'app.ledger_entry'::regclass
       UNION ALL SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'ledger_entry'
       UNION ALL SELECT policyname FROM pg_policies WHERE schemaname = 'app' AND tablename = 'ledger_entry'`,
      )
    ).rows.map((r) => r.n as string);
    expect(names).toEqual(
      expect.arrayContaining([
        'ledger_entry_pkey',
        'ledger_entry_entry_type_check',
        'ledger_entry_tenant_id_fkey',
        'ledger_entry_tenant_isolation',
      ]),
    );
    expect(
      (await db.query(`SELECT to_regclass('app.connector_statement_entry') IS NULL AS ok`)).rows[0].ok,
    ).toBe(true);
    await db.end();
  });

  it('TEST-MIG65-03 from the hosted state the table is renamed in place with its rows, privileges and row-level security, and ends exactly like a fresh build', async () => {
    const reference = await copy('fresh_base');
    const expected = await shape(reference);
    await reference.end();

    const db = await copy('hosted_old_base');
    const tenant = (await db.query(`SELECT id FROM app.tenant LIMIT 1`)).rows[0].id as string;
    await db.query(
      `INSERT INTO app.ledger_entry (id, tenant_id, connector_id, entry_type, amount, created_by, updated_by) VALUES ('le_old_1', $1, 'con_1', 'COMMISSION_EARNED', 10, 'u', 'u')`,
      [tenant],
    );

    await db.query(read(MIGRATION));

    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NULL AS ok`)).rows[0].ok).toBe(true);
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM app.connector_statement_entry WHERE id = 'le_old_1'`))
        .rows[0].n,
    ).toBe(1);
    expect(await shape(db)).toBe(expected);
    const rows = (await db.query(script('65.verify.sql'))).rows as { result: string }[];
    expect(rows.map((r) => r.result)).toEqual(['PASS', 'PASS', 'PASS']);

    // The invoices code's own statements work against the renamed table.
    await db.query(
      `INSERT INTO app.connector_statement_entry (id, tenant_id, connector_id, entry_type, amount, created_by, updated_by) VALUES ('le_new_1', $1, 'con_1', 'ADJUSTMENT', 5, 'u', 'u')`,
      [tenant],
    );
    expect((await db.query(`SELECT count(*)::int AS n FROM app.connector_statement_entry`)).rows[0].n).toBe(
      2,
    );
    await db.end();
  });

  it('TEST-MIG65-04 row-level security still isolates tenants for the real dsa_api login after the rename', async () => {
    const db = await copy('hosted_old_base');
    const tenants = (await db.query(`SELECT id FROM app.tenant ORDER BY id LIMIT 2`)).rows.map(
      (r) => r.id as string,
    );
    for (const [i, t] of tenants.entries()) {
      await db.query(
        `INSERT INTO app.ledger_entry (id, tenant_id, connector_id, entry_type, amount, created_by, updated_by) VALUES ($1, $2, 'con_1', 'ADJUSTMENT', 1, 'u', 'u')`,
        [`le_iso_${i}`, t],
      );
    }
    await db.query(read(MIGRATION));
    await db.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_api') THEN CREATE ROLE dsa_api LOGIN PASSWORD 'rename-test' NOBYPASSRLS IN ROLE dsa_app; END IF; END $$`,
    );
    const url = new URL(container.getConnectionUri());
    const dbName = (await db.query(`SELECT current_database() AS d`)).rows[0].d as string;
    const api = new pg.Client({
      host: url.hostname,
      port: Number(url.port),
      database: dbName,
      user: 'dsa_api',
      password: 'rename-test',
    });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenants[0]]);
      const seen = (await api.query(`SELECT tenant_id FROM app.connector_statement_entry`)).rows.map(
        (r) => r.tenant_id,
      );
      expect(seen).toEqual([tenants[0]]);
      await api.query('ROLLBACK');
    } finally {
      await api.end();
    }
    await db.end();
  });

  it('TEST-MIG65-05 running it again changes nothing, and a table called ledger_entry that is not the connector statement table is never renamed', async () => {
    const db = await copy('hosted_old_base');
    await db.query(read(MIGRATION));
    const once = await shape(db);
    await db.query(read(MIGRATION));
    expect(await shape(db)).toBe(once);
    await db.query(`CREATE TABLE app.ledger_entry (id text PRIMARY KEY, journal_id text)`); // the ledger module's own kind of table
    await db.query('ALTER TABLE app.connector_statement_entry RENAME TO tmp_cse');
    await db.query(read(MIGRATION));
    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NOT NULL AS ok`)).rows[0].ok).toBe(
      true,
    );
    expect((await db.query(`SELECT to_regclass('app.tmp_cse') IS NOT NULL AS ok`)).rows[0].ok).toBe(true);
    await db.end();
  });

  it('TEST-MIG65-06 the rollback script returns every old name, keeps the rows, and the migration can then be applied again', async () => {
    const db = await copy('fresh_base');
    const tenant = (await db.query(`SELECT id FROM app.tenant LIMIT 1`)).rows[0].id as string;
    await db.query(
      `INSERT INTO app.connector_statement_entry (id, tenant_id, connector_id, entry_type, amount, created_by, updated_by) VALUES ('le_rb_1', $1, 'con_1', 'ADJUSTMENT', 1, 'u', 'u')`,
      [tenant],
    );
    const before = await shape(db);
    await db.query(script('65.rollback.sql'));
    const names = (
      await db.query(
        `SELECT conname AS n FROM pg_constraint WHERE conrelid = 'app.ledger_entry'::regclass
       UNION ALL SELECT policyname FROM pg_policies WHERE schemaname = 'app' AND tablename = 'ledger_entry'`,
      )
    ).rows.map((r) => r.n as string);
    expect(names).toEqual(
      expect.arrayContaining([
        'ledger_entry_pkey',
        'ledger_entry_entry_type_check',
        'ledger_entry_tenant_id_fkey',
        'ledger_entry_tenant_isolation',
      ]),
    );
    expect(
      (await db.query(`SELECT count(*)::int AS n FROM app.ledger_entry WHERE id = 'le_rb_1'`)).rows[0].n,
    ).toBe(1);
    await db.query(read(MIGRATION));
    expect(await shape(db)).toBe(before);
    await db.end();
  });
});
