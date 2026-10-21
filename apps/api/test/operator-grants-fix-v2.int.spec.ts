// Rehearsal of the prepared v2 correction for the six platform operator permissions held by two customer-tenant roles on hosted
// (audit F-09, tools/sql/fixes/remove-operator-grants-from-customer-roles.v2.sql). Throwaway PostgreSQL only; never touches hosted.
// Proves: it removes exactly the twelve rows and nothing else, leaves the platform tenant's own grants alone, can be run again (no-op),
// refuses a third role or a partial set, and the restore script puts the twelve back (and can be run again).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';
import { readdirSync } from 'node:fs';

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.DSA_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const FIX = readFileSync(
  path.join(ROOT, 'tools/sql/fixes/remove-operator-grants-from-customer-roles.v2.sql'),
  'utf8',
);
const RESTORE = readFileSync(
  path.join(ROOT, 'tools/sql/fixes/remove-operator-grants-from-customer-roles.v2.restore.sql'),
  'utf8',
);
const ROLE_ALPHA = 'role_01M4SXZCV20465ZCBDMYGM2410';
const ROLE_QLOAX = 'role_01M595WG8J9KP9MCH8Q31C69M3';
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
let db: pg.Client;
let tenantA = '';
let tenantB = '';

const n = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].n as number;
const customerOperatorGrants = () =>
  n(
    `SELECT count(*)::int AS n FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id
      WHERE t.tenant_type <> 'PLATFORM' AND rp.permission_code = ANY($1)`,
    [SIX],
  );
const platformOperatorGrants = () =>
  n(
    `SELECT count(*)::int AS n FROM app.role_permission rp JOIN app.tenant t ON t.id = rp.tenant_id
      WHERE t.tenant_type = 'PLATFORM' AND rp.permission_code = ANY($1)`,
    [SIX],
  );
const grant = (tenant: string, role: string, code: string) =>
  db.query(
    `INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenant, role, code],
  );
const run = async (script: string) => {
  try {
    await db.query(script);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
};

beforeAll(async () => {
  container = await startPostgres();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query('CREATE DATABASE og2');
  const url = new URL(container.getConnectionUri());
  url.pathname = '/og2';
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  for (const f of readdirSync(DIR)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.query(readFileSync(path.join(DIR, f), 'utf8'));

  // two customer tenants, each with a tenant admin role carrying the reviewed hosted role id
  tenantA = 'ten_0000000000000000000000OGA1';
  tenantB = 'ten_0000000000000000000000OGB1';
  for (const [id, slug] of [
    [tenantA, 'og-a'],
    [tenantB, 'og-b'],
  ] as const)
    await db.query(
      `INSERT INTO app.tenant (id, slug, legal_name, tenant_type, created_by) VALUES ($1, $2, 'Rehearsal', 'DSA_ORG', 'rehearsal')`,
      [id, slug],
    );
  await db.query(
    `INSERT INTO app.role (id, tenant_id, code, name, created_by) VALUES
       ($1, $2, 'ROLE-TENANT-ADMIN', 'Tenant administrator', 'rehearsal'), ($3, $4, 'ROLE-TENANT-ADMIN', 'Tenant administrator', 'rehearsal'),
       ('role_og_other', $2, 'ROLE-OTHER', 'Other', 'rehearsal')`,
    [ROLE_ALPHA, tenantA, ROLE_QLOAX, tenantB],
  );
}, 300_000);

afterAll(async () => {
  await db?.end();
  await admin?.end();
  await container?.stop();
});

const seedStrays = async () => {
  for (const code of SIX) {
    await grant(tenantA, ROLE_ALPHA, code);
    await grant(tenantB, ROLE_QLOAX, code);
  }
  await grant(tenantA, ROLE_ALPHA, 'config.manage');
  await grant(tenantB, ROLE_QLOAX, 'config.manage');
};

describe('the prepared v2 correction of the operator grants (audit F-09)', () => {
  it('TEST-OPGRANT2-01 it removes exactly the twelve stray rows, keeps every other grant and the platform tenant’s own, and can be run again', async () => {
    await seedStrays();
    const platformBefore = await platformOperatorGrants();
    const othersBefore = await n(
      `SELECT count(*)::int AS n FROM app.role_permission WHERE NOT (permission_code = ANY($1))`,
      [SIX],
    );
    expect(platformBefore).toBeGreaterThan(0);
    expect(await customerOperatorGrants()).toBe(12);

    await run(FIX);
    expect(await customerOperatorGrants()).toBe(0);
    expect(await platformOperatorGrants()).toBe(platformBefore);
    expect(
      await n(`SELECT count(*)::int AS n FROM app.role_permission WHERE NOT (permission_code = ANY($1))`, [
        SIX,
      ]),
    ).toBe(othersBefore);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM app.role_permission WHERE role_id = $1 AND permission_code = 'config.manage'`,
        [ROLE_QLOAX],
      ),
    ).toBe(1);

    await run(FIX); // repeatable: nothing left, nothing to do, no error
    expect(await customerOperatorGrants()).toBe(0);
  });

  it('TEST-OPGRANT2-02 the restore script puts the twelve back, only on the two reviewed roles, and can be run again', async () => {
    await run(RESTORE);
    expect(await customerOperatorGrants()).toBe(12);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM app.role_permission WHERE role_id = 'role_og_other' AND permission_code = ANY($1)`,
        [SIX],
      ),
    ).toBe(0);
    await run(RESTORE);
    expect(await customerOperatorGrants()).toBe(12);
  });

  it('TEST-OPGRANT2-03 it refuses, deleting nothing, when a role that was not reviewed holds one of the six', async () => {
    await grant(tenantA, 'role_og_other', 'platform.console');
    expect(await customerOperatorGrants()).toBe(13);
    await expect(run(FIX)).rejects.toThrow(/not reviewed/);
    expect(await customerOperatorGrants()).toBe(13);
    await db.query(`DELETE FROM app.role_permission WHERE role_id = 'role_og_other'`);
  });

  it('TEST-OPGRANT2-04 it refuses, deleting nothing, when a reviewed role holds only some of the six', async () => {
    await db.query(
      `DELETE FROM app.role_permission WHERE role_id = $1 AND permission_code = 'platform.jobs'`,
      [ROLE_QLOAX],
    );
    expect(await customerOperatorGrants()).toBe(11);
    await expect(run(FIX)).rejects.toThrow(/expected none or all six/);
    expect(await customerOperatorGrants()).toBe(11);
  });
});
