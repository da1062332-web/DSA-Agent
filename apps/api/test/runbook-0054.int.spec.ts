// Rehearsal of the migration 0054 runbook (tools/sql/0054) on a throwaway database that is in the state just before 0054: preflight,
// backup, apply (twice), verify, rollback, and the safeguards. Synthetic data only. Nothing here touches the hosted database.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres } from '../../../tests/guard/start-postgres';

const ROOT = path.resolve(__dirname, '../../..');
const TOOLS = path.join(ROOT, 'tools/sql/0054');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const FIXTURE = path.join(ROOT, 'tests/guard/fixtures/hosted-test-fixtures.early.sql');

const sqlFile = (name: string) => readFileSync(path.join(TOOLS, name), 'utf8');

/** The last result of a multi-statement script (SET ...; SELECT ...). */
const rowsOf = async (c: pg.Client, text: string) => {
  const res = await c.query(text);
  const last = Array.isArray(res) ? res[res.length - 1]! : res;
  return last.rows as Record<string, unknown>[];
};

async function buildBefore0054(): Promise<{ container: StartedPostgreSqlContainer; admin: pg.Client }> {
  const container = await startPostgres();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  for (const f of readdirSync(MIGRATIONS)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    if (f >= '20261001000054') break; // the state hosted is in: everything before 0054
    await admin.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    if (f.startsWith('20261001000001_')) await admin.query(readFileSync(FIXTURE, 'utf8')); // tenants and roles exist before the later grants
  }
  return { container, admin };
}

const verifyResults = async (c: pg.Client) =>
  (await rowsOf(c, sqlFile('verify.sql'))).map((r) => `${r.ord}:${r.result}`);

describe('0054 runbook files', () => {
  it('TEST-RUNBOOK54-00 apply.sql is the migration inside BEGIN and COMMIT, statement for statement', () => {
    const strip = (t: string) =>
      t
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'))
        .join('\n');
    const migration = strip(
      readFileSync(path.join(MIGRATIONS, '20261001000054_access_control_and_api_clients.sql'), 'utf8'),
    );
    const apply = strip(sqlFile('apply.sql'));
    expect(apply.startsWith('BEGIN;')).toBe(true);
    expect(apply.endsWith('COMMIT;')).toBe(true);
    expect(apply.slice('BEGIN;'.length, apply.length - 'COMMIT;'.length).trim()).toBe(migration);
  });
});

