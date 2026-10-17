// Migration 0065 (owner: Dev 1). Hosted ran the old 0053, which named the connector statement table ledger_entry; the file and the
// invoices code now say connector_statement_entry. 0065 renames the old table in place and does nothing on a fresh database.
// This builds both situations on a throwaway PostgreSQL and proves the result is the same, with the rows kept. Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const MIGRATION = '20261001000065_rename_ledger_entry_to_connector_statement_entry.sql';
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

async function fresh(): Promise<pg.Client> {
  const name = `rn_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE rename_base`);
  return connectTo(name);
}

/** The table, its indexes, constraints, policies and columns, reduced to one string. */
const shape = async (db: pg.Client) =>
  (
    await db.query(`
      SELECT string_agg(x, '|' ORDER BY x) AS s FROM (
        SELECT 'col:' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'connector_statement_entry'
        UNION ALL SELECT 'idx:' || indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'connector_statement_entry'
        UNION ALL SELECT 'con:' || conname FROM pg_constraint WHERE conrelid = 'app.connector_statement_entry'::regclass
        UNION ALL SELECT 'pol:' || policyname FROM pg_policies WHERE schemaname = 'app' AND tablename = 'connector_statement_entry'
      ) t`)
  ).rows[0].s as string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(process.env.DSA_PG_IMAGE ?? 'postgres:16').start();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE rename_base');
  const base = await connectTo('rename_base');
  for (const f of readdirSync(DIR)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await base.query(read(f));
  await base.end();
}, 300_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe('migration 0065: connector statement table name', () => {
  it('TEST-MIG65-01 on a fresh build the table has the new name, the old name is free for the ledger, and verify passes', async () => {
    const db = await fresh();
    expect(
      (await db.query(`SELECT to_regclass('app.connector_statement_entry') IS NOT NULL AS ok`)).rows[0].ok,
    ).toBe(true);
    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NULL AS ok`)).rows[0].ok).toBe(true);
    const rows = (await db.query(script('65.verify.sql'))).rows as { result: string }[];
    expect(rows.map((r) => r.result)).toEqual(['PASS', 'PASS', 'PASS']);
    await db.end();
  });

  it('TEST-MIG65-02 on a database that ran the old 0053 the table is renamed in place with its rows, and ends exactly like a fresh build', async () => {
    const fresher = await fresh();
    const expected = await shape(fresher);
    await fresher.end();

    const db = await fresh();
    await db.query(script('65.rollback.sql')); // puts the old names back: the state hosted is in
    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NOT NULL AS ok`)).rows[0].ok).toBe(
      true,
    );
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
    await db.end();
  });

  it('TEST-MIG65-03 running it again, or on the ledger module table of the same old name, changes nothing', async () => {
    const db = await fresh();
    await db.query(read(MIGRATION));
    await db.query(read(MIGRATION));
    expect(
      (await db.query(`SELECT to_regclass('app.ledger_journal_line') IS NOT NULL AS ok`)).rows[0].ok,
    ).toBe(true);
    // A table called ledger_entry that is NOT the connector statement table (no connector_id column) must never be renamed.
    await db.query(`CREATE TABLE app.ledger_entry (id text PRIMARY KEY, journal_id text)`);
    await db.query('ALTER TABLE app.connector_statement_entry RENAME TO tmp_cse');
    await db.query(read(MIGRATION));
    expect((await db.query(`SELECT to_regclass('app.ledger_entry') IS NOT NULL AS ok`)).rows[0].ok).toBe(
      true,
    );
    await db.end();
  });
});
