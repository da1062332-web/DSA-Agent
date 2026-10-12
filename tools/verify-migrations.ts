// Runs the Migration Plan §8 verification queries (REL-001 and the CI `migrate` job) after `supabase db reset`.
// Connects as the local Supabase owner role because it inspects catalogs; this is a tool, never the API runtime.
// Checks (a), (b), (c), (e) must return zero rows. Check (d) runs as dsa_app with no tenant set and must
// see 0 rows (fail-closed RLS).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.VERIFY_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sqlFile = path.resolve(import.meta.dirname, 'sql', 'verify-migrations.sql');

// Split the file into its "-- (x) …" sections.
const sections = readFileSync(sqlFile, 'utf8')
  .split(/^(?=-- \([a-z]\))/m)
  .map((s) => s.trim())
  .filter((s) => s.startsWith('-- ('))
  .map((s) => ({ id: s.slice(4, 5), title: s.split('\n')[0]!.replace(/^-- /, ''), sql: s }));

const client = new pg.Client({ connectionString: url });
await client.connect();
let failed = 0;
try {
  for (const section of sections) {
    let rows: Record<string, unknown>[];
    if (section.id === 'd') {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE dsa_app');
        await client.query('SET LOCAL search_path = app, extensions');
        rows = (await client.query(section.sql)).rows.filter((r) => Number(r.visible_without_tenant) !== 0);
      } finally {
        await client.query('ROLLBACK');
      }
    } else {
      rows = (await client.query(section.sql)).rows;
    }
    const ok = rows.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${section.title}`);
    if (!ok) console.log(rows);
  }
} finally {
  await client.end();
}
if (sections.length === 0) throw new Error(`no checks found in ${sqlFile}`);
process.exit(failed === 0 ? 0 : 1);