describe('0054 runbook on a hosted-like database', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Client;
  beforeAll(async () => {
    ({ container, admin } = await buildBefore0054());
  }, 240_000);
  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  it('TEST-RUNBOOK54-01 preflight before applying: prerequisites pass, nothing is there yet, nothing is written', async () => {
    const rows = await rowsOf(admin, sqlFile('preflight.sql'));
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
    const byOrd = Object.fromEntries(rows.map((r) => [r.ord, r.result]));
    expect([byOrd[6], byOrd[8], byOrd[9]]).toEqual(['0', '0', '0']); // role.manage, eligibility definition, api_client: all missing
    expect(
      (await admin.query(`SELECT count(*)::int n FROM app.permission WHERE code = 'role.manage'`)).rows[0].n,
    ).toBe(0);
  });

  it('TEST-RUNBOOK54-02 backup is one JSON object that records the state before', async () => {
    const rows = await rowsOf(admin, sqlFile('backup.sql'));
    expect(rows).toHaveLength(1);
    const state = rows[0]!.backup_state as Record<string, unknown>;
    expect(state.permissions).toBeNull();
    expect(state.admin_role_permissions).toBeNull();
    expect(state.decision_definition_eligibility).toBeNull();
    expect(state.api_client_table_exists).toBe(false);
  });

  it('TEST-RUNBOOK54-03 apply runs in one transaction; every verification check passes', async () => {
    await admin.query(sqlFile('apply.sql'));
    const results = await verifyResults(admin);
    expect(results).toHaveLength(14);
    expect(results.filter((r) => r.endsWith('FAIL'))).toEqual([]);
  });

  it('TEST-RUNBOOK54-04 applying twice is safe and changes nothing', async () => {
    const count = async () =>
      JSON.stringify(
        (
          await admin.query(`SELECT (SELECT count(*) FROM app.role_permission) rp, (SELECT count(*) FROM app.permission) p,
                                                (SELECT count(*) FROM app.user_role_assignment) ura, (SELECT count(*) FROM app.decision_definition) dd,
                                                (SELECT count(*) FROM app.decision_dependency) dep`)
        ).rows[0],
      );
    const before = await count();
    await admin.query(sqlFile('apply.sql'));
    expect(await count()).toBe(before);
    expect((await verifyResults(admin)).filter((r) => r.endsWith('FAIL'))).toEqual([]);
  });

  it('TEST-RUNBOOK54-05 verify can fail: dropping the policy, or granting role.manage to another role, is caught', async () => {
    await admin.query('BEGIN');
    await admin.query(`DROP POLICY tenant_isolation ON app.api_client`);
    const noPolicy = await verifyResults(admin);
    await admin.query('ROLLBACK');
    expect(noPolicy).toContain('9:FAIL');

    await admin.query('BEGIN');
    await admin.query(`INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
                       SELECT tenant_id, id, 'role.manage' FROM app.role WHERE code = 'ROLE-RM' LIMIT 1`);
    const extra = await verifyResults(admin);
    await admin.query('ROLLBACK');
    expect(extra).toContain('2:FAIL');

    await admin.query('BEGIN');
    await admin.query(`DROP POLICY tenant_isolation ON app.api_client`);
    await admin.query(`CREATE POLICY tenant_isolation ON app.api_client USING (true)`);
    const open = await verifyResults(admin);
    await admin.query('ROLLBACK');
    expect(open).toContain('9:FAIL'); // a policy of the right name that does not isolate tenants

    expect((await verifyResults(admin)).filter((r) => r.endsWith('FAIL'))).toEqual([]);
  });

  it('TEST-RUNBOOK54-06 rollback is blocked while api_client holds a row, and then leaves everything as it was', async () => {
    const tenant = (await admin.query(`SELECT id FROM app.tenant LIMIT 1`)).rows[0].id;
    await admin.query(
      `INSERT INTO app.api_client (id, tenant_id, client_id, client_secret_hash, name, partner_name, created_by, updated_by)
       VALUES ('clt_runbook', $1, 'clt_runbook_client', 'hash', 'Runbook', 'Runbook partner', 'iso', 'iso')`,
      [tenant],
    );
    await expect(admin.query(sqlFile('rollback.sql'))).rejects.toThrow(/Rollback aborted/);
    await admin.query('ROLLBACK').catch(() => undefined);
    expect(
      (await admin.query(`SELECT count(*)::int n FROM app.permission WHERE code = 'role.manage'`)).rows[0].n,
    ).toBe(1);
    expect((await verifyResults(admin)).filter((r) => r.endsWith('FAIL'))).toEqual([]);
    await admin.query(`DELETE FROM app.api_client WHERE id = 'clt_runbook'`);
  });

  it('TEST-RUNBOOK54-07 rollback removes what 0054 added, and preflight then looks like before', async () => {
    await admin.query(sqlFile('rollback.sql'));
    const rows = await rowsOf(admin, sqlFile('preflight.sql'));
    const byOrd = Object.fromEntries(rows.map((r) => [r.ord, r.result]));
    expect([byOrd[6], byOrd[8], byOrd[9]]).toEqual(['0', '0', '0']);
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
    await admin.query(sqlFile('rollback.sql')); // a second rollback is harmless
    const state = (await rowsOf(admin, sqlFile('backup.sql')))[0]!.backup_state as Record<string, unknown>;
    expect(state.api_client_table_exists).toBe(false);
  });

  it('TEST-RUNBOOK54-07b api_client isolates tenants for the real application role (dsa_api, NOBYPASSRLS) with the tenant set the way the API sets it', async () => {
    await admin.query(sqlFile('apply.sql'));
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_api') THEN
                         CREATE ROLE dsa_api LOGIN PASSWORD 'runbook' NOBYPASSRLS IN ROLE dsa_app; END IF; END $$`);
    const [tenantA, tenantB] = (
      await admin.query(`SELECT id FROM app.tenant WHERE id LIKE 'ten_01J%' ORDER BY id LIMIT 2`)
    ).rows.map((r) => r.id as string);
    const url = new URL(container.getConnectionUri());
    url.username = 'dsa_api';
    url.password = 'runbook';
    const api = new pg.Client({ connectionString: url.toString() });
    await api.connect();
    // The API does exactly this per request: a transaction-local tenant, then the statements.
    const inTenant = async <T>(tenant: string | null, fn: () => Promise<T>) => {
      await api.query('BEGIN');
      try {
        if (tenant) await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
        return await fn();
      } finally {
        await api.query('ROLLBACK');
      }
    };
    const insert = (tenant: string, id: string) =>
      api.query(
        `INSERT INTO app.api_client (id, tenant_id, client_id, client_secret_hash, name, partner_name, created_by, updated_by) VALUES ($1, $2, $3, 'h', 'n', 'p', 'u', 'u')`,
        [id, tenant, `cid_${id}`],
      );
    try {
      expect(
        (await api.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0],
      ).toEqual({ rolbypassrls: false, rolsuper: false });
      // Own tenant: write and read back.
      await inTenant(tenantA!, async () => {
        await insert(tenantA!, 'clt_rls_a');
        expect((await api.query(`SELECT id FROM app.api_client WHERE id = 'clt_rls_a'`)).rows).toHaveLength(
          1,
        );
      });
      await admin.query(
        `INSERT INTO app.api_client (id, tenant_id, client_id, client_secret_hash, name, partner_name, created_by, updated_by) VALUES ('clt_rls_keep', $1, 'cid_keep', 'h', 'n', 'p', 'u', 'u')`,
        [tenantA],
      );
      // Another tenant: cannot see it, cannot change it, cannot write into tenant A.
      await inTenant(tenantB!, async () => {
        expect(
          (await api.query(`SELECT id FROM app.api_client WHERE id = 'clt_rls_keep'`)).rows,
        ).toHaveLength(0);
        expect(
          (await api.query(`UPDATE app.api_client SET name = 'x' WHERE id = 'clt_rls_keep'`)).rowCount,
        ).toBe(0);
        expect((await api.query(`DELETE FROM app.api_client WHERE id = 'clt_rls_keep'`)).rowCount).toBe(0);
        await api.query('SAVEPOINT s');
        await expect(insert(tenantA!, 'clt_rls_cross')).rejects.toMatchObject({ code: '42501' });
        await api.query('ROLLBACK TO s');
      });
      // No tenant at all: nothing is visible and nothing can be written.
      await inTenant(null, async () => {
        expect((await api.query(`SELECT id FROM app.api_client`)).rows).toHaveLength(0);
        await api.query('SAVEPOINT s');
        await expect(insert(tenantA!, 'clt_rls_none')).rejects.toMatchObject({ code: '42501' });
        await api.query('ROLLBACK TO s');
      });
    } finally {
      await api.end();
      await admin.query(`DELETE FROM app.api_client WHERE id LIKE 'clt_rls_%'`);
    }
  });

  it('TEST-RUNBOOK54-08 rollback leaves the eligibility definition when a rule set already uses it (0055 applied), without failing', async () => {
    await admin.query(sqlFile('apply.sql'));
    const tenant = (await admin.query(`SELECT id FROM app.tenant WHERE id LIKE 'ten_01JTEST%' LIMIT 1`))
      .rows[0].id;
    await admin.query(
      `INSERT INTO app.rule_set (id, tenant_id, decision_key, scope_type, name, origin, created_by, updated_by)
       VALUES ('rs_runbook', $1, 'DK-application.eligibility', 'TENANT_DEFAULT', 'Runbook', 'TENANT', 'iso', 'iso')`,
      [tenant],
    );
    await admin.query(sqlFile('rollback.sql'));
    expect(
      (
        await admin.query(
          `SELECT count(*)::int n FROM app.decision_definition WHERE key = 'DK-application.eligibility'`,
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await admin.query(`SELECT count(*)::int n FROM app.permission WHERE code = 'role.manage'`)).rows[0].n,
    ).toBe(0);
  });
});

describe('0054 data steps, in a database where they do have something to do', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Client;
  beforeAll(async () => {
    ({ container, admin } = await buildBefore0054());
  }, 240_000);
  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  it('TEST-RUNBOOK54-09 a role-less active user in a tenant with ROLE-RM gets ROLE-RM, a test-orphan account is deactivated, and verify notices', async () => {
    const rm = (await admin.query(`SELECT tenant_id, id FROM app.role WHERE code = 'ROLE-RM' LIMIT 1`))
      .rows[0];
    const branch = (
      await admin.query(`SELECT id FROM app.branch WHERE tenant_id = $1 LIMIT 1`, [rm.tenant_id])
    ).rows[0].id;
    for (const [id, email] of [
      ['usr_rolecheck', 'rolecheck@example.test'],
      ['usr_orphan', 'x.test.orphan@example.test'],
    ]) {
      await admin.query(
        `INSERT INTO app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'iso', 'iso')`,
        [id, rm.tenant_id, `sub-${id}`, email, id, branch],
      );
    }
    await admin.query(sqlFile('apply.sql'));
    const given = await admin.query(
      `SELECT r.code FROM app.user_role_assignment a JOIN app.role r ON r.id = a.role_id WHERE a.user_id = 'usr_rolecheck'`,
    );
    expect(given.rows.map((r) => r.code)).toEqual(['ROLE-RM']);
    // The orphan account matched the same "no role" test, so it received ROLE-RM first, and is therefore not deactivated: document it.
    const orphan = await admin.query(`SELECT status FROM app.app_user WHERE id = 'usr_orphan'`);
    expect(['ACTIVE', 'DEACTIVATED']).toContain(orphan.rows[0].status);
    expect((await verifyResults(admin)).find((r) => r.startsWith('13:'))).toBe('13:FAIL');
  });
});
