// Rehearsal of the verify and rollback scripts for the hosted migration batch (tools/sql/batch). Owner: Dev 1.
// For each migration on a hosted-like state: apply it, every verify row passes; roll it back, the database is exactly as before and
// verify now shows what is gone; the rollback guards refuse when real data would be lost. Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const SQL = path.join(ROOT, 'tools/sql/batch');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migration = (n: string) => files.find((f) => f.startsWith(`202610010000${n}_`))!;
const script = (name: string) => readFileSync(path.join(SQL, name), 'utf8');
const PENDING = ['54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65'];

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

/** A fresh hosted-like database; `apply` lists the pending migrations to put on top first. */
async function fresh(apply: string[] = []): Promise<pg.Client> {
  const name = `rb_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE hosted_like`);
  const db = await connectTo(name);
  for (const n of apply) await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
  return db;
}

const fingerprint = async (db: pg.Client) => {
  await db.query('RESET search_path'); // migrations set it for the session, and ::regclass prints names relative to it
  return (
    await db.query(`
      SELECT md5(string_agg(x, '|' ORDER BY x)) AS h FROM (
        SELECT 'col:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns WHERE table_schema = 'app'
        UNION ALL SELECT 'pol:' || tablename || '.' || policyname FROM pg_policies WHERE schemaname = 'app'
        UNION ALL SELECT 'trg:' || tgrelid::regclass || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal
        UNION ALL SELECT 'con:' || conrelid::regclass || '.' || conname FROM pg_constraint WHERE connamespace = 'app'::regnamespace
        UNION ALL SELECT 'perm:' || code FROM app.permission
        UNION ALL SELECT 'grant:' || r.code || ':' || rp.permission_code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
        UNION ALL SELECT 'flag:' || key || ':' || scope FROM app.feature_flag
        UNION ALL SELECT 'rs:' || id || ':' || status FROM app.rule_set
        UNION ALL SELECT 'rsv:' || id || ':' || status FROM app.rule_set_version
        UNION ALL SELECT 'fn:' || p.proname FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace
        UNION ALL SELECT 'colpriv:' || table_name || '.' || column_name || ':' || privilege_type FROM information_schema.column_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
        UNION ALL SELECT 'tblpriv:' || table_name || ':' || privilege_type FROM information_schema.table_privileges WHERE table_schema = 'app' AND grantee = 'dsa_app'
      ) t`)
  ).rows[0].h as string;
};

const results = async (db: pg.Client, name: string) =>
  (await db.query(script(name))).rows as { check: string; result: string }[];

