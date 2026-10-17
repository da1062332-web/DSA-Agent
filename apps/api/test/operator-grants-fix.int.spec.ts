// Rehearsal of the prepared fix for the six operator permissions found on a customer-tenant role on hosted (owner: Dev 1).
// Builds a database that has migration 0050's guarantee, re-creates the stray rows, and proves: the 0050 verification fails (check 16),
// the fix removes exactly those rows and nothing else, the check passes again, the fix refuses anything it was not shown, and the
// restore script puts back the same six rows. Never touches hosted.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const sql = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const FIX = 'tools/sql/fixes/remove-operator-grants-from-customer-roles.sql';
const RESTORE = 'tools/sql/fixes/remove-operator-grants-from-customer-roles.restore.sql';
const ROLE = 'role_01M4SXZCV20465ZCBDMYGM2410';
const SIX = [
  'platform.console',
  'platform.flags',
  'platform.master_data',
  'platform.jobs',
  'platform.support_access',
  'platform.release',
];

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

/** A fresh copy that looks like hosted after 0050: demo-alpha's tenant admin role has the id seen on hosted, with the six strays added. */
async function strayCopy(): Promise<pg.Client> {
  const name = `og_${seq++}`;
  await admin.query(`CREATE DATABASE ${name} TEMPLATE og_base`);
  const db = await connectTo(name);
  const tenant = (await db.query(`SELECT id FROM app.tenant WHERE slug = 'demo-alpha'`)).rows[0].id as string;
  await db
    .query(`UPDATE app.role SET id = '${ROLE}' WHERE tenant_id = $1 AND code = 'ROLE-TENANT-ADMIN'`, [tenant])
    .catch(() => undefined);
  const role = (
    await db.query(`SELECT id FROM app.role WHERE tenant_id = $1 AND code = 'ROLE-TENANT-ADMIN'`, [tenant])
  ).rows[0].id as string;
  return Object.assign(db, { tenant, role });
}

const check16 = async (db: pg.Client) => {
  const text = sql('tools/sql/0050/verify.sql');
  const rows = (await db.query(text)).rows as { name: string; result: string; actual: string }[];
  return rows.find((r) => r.name.startsWith('ZERO operator permissions'))!;
};

beforeAll(async () => {
  container = await startPostgres();
  admin = await connectTo('postgres');
  await admin.query('CREATE DATABASE og_base');
  const base = await connectTo('og_base');
  const fixture = (name: string) => readFileSync(path.join(ROOT, 'tests/guard/fixtures', name), 'utf8');
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

describe('removing operator permissions from a customer-tenant role', () => {
  it('TEST-OPGRANT-01 the 0050 check passes on a clean build, fails with the six strays, and passes again after the fix, which removes only those six', async () => {
    const db = (await strayCopy()) as pg.Client & { tenant: string; role: string };
    try {
      expect((await check16(db)).result).toBe('PASS');
      for (const code of SIX)
        await db.query(
          `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, $3)`,
          [db.tenant, db.role, code],
        );
      const failing = await check16(db);
      expect([failing.result, failing.actual]).toEqual(['FAIL', '6']);

      const others = (
        await db.query(
          `SELECT count(*)::int AS n FROM app.role_permission WHERE permission_code <> ALL($1)`,
          [SIX],
        )
      ).rows[0].n as number;
      await db.query(sql(FIX));
      expect((await check16(db)).result).toBe('PASS');
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM app.role_permission WHERE permission_code <> ALL($1)`,
            [SIX],
          )
        ).rows[0].n,
      ).toBe(others);
      // the platform tenant's own operator grants are untouched
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id WHERE t.tenant_type = 'PLATFORM' AND rp.permission_code = ANY($1)`,
            [SIX],
          )
        ).rows[0].n,
      ).toBeGreaterThan(0);
    } finally {
      await db.end();
    }
  });

  it('TEST-OPGRANT-02 the fix refuses (and deletes nothing) when it finds more or fewer than the six it was shown', async () => {
    const db = (await strayCopy()) as pg.Client & { tenant: string; role: string };
    try {
      for (const code of SIX.slice(0, 5))
        await db.query(
          `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, $3)`,
          [db.tenant, db.role, code],
        );
      await expect(db.query(sql(FIX))).rejects.toThrow(/expected exactly 6/);
      await db.query('ROLLBACK').catch(() => undefined);
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM app.role_permission rp WHERE rp.role_id = $1 AND rp.permission_code = ANY($2)`,
            [db.role, SIX],
          )
        ).rows[0].n,
      ).toBe(5);

      // six rows, but on another role than the reviewed one: also refused
      await db.query(`DELETE FROM app.role_permission WHERE role_id = $1 AND permission_code = ANY($2)`, [
        db.role,
        SIX,
      ]);
      const other = (
        await db.query(
          `SELECT id FROM app.role WHERE tenant_id = $1 AND code <> 'ROLE-TENANT-ADMIN' LIMIT 1`,
          [db.tenant],
        )
      ).rows[0].id as string;
      for (const code of SIX)
        await db.query(
          `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, $3)`,
          [db.tenant, other, code],
        );
      await expect(db.query(sql(FIX))).rejects.toThrow(
        /other than the one that was reviewed|expected exactly 6/,
      );
    } finally {
      await db.end();
    }
  });

  it('TEST-OPGRANT-03 the restore script puts back the same six rows, once', async () => {
    const db = (await strayCopy()) as pg.Client & { tenant: string; role: string };
    try {
      await db.query(sql(RESTORE));
      await db.query(sql(RESTORE));
      const rows = (
        await db.query(
          `SELECT permission_code FROM app.role_permission WHERE role_id = $1 AND permission_code = ANY($2) ORDER BY 1`,
          [db.role, SIX],
        )
      ).rows.map((r) => r.permission_code);
      expect(rows).toEqual([...SIX].sort());
    } finally {
      await db.end();
    }
  });
});
