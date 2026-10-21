// Rehearsal of the audit migration batch (tools/sql/audit-batch: 0066, 0069 to 0084). Owner: Dev 1.
// On a hosted-like database (every migration up to 0068 except 0066, plus the hosted fixtures): the preflight is read-only and
// says what is pending; for each migration, verify passes after apply, rollback restores the database exactly and verify then
// notices; rollbacks refuse to lose data. Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.join(ROOT, 'supabase/migrations');
const SQL = path.join(ROOT, 'tools/sql/audit-batch');
const ORDER = [
  '66',
  '69',
  '70',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '78',
  '79',
  '80',
  '81',
  '82',
  '83',
  '84',
];
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migration = (n: string) => files.find((f) => f.startsWith(`202610010000${n}_`))!;
const script = (name: string) => readFileSync(path.join(SQL, name), 'utf8');

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

/** A fresh hosted-like database with the listed batch migrations applied on top. */
async function fresh(apply: string[] = []): Promise<pg.Client> {
  const name = `ab_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE hosted_like`);
  const db = await connectTo(name);
  for (const n of apply) await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
  return db;
}
const before = (n: string) => ORDER.slice(0, ORDER.indexOf(n));

const fingerprint = async (db: pg.Client) => {
  await db.query('RESET search_path');
  return (
    await db.query(`
      SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
        SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app'
        UNION ALL SELECT 'pol:' || tablename || '.' || policyname FROM pg_policies WHERE schemaname = 'app'
        UNION ALL SELECT 'trg:' || tgrelid::regclass || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal
        UNION ALL SELECT 'con:' || conrelid::regclass || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'app'::regnamespace
        UNION ALL SELECT 'idx:' || indexrelid::regclass FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'app'::regnamespace
        UNION ALL SELECT 'perm:' || code FROM app.permission
        UNION ALL SELECT 'grant:' || r.code || ':' || rp.permission_code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
        UNION ALL SELECT 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace AND p.prokind = 'f'
        UNION ALL SELECT 'colpriv:' || table_name || '.' || column_name || ':' || privilege_type FROM information_schema.column_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
        UNION ALL SELECT 'tblpriv:' || table_name || ':' || privilege_type FROM information_schema.table_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
      ) t`)
  ).rows[0].h as string;
};

const results = async (db: pg.Client, name: string) =>
  (await db.query(script(name))).rows as { check: string; result: string }[];
const preflight = async (db: pg.Client) =>
  (await db.query(script('preflight.sql'))).rows as { item: string; result: string }[];

beforeAll(async () => {
  container = await startPostgres();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE hosted_like');
  const base = await connectTo('hosted_like');
  const pending = new Set(ORDER.map(migration));
  const fixture = (name: string) => readFileSync(path.join(ROOT, 'tests/guard/fixtures', name), 'utf8');
  for (const f of files.filter((x) => !pending.has(x))) {
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

describe('audit batch: preflight, verify and rollback scripts', () => {
  it('TEST-ABATCH-00 preflight is read-only, every prerequisite passes, everything is pending; after the batch nothing is', async () => {
    const { pendingFrom } = (await import(pathToFileURL(path.join(SQL, 'pending.mjs')).href)) as {
      pendingFrom: (rows: { item: string; result: string }[]) => string[];
    };
    const db = await fresh();
    const fp = await fingerprint(db);
    const rows = await preflight(db);
    expect(rows.filter((r) => r.item.startsWith('prerequisite')).every((r) => r.result === 'PASS')).toBe(
      true,
    );
    expect(pendingFrom(rows)).toEqual(ORDER);
    expect(await fingerprint(db)).toBe(fp);
    for (const n of ORDER) await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
    expect(pendingFrom(await preflight(db))).toEqual([]);
    await db.end();
  });

  for (const n of ORDER) {
    it(`TEST-ABATCH-${n} migration 00${n}: verify passes after apply, rollback restores the database exactly, verify then notices`, async () => {
      const db = await fresh(before(n));
      const fp = await fingerprint(db);
      await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
      expect(await fingerprint(db), 'applying changed something').not.toBe(fp);
      const after = await results(db, `${n}.verify.sql`);
      expect(after.length).toBeGreaterThan(0);
      expect(
        after.filter((r) => r.result !== 'PASS'),
        'verify after apply',
      ).toEqual([]);

      await db.query(script(`${n}.rollback.sql`));
      expect(await fingerprint(db), `rollback of ${n} did not restore the original state`).toBe(fp);
      expect(
        (await results(db, `${n}.verify.sql`)).some((r) => r.result === 'FAIL'),
        'verify must notice the rollback',
      ).toBe(true);
      // Running the rollback again does nothing and does not fail.
      await db.query(script(`${n}.rollback.sql`));
      expect(await fingerprint(db)).toBe(fp);
      await db.end();
    });
  }

  it('TEST-ABATCH-GUARD rollbacks refuse to lose data: a document type, tenant entitlements, a merged customer', async () => {
    // A customer tenant that has a branch (some hosted-like fixture tenants have none).
    const site = async (db: pg.Client) =>
      (
        await db.query(
          `SELECT b.tenant_id, b.id AS branch_id FROM app.branch b WHERE b.tenant_id <> 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG' ORDER BY b.id LIMIT 1`,
        )
      ).rows[0] as { tenant_id: string; branch_id: string };
    const tenant = async (db: pg.Client) => (await site(db)).tenant_id;

    const docs = await fresh(before('71').concat('71'));
    await docs.query(
      `INSERT INTO app.document_type (id, tenant_id, code, name, category, sensitivity, created_by, updated_by)
       VALUES ('dtp_guard', $1, 'GUARD_DOC', 'Guard', 'OTHER', 'S2', 'test', 'test')`,
      [await tenant(docs)],
    );
    await expect(docs.query(script('71.rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await docs.query('ROLLBACK').catch(() => undefined);
    expect((await docs.query(`SELECT to_regclass('app.document_type') IS NOT NULL AS ok`)).rows[0].ok).toBe(
      true,
    );
    await docs.end();

    const ten = await fresh(before('83').concat('83'));
    await ten.query(
      `UPDATE app.tenant SET entitlements = '{"MOD-WFA": false}', entitlements_version = 1 WHERE id = $1`,
      [await tenant(ten)],
    );
    await expect(ten.query(script('83.rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await ten.query('ROLLBACK').catch(() => undefined);
    await ten.end();

    const cust = await fresh(before('75').concat('75'));
    const { tenant_id: t, branch_id: branch } = await site(cust);
    await cust.query(
      `INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       VALUES ('cust_g1', $1, 'INDIVIDUAL', 'Guard One', $2, 'test', 'test'), ('cust_g2', $1, 'INDIVIDUAL', 'Guard Two', $2, 'test', 'test')`,
      [t, branch],
    );
    await cust.query(
      `UPDATE app.customer SET status = 'MERGED', merged_into_id = 'cust_g2' WHERE id = 'cust_g1'`,
    );
    await expect(cust.query(script('75.rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await cust.query('ROLLBACK').catch(() => undefined);
    await cust.end();
  });
});