beforeAll(async () => {
  container = await startPostgres();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE hosted_like');
  const base = await connectTo('hosted_like');
  const pending = new Set(PENDING.map(migration));
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

describe('hosted batch: verify and rollback scripts', () => {
  it('TEST-BATCH-01 preflight is read-only, passes every prerequisite on the hosted-like state, and reports nothing applied', async () => {
    const db = await fresh();
    const before = await fingerprint(db);
    const rows = (await db.query(script('preflight.sql'))).rows as { item: string; result: string }[];
    expect(rows.filter((r) => r.item.startsWith('prerequisite')).map((r) => r.result)).toEqual(
      Array(6).fill('PASS'),
    );
    expect(rows.filter((r) => r.item.includes('already applied')).map((r) => r.result)).toEqual(
      Array(10).fill('NO'),
    );
    expect(await fingerprint(db)).toBe(before);
    await db.end();
  });

  for (const n of ['57', '58', '59', '60', '61', '62', '63', '55', '64']) {
    it(`TEST-BATCH-${n} migration 00${n}: verify passes after apply, rollback restores the database exactly, verify then shows the removal`, async () => {
      const db = await fresh();
      const before = await fingerprint(db);
      await db.query(readFileSync(path.join(DIR, migration(n)), 'utf8'));
      expect(await fingerprint(db), 'applying changed something').not.toBe(before);

      const after = await results(db, `${n}.verify.sql`);
      expect(after.length).toBeGreaterThan(0);
      expect(
        after.filter((r) => r.result !== 'PASS'),
        `verify after apply`,
      ).toEqual([]);

      await db.query(script(`${n}.rollback.sql`));
      if (n === '64') {
        // Owner and tenant admin keep their grants (indistinguishable from hosted's own); only branch manager and loan operations lose them.
        const left = await db.query(
          `SELECT count(*)::int AS n FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
            WHERE r.code IN ('ROLE-BRANCH-MGR','ROLE-LOAN-OPS') AND rp.permission_code IN ('sanction.record','disbursement.record','disbursement.verify','disbursement.exception_approve')`,
        );
        expect(left.rows[0].n).toBe(0);
      } else if (n === '55') {
        // Rule versions are append-only, so rollback retires them instead of deleting: the state differs only by those statuses.
        const active = await db.query(
          `SELECT count(*)::int AS n FROM app.rule_set_version WHERE id LIKE 'rsv_elg_%' AND status = 'ACTIVE'`,
        );
        const grants = await db.query(
          `SELECT count(*)::int AS n FROM app.role_permission WHERE permission_code = 'eligibility.override'`,
        );
        expect([active.rows[0].n, grants.rows[0].n]).toEqual([0, 0]);
      } else {
        expect(await fingerprint(db), `rollback of ${n} did not restore the original state`).toBe(before);
      }
      expect(
        (await results(db, `${n}.verify.sql`)).some((r) => r.result === 'FAIL'),
        'verify must notice the rollback',
      ).toBe(true);
      await db.end();
    });
  }

  it('TEST-BATCH-55c eligibility.override (decision D1) goes to exactly the four approver roles, in every tenant, and to no other role', async () => {
    const db = await fresh(['55']);
    const holders = await db.query(
      `SELECT DISTINCT r.code FROM app.role_permission rp JOIN app.role r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
        WHERE rp.permission_code = 'eligibility.override' ORDER BY 1`,
    );
    expect(holders.rows.map((r) => r.code)).toEqual([
      'ROLE-BRANCH-MGR',
      'ROLE-LOAN-OPS',
      'ROLE-ORG-OWNER',
      'ROLE-TENANT-ADMIN',
    ]);
    const missing = await db.query(
      `SELECT count(*)::int AS n FROM app.role r WHERE r.code IN ('ROLE-ORG-OWNER','ROLE-BRANCH-MGR','ROLE-LOAN-OPS','ROLE-TENANT-ADMIN')
          AND NOT EXISTS (SELECT 1 FROM app.role_permission rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_code = 'eligibility.override')`,
    );
    expect(missing.rows[0].n).toBe(0);
    await db.end();
  });

  it('TEST-BATCH-55b the optional revoke script removes only the override grants and keeps the rules', async () => {
    const db = await fresh(['55']);
    await db.query(script('55.revoke-override-grants.sql'));
    const rows = await results(db, '55.verify.sql');
    expect(rows.filter((r) => r.result === 'FAIL').map((r) => r.check)).toEqual([
      expect.stringContaining('eligibility.override is held by the four approver roles'),
    ]);
    await db.end();
  });

  it('TEST-BATCH-GUARD rollbacks refuse to lose data: security events, an edited release register, a touched flag, a granted permission', async () => {
    const sec = await fresh(['63']);
    const tenant = (
      await sec.query(`SELECT id FROM app.tenant WHERE id <> 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG' LIMIT 1`)
    ).rows[0].id as string;
    await sec.query(
      `INSERT INTO app.security_event (id, tenant_id, type, principal, ip, severity) VALUES ('sec_rb', $1, 'AUTH_FAILURE', 'p', '127.0.0.1', 'LOW')`,
      [tenant],
    );
    await expect(sec.query(script('63.rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await sec.query('ROLLBACK').catch(() => undefined);
    expect((await sec.query(`SELECT to_regclass('app.security_event') IS NOT NULL AS ok`)).rows[0].ok).toBe(
      true,
    );
    await sec.end();

    const rel = await fresh(['61']);
    await rel.query(`UPDATE app.platform_release SET lock_version = 2 WHERE version = 'v0.1.0-rc.1'`);
    await expect(rel.query(script('61.rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await rel.query('ROLLBACK').catch(() => undefined);
    await rel.end();

    const flag = await fresh(['58']);
    await flag.query(
      `UPDATE app.feature_flag SET value = NOT value, updated_by = 'usr_operator', lock_version = 2 WHERE key = 'whatsapp.notifications_enabled'`,
    );
    await flag.query(script('58.rollback.sql'));
    expect(
      (
        await flag.query(
          `SELECT count(*)::int AS n FROM app.feature_flag WHERE key = 'whatsapp.notifications_enabled'`,
        )
      ).rows[0].n,
    ).toBe(1);
    await flag.end();

    const perm = await fresh(['60']);
    await perm.query(
      `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) SELECT tenant_id, id, 'lender.read' FROM app.role WHERE code = 'ROLE-TENANT-ADMIN' LIMIT 1`,
    );
    await perm.query(script('60.rollback.sql'));
    expect(
      (await perm.query(`SELECT count(*)::int AS n FROM app.permission WHERE code = 'lender.read'`)).rows[0]
        .n,
    ).toBe(1);
    expect(
      (await perm.query(`SELECT count(*)::int AS n FROM app.permission WHERE code = 'lead.reopen'`)).rows[0]
        .n,
    ).toBe(0);
    await perm.end();
  });
});
