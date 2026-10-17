// The hosted migration batch, rehearsed (owner: Dev 1). Hosted has every migration except the pending set below. This builds that
// state on a throwaway PostgreSQL, then proves: the proposed order applies cleanly, each pending migration's prerequisites are what
// the plan says (applied alone on the hosted-like state, it succeeds or fails exactly as declared), and a wrong order is caught.
// It never touches hosted. Run on PostgreSQL 16 and 17 (DSA_PG_IMAGE).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../supabase/migrations');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const byPrefix = (n: string) => {
  const f = files.find((x) => x.startsWith(`202610010000${n}_`));
  if (!f) throw new Error(`no migration ${n}`);
  return f;
};

/** Not applied on hosted (see docs/MIGRATION_MATRIX.md). 0056 is the Release 3 ledger and is not in the batch. */
const PENDING = ['54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65'];
const BATCH_ORDER = ['54', '57', '59', '60', '61', '58', '55', '63', '64', '65'];

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let seq = 0;

async function connectTo(database: string): Promise<pg.Client> {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return c;
}

/** A fresh database in the hosted-like state, applying `order` (migration numbers) one by one. Returns where it stopped. */
async function run(order: string[]): Promise<{ db: pg.Client; failed: string | null; error: string | null }> {
  const name = `seq_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE hosted_like`);
  const db = await connectTo(name);
  for (const n of order) {
    try {
      await db.query(readFileSync(path.join(DIR, byPrefix(n.padStart(2, '0'))), 'utf8'));
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      return { db, failed: n, error: (e as Error).message };
    }
  }
  return { db, failed: null, error: null };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(process.env.DSA_PG_IMAGE ?? 'postgres:16').start();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE hosted_like');
  const base = await connectTo('hosted_like');
  const pendingFiles = new Set(PENDING.map((n) => byPrefix(n.padStart(2, '0'))));
  // As on hosted: the test tenants and their roles existed before the later migrations ran (early fixtures), and the grants hosted
  // holds for permissions that exist in this build are loaded last (late fixtures). Both come from tests/guard/fixtures.
  const fixture = (name: string) =>
    readFileSync(path.resolve(__dirname, '../../../tests/guard/fixtures', name), 'utf8');
  for (const f of files.filter((x) => !pendingFiles.has(x))) {
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

describe('hosted migration batch', () => {
  it('TEST-SEQ-01 the proposed order applies cleanly on the hosted-like state, and the objects the plan promises exist', async () => {
    const r = await run(BATCH_ORDER);
    expect(r.error, `stopped at ${r.failed}`).toBeNull();
    const has = async (sql: string) => (await r.db.query(sql)).rows[0].ok as boolean;
    expect(await has(`SELECT to_regclass('app.api_client') IS NOT NULL AS ok`)).toBe(true);
    expect(await has(`SELECT to_regclass('app.platform_release') IS NOT NULL AS ok`)).toBe(true);
    expect(await has(`SELECT to_regclass('app.security_event') IS NOT NULL AS ok`)).toBe(true);
    expect(await has(`SELECT to_regclass('app.ledger_account') IS NULL AS ok`)).toBe(true); // Release 3: not in the batch
    const perms = await r.db.query(
      `SELECT count(*)::int AS n FROM app.permission WHERE code IN ('role.manage','security.incident','security.vuln','lead.reopen','lender.read','lender.manage','product.read','product.manage','commission.calculate','commission.plan.edit','commission.plan.approve','customer.reveal_sensitive')`,
    );
    expect(perms.rows[0].n).toBe(12);
    await r.db.end();
  });

  it('TEST-SEQ-02 the Release 3 ledger can be added after the batch without clashing with it', async () => {
    const r = await run([...BATCH_ORDER, '56']);
    expect(r.error, `stopped at ${r.failed}`).toBeNull();
    expect(
      (await r.db.query(`SELECT to_regclass('app.ledger_journal_line') IS NOT NULL AS ok`)).rows[0].ok,
    ).toBe(true);
    // The invoices connector statement table (renamed from ledger_entry, see 0065) keeps its shape.
    expect(
      (
        await r.db.query(
          `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='app' AND table_name='connector_statement_entry' AND column_name='connector_id'`,
        )
      ).rows[0].n,
    ).toBe(1);
    await r.db.end();
  });

  it('TEST-SEQ-03 the order is a risk choice, not a technical one: other orders also apply and end in exactly the same database', async () => {
    // The structure, policies, triggers, permissions and grants after a run, reduced to one hash.
    const fingerprint = async (db: pg.Client) =>
      (
        await db.query(`
          SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
            SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app'
            UNION ALL SELECT 'pol:' || tablename || '.' || policyname || ':' || coalesce(qual, '') || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'app'
            UNION ALL SELECT 'trg:' || tgrelid::regclass || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal
            UNION ALL SELECT 'perm:' || code FROM app.permission
            UNION ALL SELECT 'grant:' || r.code || ':' || rp.permission_code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
            UNION ALL SELECT 'flag:' || key || ':' || scope FROM app.feature_flag
            UNION ALL SELECT 'fn:' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
          ) t`)
      ).rows[0].h as string;

    const reference = await run(BATCH_ORDER);
    const customerRoles = await reference.db.query(
      `SELECT count(*)::int AS n FROM app.role WHERE code = 'ROLE-TENANT-ADMIN'`,
    );
    expect(
      customerRoles.rows[0].n,
      'the hosted-like state has customer tenants whose grants the fingerprint covers',
    ).toBeGreaterThan(0);
    expect(reference.error, `stopped at ${reference.failed}`).toBeNull();
    const expected = await fingerprint(reference.db);
    await reference.db.end();

    const orders = [
      [...BATCH_ORDER].reverse(),
      [...BATCH_ORDER].sort(), // numeric-name order
      ['65', '64', '55', '54', '63', '58', '61', '60', '59', '57'],
      ['63', '55', '61', '64', '65', '57', '54', '59', '58', '60'],
    ];
    for (const order of orders) {
      const r = await run(order);
      try {
        expect(r.error, `order ${order.join(',')} stopped at ${r.failed}`).toBeNull();
        expect(await fingerprint(r.db), `order ${order.join(',')}`).toBe(expected);
      } finally {
        await r.db.end();
      }
    }
  });

  it('TEST-SEQ-04 the batch can be applied in two halves (the plan lets you stop after 0061)', async () => {
    const first = await run(['54', '57', '59', '60', '61']);
    expect(first.error, `stopped at ${first.failed}`).toBeNull();
    for (const n of ['58', '55', '63', '64', '65'])
      await first.db.query(readFileSync(path.join(DIR, byPrefix(n.padStart(2, '0'))), 'utf8'));
    await first.db.end();
  });
});
