// Flow-wise demo seed loader — owner: Dev 1. Synthetic data only (ASM-4D-06).
// Writes seeds/demo/flow (every table, 8+ rows per demo tenant) into a LOCAL database in one transaction.
//
//   npm run seed:local-flow -w @dsa/tools            # uses DATABASE_URL, default local supabase (127.0.0.1:54322)
//
// Safety: refuses any host that is not loopback, refuses a database that already holds the demo tenants, and runs
// the whole load in one transaction. Foreign-key triggers are switched off for the load (session_replication_role =
// replica) because the seed writes parents and children in one batch; every foreign key is then checked explicitly
// after the load, the ledger balance rule is checked by hand (its trigger is skipped), and any failure rolls back.
import pg from 'pg';
import { buildFlowSeed } from '../seeds/demo/flow';
import { type Row, ix } from '../seeds/demo/flow/types';

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;
const CHUNK = 200;
const MIN_ROWS = 8;
const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const host = new URL(url).hostname;
  if (!LOOPBACK.test(host)) {
    throw new Error(`Refusing to seed: DATABASE_URL points at "${host}", not at this machine.`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query<{ n: number }>(
      `select count(*)::int as n from app.tenant where id = 'ten_alpha'`,
    );
    if ((existing.rows[0]?.n ?? 0) > 0) {
      throw new Error(
        'Already seeded (tenant ten_alpha exists). Reset the local database first, then run this again.',
      );
    }

    const seed = buildFlowSeed();
    const entries = seed.entries();

    const columns = await client.query<{ table_name: string; column_name: string; udt_name: string }>(
      `select table_name, column_name, udt_name from information_schema.columns where table_schema = 'app'`,
    );
    const jsonb = new Set(
      columns.rows.filter((c) => c.udt_name === 'jsonb').map((c) => `${c.table_name}.${c.column_name}`),
    );

    await client.query('begin');
    await client.query('set local session_replication_role = replica');

    for (const [table, rows] of entries) {
      await insertRows(client, table, rows, jsonb);
    }

    await checkForeignKeys(client);
    await checkLedgerBalance(client);
    // Coverage is measured over every application table, including the ones the migrations seed themselves.
    const allTables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE' order by 1`,
    );
    const counts = await countRows(
      client,
      allTables.rows.map((r) => r.table_name),
    );
    reportCounts(counts);

    await client.query('commit');
    console.log(
      `Seeded ${entries.length} tables with synthetic flow data into ${new URL(url).pathname.slice(1)}.`,
    );
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Builds one multi-row INSERT per chunk. Keys missing from a row become DEFAULT, so each row keeps its own defaults. */
async function insertRows(client: pg.Client, table: string, rows: Row[], jsonb: Set<string>): Promise<void> {
  if (rows.length === 0) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const target = `app.${quote(table)}`;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const valueSql = chunk.map((row) => {
      const cells = cols.map((col) => {
        if (!(col in row) || row[col] === undefined) return 'DEFAULT';
        let value = row[col];
        if (
          value !== null &&
          typeof value === 'object' &&
          !Buffer.isBuffer(value) &&
          !(value instanceof Date)
        ) {
          if (jsonb.has(`${table}.${col}`) || !Array.isArray(value)) value = JSON.stringify(value);
        }
        params.push(value);
        return `$${params.length}`;
      });
      return `(${cells.join(', ')})`;
    });
    try {
      await client.query(
        `insert into ${target} (${cols.map(quote).join(', ')}) values ${valueSql.join(', ')}`,
        params,
      );
    } catch (error) {
      throw new Error(`insert into ${table} failed: ${(error as Error).message}`);
    }
  }
}

/** Every foreign key in the app schema must have no orphan rows (MATCH SIMPLE: a NULL column is not checked). */
async function checkForeignKeys(client: pg.Client): Promise<void> {
  const fks = await client.query<{
    child: string;
    parent: string;
    child_cols: string[];
    parent_cols: string[];
    name: string;
  }>(`
    select c.relname as child, p.relname as parent, con.conname as name,
      array(select a.attname::text from unnest(con.conkey) with ordinality as u(attnum, pos) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum order by u.pos) as child_cols,
      array(select a.attname::text from unnest(con.confkey) with ordinality as u(attnum, pos) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.attnum order by u.pos) as parent_cols
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class p on p.oid = con.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f' and n.nspname = 'app'`);
  const problems: string[] = [];
  for (const fk of fks.rows) {
    const notNull = fk.child_cols.map((c) => `c.${quote(c)} is not null`).join(' and ');
    const match = fk.child_cols
      .map((c, i) => `p.${quote(ix(fk.parent_cols, i))} = c.${quote(c)}`)
      .join(' and ');
    const sql = `select count(*)::int as n from app.${quote(fk.child)} c where ${notNull}
      and not exists (select 1 from app.${quote(fk.parent)} p where ${match})`;
    const { rows } = await client.query<{ n: number }>(sql);
    const orphans = rows[0]?.n ?? 0;
    if (orphans > 0)
      problems.push(
        `${fk.child}.${fk.child_cols.join(',')} -> ${fk.parent}: ${orphans} orphan row(s) [${fk.name}]`,
      );
  }
  if (problems.length > 0) throw new Error(`Foreign key check failed:\n  ${problems.join('\n  ')}`);
  console.log(`foreign keys checked: ${fks.rows.length}, orphans: 0`);
}

/** The deferred balance trigger is skipped in replica mode, so debit and credit totals are compared here. */
async function checkLedgerBalance(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ journal_id: string; variance: string }>(`
    select journal_id, sum(case when entry_type = 'DEBIT' then amount else -amount end)::text as variance
    from app.ledger_journal_line group by journal_id having sum(case when entry_type = 'DEBIT' then amount else -amount end) <> 0`);
  if (rows.length > 0)
    throw new Error(`Unbalanced journals: ${rows.map((r) => `${r.journal_id} (${r.variance})`).join(', ')}`);
  console.log('ledger journals balanced');
}

async function countRows(client: pg.Client, tables: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from app.${quote(table)}`);
    counts.set(table, rows[0]?.n ?? 0);
  }
  return counts;
}

function reportCounts(counts: Map<string, number>): void {
  const short = [...counts.entries()].filter(([, n]) => n < MIN_ROWS);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`tables: ${counts.size}, rows: ${total}`);
  if (short.length > 0) {
    console.log(
      `tables under ${MIN_ROWS} rows (global catalogue limits, see the seed README): ${short.map(([t, n]) => `${t}=${n}`).join(', ')}`,
    );
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
